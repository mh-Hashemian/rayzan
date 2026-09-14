import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { RayzanRuntime } from '../src/runtime.js';

describe('RayzanRuntime Round 1', () => {
  it('bootstraps a visible Round 1 without sending browser deliveries', () => {
    const runtime = new RayzanRuntime();
    const coordinator = runtime.registerAgent(
      'DeepSeek Coordinator',
      'coordinator',
    );
    const qwen = runtime.registerAgent('Qwen', 'watcher');
    const glm = runtime.registerAgent('GLM', 'watcher');
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
    runtime.registerAgent('DeepSeek Coordinator', 'coordinator');
    const qwen = runtime.registerAgent('Qwen', 'watcher');
    const glm = runtime.registerAgent('GLM', 'watcher');
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

  it('routes Coordinator dispatch to Qwen and GLM then auto-completes', () => {
    const runtime = new RayzanRuntime();
    const coordinator = runtime.registerAgent(
      'DeepSeek Coordinator',
      'coordinator',
    );
    const qwen = runtime.registerAgent('Qwen', 'watcher');
    const glm = runtime.registerAgent('GLM', 'watcher');
    runtime.startRound1('Is automatic capture useful?');

    const snap = runtime.snapshot();
    assert.ok(snap.debate?.id);
    assert.ok(snap.round?.id);
    assert.equal(snap.round?.status, 'active');

    const coordinatorJob = runtime.nextPendingForAgent(coordinator.id);
    assert.ok(coordinatorJob);
    assert.match(coordinatorJob.body, new RegExp(snap.debate.id));
    assert.match(coordinatorJob.body, new RegExp(snap.round.id));
    assert.match(coordinatorJob.body, new RegExp(qwen.id));
    assert.match(coordinatorJob.body, new RegExp(glm.id));

    runtime.acknowledgeDelivery(coordinator.id, coordinatorJob.deliveryId);
    runtime.submitCapturedResponse(
      coordinator.id,
      coordinatorJob.deliveryId,
      JSON.stringify({
        version: 1,
        commands: [
          {
            type: 'dispatch',
            messageId: 'round1-brief',
            debateId: snap.debate.id,
            roundId: snap.round.id,
            recipients: { type: 'round-watchers' },
            kind: 'brief',
            body: 'Analyze independently.',
            referencedMessageIds: [],
          },
        ],
      }),
    );

    assert.equal(runtime.nextPendingForAgent(coordinator.id), undefined);
    const qwenJob = runtime.nextPendingForAgent(qwen.id);
    const glmJob = runtime.nextPendingForAgent(glm.id);
    assert.ok(qwenJob);
    assert.ok(glmJob);
    assert.notEqual(qwenJob.deliveryId, glmJob.deliveryId);

    runtime.acknowledgeDelivery(qwen.id, qwenJob.deliveryId);
    runtime.submitCapturedResponse(
      qwen.id,
      qwenJob.deliveryId,
      'Qwen analysis',
    );
    const afterOne = runtime.snapshot();
    assert.equal(afterOne.roundProgress?.responded, 1);
    assert.equal(afterOne.round?.status, 'collecting');

    runtime.acknowledgeDelivery(glm.id, glmJob.deliveryId);
    runtime.submitCapturedResponse(glm.id, glmJob.deliveryId, 'GLM analysis');

    const done = runtime.snapshot();
    assert.equal(done.roundProgress?.responded, 2);
    assert.equal(done.roundProgress?.expected, 2);
    assert.equal(done.roundProgress?.complete, true);
    assert.equal(done.round?.status, 'completed');
    assert.equal(done.debate?.status, 'active');
    const qwenAgent = done.agents.find((agent) => agent.id === qwen.id);
    const glmAgent = done.agents.find((agent) => agent.id === glm.id);
    assert.equal(qwenAgent?.response, 'Qwen analysis');
    assert.equal(glmAgent?.response, 'GLM analysis');
  });

  it('accepts live Coordinator JSON that omits referencedMessageIds and invents round-2', () => {
    const runtime = new RayzanRuntime();
    const coordinator = runtime.registerAgent(
      'DeepSeek Coordinator',
      'coordinator',
    );
    const qwen = runtime.registerAgent('Qwen', 'watcher');
    runtime.registerAgent('GLM', 'watcher');
    runtime.startRound1('Is automatic capture useful?');

    const snap = runtime.snapshot();
    const coordinatorJob = runtime.nextPendingForAgent(coordinator.id);
    assert.ok(coordinatorJob);
    runtime.acknowledgeDelivery(coordinator.id, coordinatorJob.deliveryId);
    runtime.submitCapturedResponse(
      coordinator.id,
      coordinatorJob.deliveryId,
      JSON.stringify({
        version: 1,
        commands: [
          {
            type: 'dispatch',
            messageId: 'round1-brief',
            debateId: snap.debate?.id,
            roundId: 'round-2',
            recipients: { type: 'round-watchers' },
            kind: 'brief',
            body: 'Analyze independently.',
          },
        ],
      }),
    );

    assert.equal(runtime.snapshot().lastError, undefined);
    assert.ok(runtime.nextPendingForAgent(qwen.id));
  });
});
