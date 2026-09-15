import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

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

describe('RayzanRuntime Round 1', () => {
  it('bootstraps a visible Round 1 without sending browser deliveries', () => {
    const runtime = new RayzanRuntime();
    const { coordinator, qwen, glm } = registerTrio(runtime);
    runtime.createRound1('Is automatic capture useful?');

    const snap = runtime.snapshot();
    assert.equal(snap.debate?.status, 'active');
    assert.equal(snap.round?.number, 1);
    assert.equal(snap.round?.status, 'active');
    assert.deepEqual(
      snap.participants.map((participant) => participant.id),
      [qwen.id, glm.id],
    );
    assert.equal(
      snap.participants.some(
        (participant) => participant.id === coordinator.id,
      ),
      false,
    );
    assert.equal(snap.roundProgress?.responded, 0);
    assert.equal(snap.roundProgress?.expected, 2);
    assert.equal(snap.protocol.messages, 0);
    assert.equal(snap.protocol.deliveries, 0);
    assert.equal(snap.protocol.exposures, 0);
    assert.equal(runtime.nextPendingForAgent(coordinator.id), undefined);
    assert.equal(runtime.nextPendingForAgent(qwen.id), undefined);
    assert.equal(runtime.nextPendingForAgent(glm.id), undefined);
  });

  it('sends a test message through BrowserTransport pending → delivered only', () => {
    const runtime = new RayzanRuntime();
    registerTrio(runtime);
    const qwen = runtime.agents.listByRole('watcher')[0]!;
    const glm = runtime.agents.listByRole('watcher')[1]!;
    runtime.createRound1('Binding checkpoint');
    runtime.noteBinding({
      agentId: qwen.id,
      provider: 'Qwen',
      tabId: '12',
      available: true,
    });

    runtime.sendTestMessage(qwen.id, 'Reply only with: QWEN_RAYZAN_OK');
    const qwenJob = runtime.nextPendingForAgent(qwen.id);
    assert.ok(qwenJob);
    assert.equal(runtime.nextPendingForAgent(glm.id), undefined);
    assert.equal(runtime.snapshot().roundProgress?.responded, 0);

    runtime.acknowledgeDelivery(qwen.id, qwenJob.deliveryId);
    const afterAck = runtime.snapshot();
    assert.equal(
      afterAck.deliveries.find((delivery) => delivery.id === qwenJob.deliveryId)
        ?.status,
      'delivered',
    );
    assert.equal(afterAck.roundProgress?.responded, 0);
    assert.equal(runtime.nextPendingForAgent(qwen.id), undefined);

    assert.throws(() =>
      runtime.acknowledgeDelivery(qwen.id, qwenJob.deliveryId),
    );
    assert.throws(() =>
      runtime.acknowledgeDelivery(glm.id, qwenJob.deliveryId),
    );
  });
});

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

describe('live Round 1 → Coordinator → personalized Round 2', () => {
  it('lets Coordinator rephrase the brief, then captures Watchers, then Round 2', () => {
    const runtime = new RayzanRuntime();
    const { coordinator, qwen, glm } = registerTrio(runtime);
    const problem =
      'Should Rayzan use SQLite or PostgreSQL for its future persistent local state?';
    runtime.runLiveRound1(problem);

    const afterStart = runtime.snapshot();
    const coordinatorBrief = runtime.nextPendingForAgent(coordinator.id);
    assert.ok(coordinatorBrief);
    assert.equal(runtime.nextPendingForAgent(qwen.id), undefined);
    assert.equal(runtime.nextPendingForAgent(glm.id), undefined);
    assert.match(coordinatorBrief.body, /Rephrase/);
    assert.match(coordinatorBrief.body, new RegExp(qwen.id));
    assert.match(coordinatorBrief.body, new RegExp(glm.id));

    const briefBody =
      'Rephrased: pick SQLite or PostgreSQL. Qwen and GLM are independent Round 1 watchers; do not assume you saw the other answer.';
    submitRound1CoordinatorBrief(
      runtime,
      coordinator.id,
      afterStart.debate!.id,
      afterStart.round1!.id,
      briefBody,
    );

    const afterDispatch = runtime.snapshot();
    assert.equal(afterDispatch.round1?.status, 'collecting');
    const qwenJob = runtime.nextPendingForAgent(qwen.id);
    const glmJob = runtime.nextPendingForAgent(glm.id);
    assert.ok(qwenJob);
    assert.ok(glmJob);
    assert.notEqual(qwenJob.deliveryId, glmJob.deliveryId);
    assert.equal(qwenJob.body, briefBody);
    assert.equal(glmJob.body, briefBody);
    assert.equal(qwenJob.capture, true);
    const briefMessage = afterDispatch.messages.find(
      (message) => message.kind === 'brief',
    );
    assert.equal(briefMessage?.senderId, coordinator.id);
    assert.equal(afterDispatch.roundProgress?.responded, 0);

    runtime.acknowledgeDelivery(qwen.id, qwenJob.deliveryId);
    runtime.acknowledgeDelivery(glm.id, glmJob.deliveryId);
    runtime.submitCapturedResponse(
      qwen.id,
      qwenJob.deliveryId,
      'Qwen says SQLite.',
    );
    const afterOne = runtime.snapshot();
    assert.equal(afterOne.roundProgress?.responded, 1);
    assert.equal(afterOne.round1?.status, 'collecting');
    assert.equal(runtime.nextPendingForAgent(coordinator.id), undefined);

    runtime.submitCapturedResponse(
      glm.id,
      glmJob.deliveryId,
      'GLM says PostgreSQL.',
    );
    const afterRound1 = runtime.snapshot();
    assert.equal(afterRound1.roundProgress?.responded, 2);
    assert.equal(afterRound1.roundProgress?.complete, true);
    assert.equal(afterRound1.round1?.status, 'completed');
    assert.equal(afterRound1.round2?.status, 'active');
    assert.deepEqual(
      afterRound1.round1Responses.map((item) => item.name),
      ['Qwen', 'GLM'],
    );
    assert.match(afterRound1.round1Responses[0]?.body ?? '', /SQLite/);
    assert.match(afterRound1.round1Responses[1]?.body ?? '', /PostgreSQL/);

    const coordinatorJob = runtime.nextPendingForAgent(coordinator.id);
    assert.ok(coordinatorJob);
    assert.equal(coordinatorJob.capture, true);
    assert.match(coordinatorJob.body, /Original Operator Problem/);
    assert.match(coordinatorJob.body, /Coordinator Round 1 Brief/);
    assert.match(coordinatorJob.body, /Qwen says SQLite/);
    assert.match(coordinatorJob.body, /GLM says PostgreSQL/);
    assert.match(coordinatorJob.body, new RegExp(afterRound1.debate!.id));
    assert.match(coordinatorJob.body, new RegExp(afterRound1.round2!.id));
    assert.match(coordinatorJob.body, new RegExp(qwen.id));
    assert.match(coordinatorJob.body, new RegExp(glm.id));

    runtime.acknowledgeDelivery(coordinator.id, coordinatorJob.deliveryId);
    const qwenR1 = afterRound1.messages.find(
      (message) => message.kind === 'response' && message.senderId === qwen.id,
    );
    const glmR1 = afterRound1.messages.find(
      (message) => message.kind === 'response' && message.senderId === glm.id,
    );
    assert.ok(qwenR1);
    assert.ok(glmR1);

    runtime.submitCapturedResponse(
      coordinator.id,
      coordinatorJob.deliveryId,
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
            referencedMessageIds: [qwenR1.id],
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
            body: 'Challenge GLM on operational complexity.',
          },
        ],
      }),
    );

    const done = runtime.snapshot();
    assert.equal(done.coordinatorPlan?.parsed, true);
    assert.equal(done.round2Messages.length, 2);
    const qwenRound2 = done.round2Messages.find((item) => item.name === 'Qwen');
    const glmRound2 = done.round2Messages.find((item) => item.name === 'GLM');
    assert.ok(qwenRound2);
    assert.ok(glmRound2);
    assert.match(qwenRound2.body, /You are Qwen, a Watcher in Round 2/);
    assert.match(glmRound2.body, /You are GLM, a Watcher in Round 2/);
    assert.match(qwenRound2.body, /COMMON ROUND 1 EVIDENCE/);
    assert.match(glmRound2.body, /COMMON ROUND 1 EVIDENCE/);
    assert.equal(qwenRound2.body.includes('Qwen says SQLite.'), true);
    assert.equal(glmRound2.body.includes('Qwen says SQLite.'), true);
    assert.equal(qwenRound2.body.includes('GLM says PostgreSQL.'), true);
    assert.equal(glmRound2.body.includes('GLM says PostgreSQL.'), true);
    assert.match(qwenRound2.body, /Challenge Qwen on durability/);
    assert.match(glmRound2.body, /Challenge GLM on operational complexity/);
    assert.equal(qwenRound2.body.includes('Challenge GLM'), false);
    assert.equal(glmRound2.body.includes('Challenge Qwen'), false);

    const qwenR2 = runtime.nextPendingForAgent(qwen.id);
    const glmR2 = runtime.nextPendingForAgent(glm.id);
    assert.ok(qwenR2);
    assert.ok(glmR2);
    assert.equal(qwenR2.capture, false);
    assert.equal(glmR2.capture, false);
    assert.equal(qwenR2.body, qwenRound2.body);
    assert.equal(glmR2.body, glmRound2.body);

    runtime.acknowledgeDelivery(qwen.id, qwenR2.deliveryId);
    runtime.acknowledgeDelivery(glm.id, glmR2.deliveryId);
    const delivered = runtime.snapshot();
    assert.equal(
      delivered.agents.find((agent) => agent.id === qwen.id)?.round2Status,
      'delivered',
    );
    assert.equal(
      delivered.agents.find((agent) => agent.id === glm.id)?.round2Status,
      'delivered',
    );
    assert.equal(delivered.round1?.status, 'completed');
    assert.match(delivered.timeline.join('\n'), /COMPLETED/);
    assert.match(
      delivered.timeline.join('\n'),
      /Personalized prompt delivered/,
    );

    const qwenR2Message = delivered.messages.find(
      (message) =>
        message.kind === 'query' && message.recipientIds.includes(qwen.id),
    );
    assert.ok(qwenR2Message);
    assert.equal(qwenR2Message.body.includes('COMMON ROUND 1 EVIDENCE'), true);
  });

  it('does not send Round 2 evidence when only one Watcher has responded', () => {
    const runtime = new RayzanRuntime();
    const { coordinator, qwen, glm } = registerTrio(runtime);
    runtime.runLiveRound1('One watcher only');
    const started = runtime.snapshot();
    submitRound1CoordinatorBrief(
      runtime,
      coordinator.id,
      started.debate!.id,
      started.round1!.id,
      'Independent brief for Qwen and GLM.',
    );
    const qwenJob = runtime.nextPendingForAgent(qwen.id);
    const glmJob = runtime.nextPendingForAgent(glm.id);
    assert.ok(qwenJob);
    assert.ok(glmJob);
    runtime.acknowledgeDelivery(qwen.id, qwenJob.deliveryId);
    runtime.submitCapturedResponse(qwen.id, qwenJob.deliveryId, 'Qwen only');
    assert.equal(runtime.snapshot().roundProgress?.responded, 1);
    assert.equal(runtime.nextPendingForAgent(coordinator.id), undefined);
  });

  it('keeps Round 1 completed and does not dispatch Round 2 when Coordinator JSON fails', () => {
    const runtime = new RayzanRuntime();
    const { coordinator, qwen, glm } = registerTrio(runtime);
    runtime.runLiveRound1('Parse failure path');
    const started = runtime.snapshot();
    submitRound1CoordinatorBrief(
      runtime,
      coordinator.id,
      started.debate!.id,
      started.round1!.id,
      'Independent brief for Qwen and GLM.',
    );
    const qwenJob = runtime.nextPendingForAgent(qwen.id)!;
    const glmJob = runtime.nextPendingForAgent(glm.id)!;
    runtime.acknowledgeDelivery(qwen.id, qwenJob.deliveryId);
    runtime.acknowledgeDelivery(glm.id, glmJob.deliveryId);
    runtime.submitCapturedResponse(qwen.id, qwenJob.deliveryId, 'Qwen');
    runtime.submitCapturedResponse(glm.id, glmJob.deliveryId, 'GLM');
    const coordinatorJob = runtime.nextPendingForAgent(coordinator.id)!;
    runtime.acknowledgeDelivery(coordinator.id, coordinatorJob.deliveryId);
    runtime.submitCapturedResponse(
      coordinator.id,
      coordinatorJob.deliveryId,
      'This is prose, not JSON.',
    );
    const failed = runtime.snapshot();
    assert.equal(failed.round1?.status, 'completed');
    assert.equal(failed.coordinatorPlan?.parsed, false);
    assert.match(failed.coordinatorPlan?.error ?? '', /JSON|parse|command/i);
    assert.equal(failed.round2Messages.length, 0);
    assert.equal(runtime.nextPendingForAgent(qwen.id), undefined);
    assert.equal(runtime.nextPendingForAgent(glm.id), undefined);
  });
});

describe('presence', () => {
  it('keeps a failed capture visible after a later waiting heartbeat', () => {
    const runtime = new RayzanRuntime();
    const { coordinator } = registerTrio(runtime);
    runtime.notePresence({
      agentId: coordinator.id,
      phase: 'error',
      error: 'DeepSeek send button stayed disabled after filling the input.',
      capture: { phase: 'failed', reason: 'empty-response' },
    });
    runtime.notePresence({
      agentId: coordinator.id,
      phase: 'waiting',
    });
    const row = runtime
      .snapshot()
      .agents.find((agent) => agent.id === coordinator.id);
    assert.equal(row?.phase, 'error');
    assert.equal(row?.capture?.phase, 'failed');
    assert.match(
      String(runtime.snapshot().lastError),
      /send button stayed disabled/,
    );
  });
});
