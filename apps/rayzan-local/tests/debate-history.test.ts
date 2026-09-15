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

function runCompletedDebate(runtime: RayzanRuntime, topic: string) {
  const { coordinator, qwen, glm } = registerTrio(runtime);
  runtime.runLiveRound1(topic);
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
  runtime.submitCapturedResponse(
    coordinator.id,
    synthesisJob.deliveryId,
    'Final recommendation: Start with SQLite.',
  );
  return { coordinator, firstId: started.debate!.id };
}

describe('debate history and single active debate', () => {
  it('lets a completed debate allow another debate with a new id', () => {
    const runtime = new RayzanRuntime();
    const { firstId } = runCompletedDebate(runtime, 'First completed debate');
    const afterComplete = runtime.snapshot();
    assert.equal(afterComplete.activeDebate, undefined);
    assert.equal(afterComplete.debate?.status, 'completed');
    assert.equal(afterComplete.debateHistory.length, 1);
    runtime.createRound1('Second debate topic');
    const afterStart = runtime.snapshot();
    assert.ok(afterStart.activeDebate);
    assert.notEqual(afterStart.activeDebate?.id, firstId);
    assert.equal(afterStart.debateHistory.length, 1);
    assert.equal(afterStart.debateHistory[0]?.id, firstId);
    assert.equal(afterStart.debateHistory[0]?.status, 'completed');
  });

  it('does not let an archived debate block a new debate', () => {
    const runtime = new RayzanRuntime();
    registerTrio(runtime);
    runtime.createRound1('Incomplete then archived');
    const firstId = runtime.snapshot().activeDebate?.id;
    runtime.archiveActiveDebate();
    assert.equal(runtime.snapshot().activeDebate, undefined);
    runtime.createRound1('After archive');
    const after = runtime.snapshot();
    assert.ok(after.activeDebate);
    assert.notEqual(after.activeDebate?.id, firstId);
    assert.equal(after.debateHistory.some((item) => item.id === firstId), true);
  });

  it('blocks a second active debate', () => {
    const runtime = new RayzanRuntime();
    registerTrio(runtime);
    runtime.createRound1('Only one open debate');
    assert.throws(
      () => runtime.createRound1('A second active debate'),
      /active debate already exists/,
    );
    runtime.runLiveRound1('Only one open debate');
    assert.throws(
      () => runtime.runLiveRound1('A second active debate'),
      /active debate already exists/,
    );
    assert.equal(runtime.snapshot().debateHistory.length, 0);
    assert.equal(runtime.debates.list().length, 1);
  });

  it('keeps historical debates queryable and does not rewrite old events', () => {
    const runtime = new RayzanRuntime();
    registerTrio(runtime);
    runtime.createRound1('Preserve me');
    const before = runtime.events.listAll().map((event) => ({
      id: event.id,
      type: event.type,
      payload: event.payload,
      debateId: event.debateId,
    }));
    const firstId = runtime.snapshot().activeDebate?.id;
    runtime.archiveActiveDebate();
    runtime.createRound1('Brand new debate');
    const after = runtime.events.listAll();
    const original = after.filter((event) =>
      before.some((item) => item.id === event.id),
    );
    assert.deepEqual(
      original.map((event) => ({
        id: event.id,
        type: event.type,
        payload: event.payload,
        debateId: event.debateId,
      })),
      before,
    );
    assert.ok(after.some((event) => event.type === 'DEBATE_ARCHIVED'));
    assert.equal(
      after.filter((event) => event.type === 'DEBATE_CREATED').length,
      2,
    );
    const snap = runtime.snapshot();
    assert.notEqual(snap.activeDebate?.id, firstId);
    assert.equal(snap.debateHistory[0]?.id, firstId);
  });

  it('replays archive and still allows a later debate', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rayzan-archive-replay-'));
    const filePath = path.join(dir, 'rayzan.sqlite');
    try {
      const storeA = new SqliteEventStore(filePath);
      const runtimeA = new RayzanRuntime(storeA);
      registerTrio(runtimeA);
      runtimeA.createRound1('Archived across restart');
      const firstId = runtimeA.snapshot().activeDebate?.id;
      runtimeA.archiveActiveDebate();
      const eventCount = storeA.listAll().length;
      storeA.close();

      const storeB = new SqliteEventStore(filePath);
      const runtimeB = new RayzanRuntime(storeB);
      const restored = runtimeB.snapshot();
      assert.equal(storeB.listAll().length, eventCount);
      assert.equal(restored.activeDebate, undefined);
      assert.equal(restored.debateHistory[0]?.id, firstId);
      assert.equal(restored.debateHistory[0]?.status, 'archived');
      runtimeB.createRound1('New after archived restore');
      const after = runtimeB.snapshot();
      assert.ok(after.activeDebate);
      assert.notEqual(after.activeDebate?.id, firstId);
      storeB.close();
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows can keep a short lock on the WAL file after close.
      }
    }
  });

  it('lets a completed restored debate start a new debate', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rayzan-completed-replay-'));
    const filePath = path.join(dir, 'rayzan.sqlite');
    try {
      const storeA = new SqliteEventStore(filePath);
      const runtimeA = new RayzanRuntime(storeA);
      const { firstId } = runCompletedDebate(runtimeA, 'Completed then restored');
      storeA.close();

      const storeB = new SqliteEventStore(filePath);
      const runtimeB = new RayzanRuntime(storeB);
      const restored = runtimeB.snapshot();
      assert.equal(restored.activeDebate, undefined);
      assert.equal(restored.debate?.status, 'completed');
      assert.equal(restored.debateHistory[0]?.id, firstId);
      runtimeB.createRound1('Allowed after completed restore');
      const after = runtimeB.snapshot();
      assert.ok(after.activeDebate);
      assert.notEqual(after.activeDebate?.id, firstId);
      assert.equal(after.debateHistory[0]?.id, firstId);
      storeB.close();
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows can keep a short lock on the WAL file after close.
      }
    }
  });

  it('still blocks start while an incomplete restored debate is active', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rayzan-active-replay-'));
    const filePath = path.join(dir, 'rayzan.sqlite');
    try {
      const storeA = new SqliteEventStore(filePath);
      const runtimeA = new RayzanRuntime(storeA);
      registerTrio(runtimeA);
      runtimeA.createRound1('Still open after restart');
      const firstId = runtimeA.snapshot().activeDebate?.id;
      storeA.close();

      const storeB = new SqliteEventStore(filePath);
      const runtimeB = new RayzanRuntime(storeB);
      assert.equal(runtimeB.snapshot().activeDebate?.id, firstId);
      assert.throws(
        () => runtimeB.runLiveRound1('Must not start another'),
        /active debate already exists/,
      );
      runtimeB.archiveActiveDebate();
      runtimeB.createRound1('Allowed after archive of restored debate');
      assert.notEqual(runtimeB.snapshot().activeDebate?.id, firstId);
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
