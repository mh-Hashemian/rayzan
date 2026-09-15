import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createEvent, type Event } from '@rayzan/events';
import {
  asDebateId,
  InMemoryAgentRegistry,
  InMemoryDebateStore,
  InMemoryExposureLedgerStore,
  InMemoryMessageStore,
  InMemoryRoundStore,
  InMemorySynthesisStore,
} from '@rayzan/protocol';
import { BrowserTransport } from '@rayzan/transport';

import { EventReplayer, type ReplayTarget } from '../src/event-replayer.js';
import { Orchestrator } from '../src/orchestrator.js';
import { RoundWorkflow } from '../src/round-workflow.js';

const TS = new Date('2026-09-15T21:00:00.000Z');

function ev(
  type: Event['type'],
  extra: {
    id: string;
    debateId?: string;
    roundId?: string;
    agentId?: string;
    causationEventId?: string;
    correlationId?: string;
    payload?: unknown;
    schemaVersion?: number;
  },
): Event {
  return createEvent({
    id: extra.id,
    type,
    timestamp: TS,
    schemaVersion: extra.schemaVersion ?? 1,
    ...(extra.debateId !== undefined ? { debateId: extra.debateId } : {}),
    ...(extra.roundId !== undefined ? { roundId: extra.roundId } : {}),
    ...(extra.agentId !== undefined ? { agentId: extra.agentId } : {}),
    ...(extra.causationEventId !== undefined
      ? { causationEventId: extra.causationEventId }
      : {}),
    ...(extra.correlationId !== undefined
      ? { correlationId: extra.correlationId }
      : {}),
    payload: extra.payload ?? {},
  });
}

function harness() {
  const agents = new InMemoryAgentRegistry();
  const debates = new InMemoryDebateStore();
  const rounds = new InMemoryRoundStore();
  const messages = new InMemoryMessageStore();
  const exposures = new InMemoryExposureLedgerStore();
  const syntheses = new InMemorySynthesisStore();
  const transport = new BrowserTransport();
  const orchestrator = new Orchestrator(messages, exposures, transport);
  const workflow = new RoundWorkflow(orchestrator, agents, debates, rounds);
  const target: ReplayTarget = {
    getAgent: (id) => agents.getById(id as never),
    registerAgent: (agent) => {
      agents.register(agent);
    },
    getDebate: (id) => debates.getById(id as never),
    createDebate: (debate) => {
      debates.create(debate);
    },
    updateDebate: (debate) => {
      debates.update(debate);
    },
    getRound: (id) => rounds.getById(id as never),
    createRound: (round) => {
      rounds.create(round);
    },
    updateRound: (round) => {
      rounds.update(round);
    },
    getMessage: (id) => messages.getById(id as never),
    storeMessage: (message) => {
      messages.store(message);
    },
    recordExposure: (record) => {
      exposures.record(record);
    },
    getSynthesis: (debateId) => syntheses.getByDebateId(debateId as never),
    storeSynthesis: (synthesis) => {
      syntheses.store(synthesis);
    },
    hydrateMessage: (message) => {
      transport.hydrateMessage(message);
    },
    hydrateDelivery: (delivery) => {
      transport.hydrateDelivery(delivery);
    },
    getDelivery: (id) => transport.getDelivery(id as never),
    setDeliveryStatus: (id, status) => {
      transport.setDeliveryStatus(id, status);
    },
    restoreRoundExecution: (roundId, participantIds) => {
      workflow.restoreExecution({ roundId, participantIds });
    },
    hasRoundExecution: (roundId) => workflow.hasExecution(roundId),
    noteRoundDelivery: (roundId, delivery) => {
      workflow.noteRestoredDelivery(roundId, delivery);
    },
    noteRoundConfirmed: (roundId, deliveryId) => {
      workflow.noteRestoredConfirmed(roundId, deliveryId);
    },
    noteRoundResponded: (roundId, deliveryId) => {
      workflow.noteRestoredResponded(roundId, deliveryId);
    },
    restoreRoundCompleted: (roundId) => {
      workflow.restoreCompleted(roundId);
    },
    restoreDeliveryReferences: (deliveryId, referencedMessageIds) => {
      orchestrator.restoreDeliveryReferences(
        deliveryId,
        referencedMessageIds as never,
      );
    },
    listDeliveries: () => transport.listAll(),
  };
  return {
    agents,
    debates,
    rounds,
    messages,
    exposures,
    syntheses,
    transport,
    target,
  };
}

const agentsAndDebate: Event[] = [
  ev('AGENT_REGISTERED', {
    id: 'e-op',
    agentId: 'operator',
    correlationId: 'agent:operator',
    payload: { id: 'operator', name: 'Operator', role: 'operator' },
  }),
  ev('AGENT_REGISTERED', {
    id: 'e-coord',
    agentId: 'deepseek',
    correlationId: 'agent:deepseek',
    payload: { id: 'deepseek', name: 'DeepSeek', role: 'coordinator' },
  }),
  ev('AGENT_REGISTERED', {
    id: 'e-qwen',
    agentId: 'qwen',
    correlationId: 'agent:qwen',
    payload: { id: 'qwen', name: 'Qwen', role: 'watcher' },
  }),
  ev('AGENT_REGISTERED', {
    id: 'e-glm',
    agentId: 'glm',
    correlationId: 'agent:glm',
    payload: { id: 'glm', name: 'GLM', role: 'watcher' },
  }),
  ev('DEBATE_CREATED', {
    id: 'e-debate',
    debateId: 'debate-1',
    correlationId: 'debate:debate-1',
    payload: { topic: 'SQLite or PostgreSQL?', status: 'active' },
  }),
  ev('ROUND_CREATED', {
    id: 'e-round1',
    debateId: 'debate-1',
    roundId: 'round-1',
    causationEventId: 'e-debate',
    correlationId: 'round:round-1',
    payload: { number: 1, participantIds: ['qwen', 'glm'] },
  }),
];

function deliveryChain(input: {
  prefix: string;
  deliveryId: string;
  messageId: string;
  senderId: string;
  recipientId: string;
  roundId: string;
  dispatchedId: string;
  responseBody: string;
}): Event[] {
  const corr = `delivery:${input.deliveryId}`;
  const created = `${input.prefix}-created`;
  const requested = `${input.prefix}-req`;
  const confirmed = `${input.prefix}-conf`;
  const promptOk = `${input.prefix}-prompt-ok`;
  const exposure = `${input.prefix}-exp`;
  const captureReq = `${input.prefix}-cap-req`;
  const responseMsg = `${input.prefix}-msg`;
  const captured = `${input.prefix}-cap`;
  return [
    ev('DELIVERY_CREATED', {
      id: created,
      debateId: 'debate-1',
      roundId: input.roundId,
      agentId: input.recipientId,
      causationEventId: input.dispatchedId,
      correlationId: corr,
      payload: {
        deliveryId: input.deliveryId,
        messageId: input.messageId,
        senderId: input.senderId,
        recipientId: input.recipientId,
        status: 'pending',
        referencedMessageIds: [],
      },
    }),
    ev('PROMPT_DISPATCH_REQUESTED', {
      id: requested,
      debateId: 'debate-1',
      roundId: input.roundId,
      agentId: input.recipientId,
      causationEventId: created,
      correlationId: corr,
      payload: {
        deliveryId: input.deliveryId,
        messageId: input.messageId,
        recipientId: input.recipientId,
        action: 'prompt-dispatch',
      },
    }),
    ev('DELIVERY_CONFIRMED', {
      id: confirmed,
      debateId: 'debate-1',
      roundId: input.roundId,
      agentId: input.recipientId,
      causationEventId: requested,
      correlationId: corr,
      payload: {
        deliveryId: input.deliveryId,
        messageId: input.messageId,
        recipientId: input.recipientId,
      },
    }),
    ev('PROMPT_DISPATCH_CONFIRMED', {
      id: promptOk,
      debateId: 'debate-1',
      roundId: input.roundId,
      agentId: input.recipientId,
      causationEventId: requested,
      correlationId: corr,
      payload: {
        deliveryId: input.deliveryId,
        recipientId: input.recipientId,
        action: 'prompt-dispatch',
      },
    }),
    ev('EXPOSURE_CREATED', {
      id: exposure,
      debateId: 'debate-1',
      roundId: input.roundId,
      agentId: input.recipientId,
      causationEventId: confirmed,
      correlationId: corr,
      payload: {
        exposureId: `exposure:${input.deliveryId}`,
        messageId: input.messageId,
        agentId: input.recipientId,
        referencedMessageIds: [],
      },
    }),
    ev('CAPTURE_REQUESTED', {
      id: captureReq,
      debateId: 'debate-1',
      roundId: input.roundId,
      agentId: input.recipientId,
      causationEventId: promptOk,
      correlationId: corr,
      payload: {
        deliveryId: input.deliveryId,
        recipientId: input.recipientId,
        action: 'capture',
      },
    }),
    ev('MESSAGE_CREATED', {
      id: responseMsg,
      debateId: 'debate-1',
      roundId: input.roundId,
      agentId: input.recipientId,
      causationEventId: captureReq,
      correlationId: corr,
      payload: {
        messageId: `${input.prefix}-body`,
        senderId: input.recipientId,
        recipientIds: [input.senderId],
        kind: 'response',
        body: input.responseBody,
      },
    }),
    ev('RESPONSE_CAPTURED', {
      id: captured,
      debateId: 'debate-1',
      roundId: input.roundId,
      agentId: input.recipientId,
      causationEventId: responseMsg,
      correlationId: corr,
      payload: {
        messageId: `${input.prefix}-body`,
        deliveryId: input.deliveryId,
        senderId: input.recipientId,
      },
    }),
  ];
}

const completedDebate: Event[] = [
  ...agentsAndDebate,
  ev('MESSAGE_CREATED', {
    id: 'e-brief',
    debateId: 'debate-1',
    roundId: 'round-1',
    agentId: 'deepseek',
    correlationId: 'message:msg-brief',
    payload: {
      messageId: 'msg-brief',
      senderId: 'deepseek',
      recipientIds: ['qwen', 'glm'],
      kind: 'brief',
      body: 'Independent Round 1 brief',
    },
  }),
  ev('MESSAGE_DISPATCHED', {
    id: 'e-brief-disp',
    debateId: 'debate-1',
    roundId: 'round-1',
    agentId: 'deepseek',
    causationEventId: 'e-brief',
    correlationId: 'message:msg-brief',
    payload: {
      messageId: 'msg-brief',
      senderId: 'deepseek',
      recipientIds: ['qwen', 'glm'],
      kind: 'brief',
      deliveryIds: ['del-qwen-r1', 'del-glm-r1'],
    },
  }),
  ...deliveryChain({
    prefix: 'qwen-r1',
    deliveryId: 'del-qwen-r1',
    messageId: 'msg-brief',
    senderId: 'deepseek',
    recipientId: 'qwen',
    roundId: 'round-1',
    dispatchedId: 'e-brief-disp',
    responseBody: 'Qwen: SQLite.',
  }),
  ...deliveryChain({
    prefix: 'glm-r1',
    deliveryId: 'del-glm-r1',
    messageId: 'msg-brief',
    senderId: 'deepseek',
    recipientId: 'glm',
    roundId: 'round-1',
    dispatchedId: 'e-brief-disp',
    responseBody: 'GLM: PostgreSQL.',
  }),
  ev('ROUND_COMPLETED', {
    id: 'e-r1-done',
    debateId: 'debate-1',
    roundId: 'round-1',
    causationEventId: 'glm-r1-cap',
    correlationId: 'round:round-1',
    payload: { number: 1, status: 'completed' },
  }),
  ev('ROUND_CREATED', {
    id: 'e-round2',
    debateId: 'debate-1',
    roundId: 'round-2',
    causationEventId: 'e-r1-done',
    correlationId: 'round:round-2',
    payload: { number: 2, participantIds: ['qwen', 'glm'] },
  }),
  ev('MESSAGE_CREATED', {
    id: 'e-r2',
    debateId: 'debate-1',
    roundId: 'round-2',
    agentId: 'deepseek',
    correlationId: 'message:msg-r2',
    payload: {
      messageId: 'msg-r2',
      senderId: 'deepseek',
      recipientIds: ['qwen', 'glm'],
      kind: 'query',
      body: 'Round 2 challenges',
    },
  }),
  ev('MESSAGE_DISPATCHED', {
    id: 'e-r2-disp',
    debateId: 'debate-1',
    roundId: 'round-2',
    agentId: 'deepseek',
    causationEventId: 'e-r2',
    correlationId: 'message:msg-r2',
    payload: {
      messageId: 'msg-r2',
      senderId: 'deepseek',
      recipientIds: ['qwen', 'glm'],
      kind: 'query',
      deliveryIds: ['del-qwen-r2', 'del-glm-r2'],
    },
  }),
  ...deliveryChain({
    prefix: 'qwen-r2',
    deliveryId: 'del-qwen-r2',
    messageId: 'msg-r2',
    senderId: 'deepseek',
    recipientId: 'qwen',
    roundId: 'round-2',
    dispatchedId: 'e-r2-disp',
    responseBody: 'Qwen Round 2: SQLite with WAL.',
  }),
  ...deliveryChain({
    prefix: 'glm-r2',
    deliveryId: 'del-glm-r2',
    messageId: 'msg-r2',
    senderId: 'deepseek',
    recipientId: 'glm',
    roundId: 'round-2',
    dispatchedId: 'e-r2-disp',
    responseBody: 'GLM Round 2: PostgreSQL managed.',
  }),
  ev('ROUND_COMPLETED', {
    id: 'e-r2-done',
    debateId: 'debate-1',
    roundId: 'round-2',
    causationEventId: 'glm-r2-cap',
    correlationId: 'round:round-2',
    payload: { number: 2, status: 'completed' },
  }),
  ev('SYNTHESIS_CREATED', {
    id: 'e-syn',
    debateId: 'debate-1',
    agentId: 'deepseek',
    causationEventId: 'e-r2-done',
    correlationId: 'debate:debate-1',
    payload: {
      coordinatorId: 'deepseek',
      body: 'Final recommendation:\nStart with SQLite.',
      createdAt: '2026-09-15T21:30:00.000Z',
    },
  }),
];

const interruptedPrompt: Event[] = [
  ...agentsAndDebate,
  ev('MESSAGE_CREATED', {
    id: 'e-msg',
    debateId: 'debate-1',
    roundId: 'round-1',
    agentId: 'deepseek',
    correlationId: 'message:msg-brief',
    payload: {
      messageId: 'msg-brief',
      senderId: 'deepseek',
      recipientIds: ['qwen'],
      kind: 'brief',
      body: 'Brief',
    },
  }),
  ev('PROMPT_DISPATCH_REQUESTED', {
    id: 'e-req',
    debateId: 'debate-1',
    roundId: 'round-1',
    agentId: 'qwen',
    causationEventId: 'e-msg',
    correlationId: 'delivery:del-1',
    payload: {
      deliveryId: 'del-1',
      messageId: 'msg-brief',
      recipientId: 'qwen',
      action: 'prompt-dispatch',
    },
  }),
];

const confirmedPrompt: Event[] = [
  ...interruptedPrompt,
  ev('PROMPT_DISPATCH_CONFIRMED', {
    id: 'e-ok',
    debateId: 'debate-1',
    roundId: 'round-1',
    agentId: 'qwen',
    causationEventId: 'e-req',
    correlationId: 'delivery:del-1',
    payload: {
      deliveryId: 'del-1',
      recipientId: 'qwen',
      action: 'prompt-dispatch',
    },
  }),
];

const failedCapture: Event[] = [
  ...agentsAndDebate,
  ev('CAPTURE_REQUESTED', {
    id: 'e-cap-req',
    debateId: 'debate-1',
    roundId: 'round-1',
    agentId: 'qwen',
    correlationId: 'delivery:del-cap',
    payload: {
      deliveryId: 'del-cap',
      recipientId: 'qwen',
      action: 'capture',
    },
  }),
  ev('CAPTURE_FAILED', {
    id: 'e-cap-fail',
    debateId: 'debate-1',
    roundId: 'round-1',
    agentId: 'qwen',
    causationEventId: 'e-cap-req',
    correlationId: 'delivery:del-cap',
    payload: {
      deliveryId: 'del-cap',
      recipientId: 'qwen',
      action: 'capture',
      reason: 'tracked-turn-disappeared',
    },
  }),
];

describe('golden event replay fixtures', () => {
  it('replays a completed debate to the same reconstructed state twice', () => {
    const first = harness();
    const second = harness();
    const a = new EventReplayer().replay(completedDebate, first.target);
    const b = new EventReplayer().replay(completedDebate, second.target);
    assert.equal(a.status, 'RESTORED');
    assert.equal(b.status, 'RESTORED');
    assert.equal(a.unresolvedExternalActions, 0);
    assert.equal(
      first.syntheses.getByDebateId(asDebateId('debate-1'))?.body,
      'Final recommendation:\nStart with SQLite.',
    );
    assert.equal(
      first.messages.getById('qwen-r1-body' as never)?.body,
      'Qwen: SQLite.',
    );
    assert.equal(first.rounds.getById('round-1' as never)?.status, 'completed');
    assert.equal(first.rounds.getById('round-2' as never)?.status, 'completed');
    assert.equal(first.debates.getById(asDebateId('debate-1'))?.status, 'completed');
    assert.equal(first.transport.listPending().length, 0);
    assert.deepEqual(
      first.agents.list().map((agent) => agent.id).sort(),
      second.agents.list().map((agent) => agent.id).sort(),
    );
    assert.equal(
      first.syntheses.getByDebateId(asDebateId('debate-1'))?.body,
      second.syntheses.getByDebateId(asDebateId('debate-1'))?.body,
    );
  });

  it('classifies REQUESTED-without-terminal as IN_DOUBT and does not resend', () => {
    const { transport, target } = harness();
    const result = new EventReplayer().replay(interruptedPrompt, target);
    assert.equal(result.unresolvedExternalActions, 1);
    assert.equal(result.externalActions[0]?.state, 'IN_DOUBT');
    assert.equal(result.externalActions[0]?.action, 'prompt-dispatch');
    assert.match(result.externalActions[0]?.reason ?? '', /no confirmed\/failed/);
    assert.equal(transport.listPending().length, 0);
    assert.equal(result.status, 'RESTORED_WITH_WARNINGS');
  });

  it('classifies a confirmed prompt dispatch as not unresolved', () => {
    const { target } = harness();
    const result = new EventReplayer().replay(confirmedPrompt, target);
    const prompt = result.externalActions.find(
      (action) => action.action === 'prompt-dispatch',
    );
    assert.equal(prompt?.state, 'confirmed');
    assert.equal(result.unresolvedExternalActions, 0);
  });

  it('classifies a failed capture as failed and does not retry it', () => {
    const { transport, target } = harness();
    const result = new EventReplayer().replay(failedCapture, target);
    const capture = result.externalActions.find(
      (action) => action.action === 'capture',
    );
    assert.equal(capture?.state, 'failed');
    assert.equal(result.unresolvedExternalActions, 0);
    assert.equal(transport.listPending().length, 0);
  });
});
