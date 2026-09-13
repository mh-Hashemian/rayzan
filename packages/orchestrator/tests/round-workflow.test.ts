import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createAgent,
  createDebate,
  createMessageEnvelope,
  createRound,
  InMemoryAgentRegistry,
  InMemoryDebateStore,
  InMemoryExposureLedgerStore,
  InMemoryMessageStore,
  InMemoryRoundStore,
} from '@rayzan/protocol';
import { ManualTransport } from '@rayzan/transport';

import { OrchestratorError } from '../src/error.js';
import { Orchestrator } from '../src/orchestrator.js';
import { RoundWorkflow } from '../src/round-workflow.js';

function setup() {
  const agents = new InMemoryAgentRegistry();
  const debates = new InMemoryDebateStore();
  const rounds = new InMemoryRoundStore();
  const messages = new InMemoryMessageStore();
  const exposures = new InMemoryExposureLedgerStore();
  const transport = new ManualTransport();
  const orchestrator = new Orchestrator(messages, exposures, transport);
  const workflow = new RoundWorkflow(orchestrator, agents, debates, rounds);

  const coordinator = agents.register(
    createAgent({
      id: 'coordinator',
      name: 'Coordinator',
      role: 'coordinator',
    }),
  );
  const qwen = agents.register(
    createAgent({ id: 'watcher-qwen', name: 'Qwen', role: 'watcher' }),
  );
  const deepSeek = agents.register(
    createAgent({
      id: 'watcher-deepseek',
      name: 'DeepSeek',
      role: 'watcher',
    }),
  );
  const glm = agents.register(
    createAgent({ id: 'watcher-glm', name: 'GLM', role: 'watcher' }),
  );
  const coder = agents.register(
    createAgent({ id: 'coder', name: 'Coder', role: 'coder' }),
  );

  const debate = debates.create(
    createDebate({ id: 'debate-1', topic: 'Transport fallback policy' }),
  );
  const round1 = rounds.create(
    createRound({ id: 'round-1', debateId: debate.id, number: 1 }),
  );

  return {
    agents,
    debates,
    rounds,
    messages,
    exposures,
    transport,
    orchestrator,
    workflow,
    coordinator,
    qwen,
    deepSeek,
    glm,
    coder,
    debate,
    round1,
  };
}

describe('RoundWorkflow', () => {
  it('tracks a global Round 1 until all expected responses arrive', () => {
    const {
      workflow,
      exposures,
      rounds,
      coordinator,
      qwen,
      deepSeek,
      glm,
      debate,
      round1,
    } = setup();

    workflow.startRound({
      roundId: round1.id,
      participantIds: [qwen.id, deepSeek.id, glm.id],
    });

    const brief = createMessageEnvelope({
      id: 'msg-brief-r1',
      debateId: debate.id,
      roundId: round1.id,
      senderId: coordinator.id,
      recipientIds: [qwen.id, deepSeek.id, glm.id],
      kind: 'brief',
      body: 'GLOBAL ROUND 1 MESSAGE',
    });

    const deliveries = workflow.dispatch(round1.id, brief);
    let progress = workflow.getRoundProgress(round1.id);

    assert.equal(progress.expected, 3);
    assert.equal(progress.responded, 0);
    assert.equal(progress.complete, false);
    assert.equal(progress.status, 'collecting');
    assert.equal(deliveries.length, 3);

    const qwenDelivery = deliveries.find((d) => d.recipientId === qwen.id);
    const deepSeekDelivery = deliveries.find(
      (d) => d.recipientId === deepSeek.id,
    );
    const glmDelivery = deliveries.find((d) => d.recipientId === glm.id);
    assert.ok(qwenDelivery);
    assert.ok(deepSeekDelivery);
    assert.ok(glmDelivery);

    workflow.confirmDelivery(round1.id, qwenDelivery.id);
    workflow.confirmDelivery(round1.id, deepSeekDelivery.id);
    workflow.confirmDelivery(round1.id, glmDelivery.id);

    assert.equal(exposures.listByAgent(qwen.id).length, 1);
    assert.equal(exposures.listByAgent(deepSeek.id).length, 1);
    assert.equal(exposures.listByAgent(glm.id).length, 1);

    workflow.submitResponse(round1.id, {
      deliveryId: qwenDelivery.id,
      responderId: qwen.id,
      body: 'Qwen analysis',
    });
    progress = workflow.getRoundProgress(round1.id);
    assert.equal(progress.expected, 3);
    assert.equal(progress.responded, 1);
    assert.equal(progress.remaining, 2);
    assert.equal(progress.complete, false);

    workflow.submitResponse(round1.id, {
      deliveryId: deepSeekDelivery.id,
      responderId: deepSeek.id,
      body: 'DeepSeek analysis',
    });
    progress = workflow.getRoundProgress(round1.id);
    assert.equal(progress.responded, 2);
    assert.equal(progress.remaining, 1);

    workflow.submitResponse(round1.id, {
      deliveryId: glmDelivery.id,
      responderId: glm.id,
      body: 'GLM analysis',
    });
    progress = workflow.getRoundProgress(round1.id);
    assert.equal(progress.responded, 3);
    assert.equal(progress.remaining, 0);
    assert.equal(progress.complete, true);
    assert.equal(progress.status, 'collecting');

    workflow.completeRound(round1.id);
    assert.equal(workflow.getRoundProgress(round1.id).status, 'completed');
    assert.equal(rounds.getById(round1.id)?.status, 'completed');
    assert.equal(rounds.listByDebate(debate.id).length, 1);
  });

  it('tracks separate personalized messages in one Round 2 execution', () => {
    const { workflow, coordinator, qwen, deepSeek, glm, debate, rounds } =
      setup();

    const round2 = rounds.create(
      createRound({ id: 'round-2', debateId: debate.id, number: 2 }),
    );

    workflow.startRound({
      roundId: round2.id,
      participantIds: [qwen.id, deepSeek.id, glm.id],
    });

    const qwenMessage = createMessageEnvelope({
      id: 'msg-r2-qwen',
      debateId: debate.id,
      roundId: round2.id,
      senderId: coordinator.id,
      recipientIds: [qwen.id],
      kind: 'brief',
      body: 'ROUND 2 MESSAGE FOR QWEN',
    });
    const deepSeekMessage = createMessageEnvelope({
      id: 'msg-r2-deepseek',
      debateId: debate.id,
      roundId: round2.id,
      senderId: coordinator.id,
      recipientIds: [deepSeek.id],
      kind: 'brief',
      body: 'ROUND 2 MESSAGE FOR DEEPSEEK',
    });
    const glmMessage = createMessageEnvelope({
      id: 'msg-r2-glm',
      debateId: debate.id,
      roundId: round2.id,
      senderId: coordinator.id,
      recipientIds: [glm.id],
      kind: 'brief',
      body: 'ROUND 2 MESSAGE FOR GLM',
    });

    const qwenDelivery = workflow.dispatch(round2.id, qwenMessage)[0];
    const deepSeekDelivery = workflow.dispatch(round2.id, deepSeekMessage)[0];
    const glmDelivery = workflow.dispatch(round2.id, glmMessage)[0];
    assert.ok(qwenDelivery);
    assert.ok(deepSeekDelivery);
    assert.ok(glmDelivery);

    const progress = workflow.getRoundProgress(round2.id);
    assert.equal(progress.expected, 3);
    assert.equal(progress.participants.length, 3);
    assert.deepEqual(
      progress.participants.flatMap((participant) => participant.deliveryIds),
      [qwenDelivery.id, deepSeekDelivery.id, glmDelivery.id],
    );
    assert.equal(
      progress.participants.find((p) => p.agentId === qwen.id)?.deliveryIds[0],
      qwenDelivery.id,
    );
    assert.notEqual(qwenDelivery.messageId, deepSeekDelivery.messageId);
    assert.notEqual(deepSeekDelivery.messageId, glmDelivery.messageId);
  });

  it('rejects invalid round execution actions', () => {
    const {
      workflow,
      coordinator,
      qwen,
      deepSeek,
      glm,
      coder,
      debate,
      round1,
    } = setup();

    assert.throws(
      () => workflow.startRound({ roundId: round1.id, participantIds: [] }),
      OrchestratorError,
    );
    assert.throws(
      () =>
        workflow.startRound({
          roundId: round1.id,
          participantIds: [qwen.id, qwen.id],
        }),
      OrchestratorError,
    );
    assert.throws(
      () =>
        workflow.startRound({
          roundId: round1.id,
          participantIds: ['watcher-missing'],
        }),
      OrchestratorError,
    );
    assert.throws(
      () =>
        workflow.startRound({
          roundId: 'round-missing',
          participantIds: [qwen.id],
        }),
      OrchestratorError,
    );

    workflow.startRound({
      roundId: round1.id,
      participantIds: [qwen.id, deepSeek.id, glm.id],
    });
    assert.throws(
      () =>
        workflow.startRound({
          roundId: round1.id,
          participantIds: [qwen.id, deepSeek.id, glm.id],
        }),
      OrchestratorError,
    );

    const otherDebateBrief = createMessageEnvelope({
      id: 'msg-wrong-debate',
      debateId: 'debate-other',
      roundId: round1.id,
      senderId: coordinator.id,
      recipientIds: [qwen.id],
      kind: 'brief',
      body: 'wrong debate',
    });
    assert.throws(
      () => workflow.dispatch(round1.id, otherDebateBrief),
      OrchestratorError,
    );

    const wrongRoundBrief = createMessageEnvelope({
      id: 'msg-wrong-round',
      debateId: debate.id,
      roundId: 'round-2',
      senderId: coordinator.id,
      recipientIds: [qwen.id],
      kind: 'brief',
      body: 'wrong round',
    });
    assert.throws(
      () => workflow.dispatch(round1.id, wrongRoundBrief),
      OrchestratorError,
    );

    const coderBrief = createMessageEnvelope({
      id: 'msg-non-participant',
      debateId: debate.id,
      roundId: round1.id,
      senderId: coordinator.id,
      recipientIds: [coder.id],
      kind: 'brief',
      body: 'Coder is not a participant',
    });
    assert.throws(
      () => workflow.dispatch(round1.id, coderBrief),
      OrchestratorError,
    );

    const brief = createMessageEnvelope({
      id: 'msg-brief-r1',
      debateId: debate.id,
      roundId: round1.id,
      senderId: coordinator.id,
      recipientIds: [qwen.id, deepSeek.id, glm.id],
      kind: 'brief',
      body: 'GLOBAL ROUND 1 MESSAGE',
    });
    const deliveries = workflow.dispatch(round1.id, brief);
    const qwenDelivery = deliveries.find((d) => d.recipientId === qwen.id);
    assert.ok(qwenDelivery);

    assert.throws(() => workflow.completeRound(round1.id), OrchestratorError);

    assert.throws(
      () =>
        workflow.submitResponse(round1.id, {
          deliveryId: 'delivery-not-in-round',
          responderId: coder.id,
          body: 'non-participant',
        }),
      OrchestratorError,
    );

    workflow.confirmDelivery(round1.id, qwenDelivery.id);
    assert.throws(
      () =>
        workflow.submitResponse(round1.id, {
          deliveryId: qwenDelivery.id,
          responderId: coder.id,
          body: 'Coder cannot answer for Qwen',
        }),
      Error,
    );
  });
});
