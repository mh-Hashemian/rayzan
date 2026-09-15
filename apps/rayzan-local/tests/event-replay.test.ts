import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { SqliteEventStore } from '@rayzan/storage';

import { RayzanRuntime } from '../src/runtime.js';

function registerTrio(runtime: RayzanRuntime) {
  const coordinator = runtime.registerAgent(
    'DeepSeek Coordinator',
    'coordinator',
  );
  const qwen = runtime.registerAgent('Qwen', 'watcher');
  const glm = runtime.registerAgent('GLM', 'watcher');
  return { coordinator, qwen, glm };
}

function submitRound1CoordinatorBrief(
  runtime: RayzanRuntime,
  coordinatorId: string,
  debateId: string,
  roundId: string,
  body: string,
): void {
  const job = runtime.nextPendingForAgent(coordinatorId);
  assert.ok(job);
  runtime.acknowledgeDelivery(coordinatorId, job.deliveryId);
  runtime.submitCapturedResponse(
    coordinatorId,
    job.deliveryId,
    JSON.stringify({
      version: 1,
      commands: [
        {
          type: 'dispatch',
          messageId: 'round1-brief',
          debateId,
          roundId,
          recipients: { type: 'round-watchers' },
          kind: 'brief',
          body,
          referencedMessageIds: [],
        },
      ],
    }),
  );
}

function runCompletedDebate(runtime: RayzanRuntime) {
  const { coordinator, qwen, glm } = registerTrio(runtime);
  runtime.runLiveRound1('SQLite or PostgreSQL?');
  const started = runtime.snapshot();
  submitRound1CoordinatorBrief(
    runtime,
    coordinator.id,
    started.debate!.id,
    started.round1!.id,
    'Independent brief for Qwen and GLM.',
  );
  const qwenR1 = runtime.nextPendingForAgent(qwen.id)!;
  const glmR1 = runtime.nextPendingForAgent(glm.id)!;
  runtime.acknowledgeDelivery(qwen.id, qwenR1.deliveryId);
  runtime.acknowledgeDelivery(glm.id, glmR1.deliveryId);
  runtime.submitCapturedResponse(qwen.id, qwenR1.deliveryId, 'Qwen: SQLite.');
  runtime.submitCapturedResponse(glm.id, glmR1.deliveryId, 'GLM: PostgreSQL.');
  const afterRound1 = runtime.snapshot();
  const coordinatorPlanJob = runtime.nextPendingForAgent(coordinator.id)!;
  runtime.acknowledgeDelivery(coordinator.id, coordinatorPlanJob.deliveryId);
  runtime.submitCapturedResponse(
    coordinator.id,
    coordinatorPlanJob.deliveryId,
    JSON.stringify({
      version: 1,
      commands: [
        {
          type: 'dispatch',
          messageId: 'r2-qwen',
          debateId: afterRound1.debate!.id,
          roundId: afterRound1.round2!.id,
          recipients: {
            type: 'explicit-agents',
            agentIds: [qwen.id],
          },
          kind: 'query',
          body: 'Challenge Qwen on durability.',
          referencedMessageIds: [],
        },
        {
          type: 'dispatch',
          messageId: 'r2-glm',
          debateId: afterRound1.debate!.id,
          roundId: afterRound1.round2!.id,
          recipients: {
            type: 'explicit-agents',
            agentIds: [glm.id],
          },
          kind: 'query',
          body: 'Challenge GLM on complexity.',
          referencedMessageIds: [],
        },
      ],
    }),
  );
  const qwenR2 = runtime.nextPendingForAgent(qwen.id)!;
  const glmR2 = runtime.nextPendingForAgent(glm.id)!;
  runtime.acknowledgeDelivery(qwen.id, qwenR2.deliveryId);
  runtime.acknowledgeDelivery(glm.id, glmR2.deliveryId);
  runtime.submitCapturedResponse(
    qwen.id,
    qwenR2.deliveryId,
    'Qwen Round 2: SQLite still, with WAL.',
  );
  runtime.submitCapturedResponse(
    glm.id,
    glmR2.deliveryId,
    'GLM Round 2: PostgreSQL still, managed.',
  );
  const synthesisJob = runtime.nextPendingForAgent(coordinator.id)!;
  runtime.acknowledgeDelivery(coordinator.id, synthesisJob.deliveryId);
  const report = `Final recommendation:
Start with SQLite.`;
  runtime.submitCapturedResponse(coordinator.id, synthesisJob.deliveryId, report);
  return { coordinator, qwen, glm, report };
}

describe('RayzanRuntime event replay', () => {
  it('rebuilds equivalent state after opening the same database', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rayzan-replay-'));
    const filePath = path.join(dir, 'rayzan.sqlite');
    try {
      const storeA = new SqliteEventStore(filePath);
      const runtimeA = new RayzanRuntime(storeA);
      const { coordinator, qwen, glm, report } = runCompletedDebate(runtimeA);
      const before = runtimeA.snapshot();
      const eventCount = storeA.listAll().length;
      storeA.close();

      const storeB = new SqliteEventStore(filePath);
      const runtimeB = new RayzanRuntime(storeB);
      const after = runtimeB.snapshot();

      assert.equal(storeB.listAll().length, eventCount);
      assert.equal(after.restoredFromHistory, true);
      assert.equal(after.replay.status, 'RESTORED');
      assert.equal(after.agents.find((agent) => agent.id === coordinator.id)?.name, 'DeepSeek Coordinator');
      assert.equal(after.agents.find((agent) => agent.id === qwen.id)?.role, 'watcher');
      assert.equal(after.agents.find((agent) => agent.id === glm.id)?.name, 'GLM');
      assert.equal(after.debate?.id, before.debate?.id);
      assert.equal(after.debate?.topic, before.debate?.topic);
      assert.equal(after.debate?.status, 'completed');
      assert.equal(after.round1?.status, 'completed');
      assert.equal(after.round2?.status, 'completed');
      assert.equal(after.protocol.messages, before.protocol.messages);
      assert.equal(after.protocol.exposures, before.protocol.exposures);
      assert.equal(after.synthesis?.body, report);
      assert.deepEqual(
        after.messages.map((message) => ({
          id: message.id,
          senderId: message.senderId,
          body: message.body,
        })),
        before.messages.map((message) => ({
          id: message.id,
          senderId: message.senderId,
          body: message.body,
        })),
      );
      assert.equal(runtimeB.nextPendingForAgent(qwen.id), undefined);
      assert.equal(runtimeB.nextPendingForAgent(glm.id), undefined);
      assert.equal(runtimeB.nextPendingForAgent(coordinator.id), undefined);
      storeB.close();
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows can keep a short lock on the WAL file after close.
      }
    }
  });

  it('reconstructs an interrupted delivery without resending', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rayzan-replay-pending-'));
    const filePath = path.join(dir, 'rayzan.sqlite');
    try {
      const storeA = new SqliteEventStore(filePath);
      const runtimeA = new RayzanRuntime(storeA);
      const { coordinator, qwen } = registerTrio(runtimeA);
      runtimeA.createRound1('Interrupted delivery');
      runtimeA.sendTestMessage(qwen.id, 'Do not resend this.');
      const pending = runtimeA.nextPendingForAgent(qwen.id);
      assert.ok(pending);
      const debateId = runtimeA.snapshot().debate?.id;
      const eventCount = storeA.listAll().length;
      storeA.close();

      const storeB = new SqliteEventStore(filePath);
      const runtimeB = new RayzanRuntime(storeB);
      const after = runtimeB.snapshot();
      assert.equal(storeB.listAll().length, eventCount);
      assert.equal(after.debate?.id, debateId);
      assert.equal(
        after.deliveries.some(
          (delivery) =>
            delivery.id === pending.deliveryId && delivery.status === 'pending',
        ),
        true,
      );
      assert.equal(runtimeB.nextPendingForAgent(qwen.id), undefined);
      assert.equal(runtimeB.nextPendingForAgent(coordinator.id), undefined);
      assert.ok((after.replay.unresolvedDeliveries ?? 0) >= 1);
      assert.equal(after.replay.status, 'RESTORED_WITH_WARNINGS');
      assert.match(
        after.replay.warnings.map((warning) => warning.message).join('\n'),
        /Operator attention required/,
      );
      storeB.close();
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows can keep a short lock on the WAL file after close.
      }
    }
  });

  it('refuses Start live debate after a debate is restored', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rayzan-replay-norestart-'));
    const filePath = path.join(dir, 'rayzan.sqlite');
    try {
      const storeA = new SqliteEventStore(filePath);
      const runtimeA = new RayzanRuntime(storeA);
      const { coordinator } = registerTrio(runtimeA);
      runtimeA.createRound1('Restored debate must not resend');
      const eventCount = storeA.listAll().length;
      storeA.close();

      const storeB = new SqliteEventStore(filePath);
      const runtimeB = new RayzanRuntime(storeB);
      const after = runtimeB.snapshot();
      assert.equal(after.restoredFromHistory, true);
      assert.equal(after.debate?.topic, 'Restored debate must not resend');
      assert.throws(
        () => runtimeB.runLiveRound1('Restored debate must not resend'),
        /restored from event history/,
      );
      assert.equal(storeB.listAll().length, eventCount);
      assert.equal(runtimeB.nextPendingForAgent(coordinator.id), undefined);
      storeB.close();
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows can keep a short lock on the WAL file after close.
      }
    }
  });
});
