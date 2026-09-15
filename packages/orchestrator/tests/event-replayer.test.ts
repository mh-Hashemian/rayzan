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
import { InMemoryEventStore } from '@rayzan/storage';
import { BrowserTransport } from '@rayzan/transport';

import { EventReplayer, type ReplayTarget } from '../src/event-replayer.js';
import { Orchestrator } from '../src/orchestrator.js';
import { RoundWorkflow } from '../src/round-workflow.js';

const timestamp = new Date('2026-09-15T20:01:00.000Z');

function event(
  type: Event['type'],
  extra: {
    id: string;
    debateId?: string;
    roundId?: string;
    agentId?: string;
    payload?: unknown;
  },
): Event {
  return createEvent({
    id: extra.id,
    type,
    timestamp,
    ...(extra.debateId !== undefined ? { debateId: extra.debateId } : {}),
    ...(extra.roundId !== undefined ? { roundId: extra.roundId } : {}),
    ...(extra.agentId !== undefined ? { agentId: extra.agentId } : {}),
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
    orchestrator,
    workflow,
    target,
  };
}

const bootstrap: Event[] = [
  event('AGENT_REGISTERED', {
    id: 'e-op',
    agentId: 'operator',
    payload: { id: 'operator', name: 'Operator', role: 'operator' },
  }),
  event('AGENT_REGISTERED', {
    id: 'e-coord',
    agentId: 'deepseek',
    payload: { id: 'deepseek', name: 'DeepSeek', role: 'coordinator' },
  }),
  event('AGENT_REGISTERED', {
    id: 'e-qwen',
    agentId: 'qwen',
    payload: { id: 'qwen', name: 'Qwen', role: 'watcher' },
  }),
  event('AGENT_REGISTERED', {
    id: 'e-glm',
    agentId: 'glm',
    payload: { id: 'glm', name: 'GLM', role: 'watcher' },
  }),
  event('DEBATE_CREATED', {
    id: 'e-debate',
    debateId: 'debate-1',
    payload: { topic: 'SQLite or PostgreSQL?', status: 'active' },
  }),
  event('ROUND_CREATED', {
    id: 'e-round1',
    debateId: 'debate-1',
    roundId: 'round-1',
    payload: { number: 1, participantIds: ['qwen', 'glm'] },
  }),
];

describe('EventReplayer', () => {
  it('reconstructs agents, debate, and round', () => {
    const { agents, debates, rounds, target } = harness();
    const result = new EventReplayer().replay(bootstrap, target);
    assert.equal(result.status, 'RESTORED');
    assert.equal(agents.getById('qwen' as never)?.name, 'Qwen');
    assert.equal(debates.getById(asDebateId('debate-1'))?.topic, 'SQLite or PostgreSQL?');
    assert.equal(rounds.getById('round-1' as never)?.number, 1);
    assert.equal(result.agentsRestored, 4);
    assert.equal(result.debatesRestored, 1);
    assert.equal(result.roundsRestored, 1);
  });

  it('restores a message envelope exactly once', () => {
    const { messages, target } = harness();
    const events = [
      ...bootstrap,
      event('MESSAGE_CREATED', {
        id: 'e-msg',
        debateId: 'debate-1',
        roundId: 'round-1',
        agentId: 'deepseek',
        payload: {
          messageId: 'msg-brief',
          senderId: 'deepseek',
          recipientIds: ['qwen', 'glm'],
          kind: 'brief',
          body: 'Independent analysis.',
        },
      }),
    ];
    new EventReplayer().replay(events, target);
    const restored = messages.getById('msg-brief' as never);
    assert.equal(restored?.body, 'Independent analysis.');
    assert.deepEqual(restored?.recipientIds, ['qwen', 'glm']);
  });

  it('restores an exposure record', () => {
    const { exposures, target } = harness();
    const events = [
      ...bootstrap,
      event('MESSAGE_CREATED', {
        id: 'e-msg',
        debateId: 'debate-1',
        roundId: 'round-1',
        agentId: 'deepseek',
        payload: {
          messageId: 'msg-brief',
          senderId: 'deepseek',
          recipientIds: ['qwen'],
          kind: 'brief',
          body: 'Brief',
        },
      }),
      event('EXPOSURE_CREATED', {
        id: 'e-exp',
        debateId: 'debate-1',
        roundId: 'round-1',
        agentId: 'qwen',
        payload: {
          exposureId: 'exposure:del-1',
          messageId: 'msg-brief',
          agentId: 'qwen',
          referencedMessageIds: [],
        },
      }),
    ];
    new EventReplayer().replay(events, target);
    assert.equal(exposures.listByDebate(asDebateId('debate-1')).length, 1);
    assert.equal(
      exposures.listByDebate(asDebateId('debate-1'))[0]?.id,
      'exposure:del-1',
    );
  });

  it('marks a round completed', () => {
    const { rounds, workflow, target } = harness();
    const events = [
      ...bootstrap,
      event('ROUND_COMPLETED', {
        id: 'e-done',
        debateId: 'debate-1',
        roundId: 'round-1',
        payload: { number: 1, status: 'completed' },
      }),
    ];
    new EventReplayer().replay(events, target);
    assert.equal(rounds.getById('round-1' as never)?.status, 'completed');
    assert.equal(workflow.hasExecution('round-1'), true);
  });

  it('restores synthesis body and completes the debate', () => {
    const { debates, syntheses, target } = harness();
    const body = 'Final recommendation:\nStart with SQLite.';
    const events = [
      ...bootstrap,
      event('SYNTHESIS_CREATED', {
        id: 'e-syn',
        debateId: 'debate-1',
        agentId: 'deepseek',
        payload: {
          coordinatorId: 'deepseek',
          body,
          createdAt: '2026-09-15T20:10:00.000Z',
        },
      }),
    ];
    new EventReplayer().replay(events, target);
    assert.equal(syntheses.getByDebateId(asDebateId('debate-1'))?.body, body);
    assert.equal(debates.getById(asDebateId('debate-1'))?.status, 'completed');
  });

  it('replays identical timestamps in array/sequence order', () => {
    const { messages, target } = harness();
    const events = [
      ...bootstrap,
      event('MESSAGE_CREATED', {
        id: 'e-a',
        debateId: 'debate-1',
        agentId: 'qwen',
        payload: {
          messageId: 'msg-a',
          senderId: 'qwen',
          recipientIds: ['deepseek'],
          kind: 'response',
          body: 'first',
        },
      }),
      event('MESSAGE_CREATED', {
        id: 'e-b',
        debateId: 'debate-1',
        agentId: 'glm',
        payload: {
          messageId: 'msg-b',
          senderId: 'glm',
          recipientIds: ['deepseek'],
          kind: 'response',
          body: 'second',
        },
      }),
    ];
    new EventReplayer().replay(events, target);
    assert.deepEqual(
      messages.listByDebate(asDebateId('debate-1')).map((message) => message.id),
      ['msg-a', 'msg-b'],
    );
  });

  it('does not append events during replay', () => {
    const events = new InMemoryEventStore();
    for (const item of bootstrap) {
      events.append(item);
    }
    const before = events.listAll().length;
    const { target } = harness();
    new EventReplayer().replay(events.listAll(), target);
    assert.equal(events.listAll().length, before);
  });

  it('reconstructs the same state in two independent runtimes', () => {
    const events = [
      ...bootstrap,
      event('MESSAGE_CREATED', {
        id: 'e-msg',
        debateId: 'debate-1',
        roundId: 'round-1',
        agentId: 'deepseek',
        payload: {
          messageId: 'msg-brief',
          senderId: 'deepseek',
          recipientIds: ['qwen', 'glm'],
          kind: 'brief',
          body: 'Same brief',
        },
      }),
      event('SYNTHESIS_CREATED', {
        id: 'e-syn',
        debateId: 'debate-1',
        agentId: 'deepseek',
        payload: {
          coordinatorId: 'deepseek',
          body: 'Report',
          createdAt: '2026-09-15T20:10:00.000Z',
        },
      }),
    ];
    const a = harness();
    const b = harness();
    new EventReplayer().replay(events, a.target);
    new EventReplayer().replay(events, b.target);
    assert.deepEqual(
      a.agents.list().map((agent) => ({
        id: agent.id,
        name: agent.name,
        role: agent.role,
      })),
      b.agents.list().map((agent) => ({
        id: agent.id,
        name: agent.name,
        role: agent.role,
      })),
    );
    assert.equal(
      a.syntheses.getByDebateId(asDebateId('debate-1'))?.body,
      b.syntheses.getByDebateId(asDebateId('debate-1'))?.body,
    );
    assert.equal(
      a.messages.getById('msg-brief' as never)?.body,
      b.messages.getById('msg-brief' as never)?.body,
    );
  });

  it('treats historical events missing body as timeline-only warnings', () => {
    const { messages, target } = harness();
    const result = new EventReplayer().replay(
      [
        ...bootstrap,
        event('MESSAGE_CREATED', {
          id: 'e-old',
          debateId: 'debate-1',
          agentId: 'deepseek',
          payload: {
            messageId: 'msg-old',
            senderId: 'deepseek',
            recipientIds: ['qwen'],
            kind: 'brief',
          },
        }),
      ],
      target,
    );
    assert.equal(messages.getById('msg-old' as never), undefined);
    assert.equal(result.status, 'RESTORED_WITH_WARNINGS');
    assert.equal(
      result.warnings.some((warning) => warning.code === 'historical'),
      true,
    );
  });

  it('fails closed when ROUND_COMPLETED references an unknown round', () => {
    const { target } = harness();
    const result = new EventReplayer().replay(
      [
        ...bootstrap,
        event('ROUND_COMPLETED', {
          id: 'e-bad',
          debateId: 'debate-1',
          roundId: 'round-missing',
          payload: { number: 9 },
        }),
      ],
      target,
    );
    assert.equal(result.status, 'FAILED');
    assert.match(result.warnings[0]?.message ?? '', /unknown round/);
  });

  it('hydrates an unresolved delivery without making it live', () => {
    const { transport, target } = harness();
    const result = new EventReplayer().replay(
      [
        ...bootstrap,
        event('MESSAGE_CREATED', {
          id: 'e-msg',
          debateId: 'debate-1',
          roundId: 'round-1',
          agentId: 'deepseek',
          payload: {
            messageId: 'msg-brief',
            senderId: 'deepseek',
            recipientIds: ['qwen'],
            kind: 'brief',
            body: 'Brief',
          },
        }),
        event('DELIVERY_CREATED', {
          id: 'e-del',
          debateId: 'debate-1',
          roundId: 'round-1',
          agentId: 'qwen',
          payload: {
            deliveryId: 'del-1',
            messageId: 'msg-brief',
            senderId: 'deepseek',
            recipientId: 'qwen',
            status: 'pending',
            referencedMessageIds: [],
          },
        }),
      ],
      target,
    );
    assert.equal(transport.getDelivery('del-1' as never)?.status, 'pending');
    assert.equal(transport.listPending().length, 0);
    assert.equal(result.unresolvedDeliveries, 1);
    assert.equal(result.status, 'RESTORED_WITH_WARNINGS');
  });

  it('replays DEBATE_ARCHIVED onto the debate projection', () => {
    const { debates, target } = harness();
    new EventReplayer().replay(
      [
        ...bootstrap,
        event('DEBATE_ARCHIVED', {
          id: 'e-archive',
          debateId: 'debate-1',
          payload: { previousStatus: 'active', status: 'archived' },
        }),
      ],
      target,
    );
    assert.equal(debates.getById(asDebateId('debate-1'))?.status, 'archived');
  });
});
