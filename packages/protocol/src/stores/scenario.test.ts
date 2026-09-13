import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createAgent } from '../agent.js';
import { createDebate } from '../debate.js';
import { createExposureRecord } from '../exposure.js';
import { createMessageEnvelope } from '../message.js';
import { createRound } from '../round.js';
import { InMemoryAgentRegistry } from './agent-registry.js';
import { InMemoryDebateStore } from './debate-store.js';
import { InMemoryExposureLedgerStore } from './exposure-store.js';
import { InMemoryMessageStore } from './message-store.js';
import { InMemoryRoundStore } from './round-store.js';

describe('in-memory protocol stores', () => {
  it('holds a Round 1 debate without inferring exposure or advancing state', () => {
    const agents = new InMemoryAgentRegistry();
    const debates = new InMemoryDebateStore();
    const rounds = new InMemoryRoundStore();
    const messages = new InMemoryMessageStore();
    const exposures = new InMemoryExposureLedgerStore();

    const debate = debates.create(
      createDebate({
        id: 'debate-1',
        topic: 'Transport fallback policy',
        status: 'pending',
      }),
    );

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

    const round1 = rounds.create(
      createRound({
        id: 'round-1',
        debateId: debate.id,
        number: 1,
        status: 'collecting',
      }),
    );

    const brief = messages.store(
      createMessageEnvelope({
        id: 'msg-brief-r1',
        debateId: debate.id,
        roundId: round1.id,
        senderId: coordinator.id,
        recipientIds: [qwen.id, deepSeek.id, glm.id],
        kind: 'brief',
        body: 'GLOBAL ROUND 1 MESSAGE',
      }),
    );

    exposures.record(
      createExposureRecord({
        id: 'exp-qwen-r1',
        agentId: qwen.id,
        debateId: debate.id,
        roundId: round1.id,
        messageId: brief.id,
      }),
    );
    exposures.record(
      createExposureRecord({
        id: 'exp-deepseek-r1',
        agentId: deepSeek.id,
        debateId: debate.id,
        roundId: round1.id,
        messageId: brief.id,
      }),
    );
    exposures.record(
      createExposureRecord({
        id: 'exp-glm-r1',
        agentId: glm.id,
        debateId: debate.id,
        roundId: round1.id,
        messageId: brief.id,
      }),
    );

    const qwenResponse = messages.store(
      createMessageEnvelope({
        id: 'msg-qwen-r1',
        debateId: debate.id,
        roundId: round1.id,
        senderId: qwen.id,
        recipientIds: [coordinator.id],
        kind: 'response',
        body: 'Qwen independent analysis',
      }),
    );
    const deepSeekResponse = messages.store(
      createMessageEnvelope({
        id: 'msg-deepseek-r1',
        debateId: debate.id,
        roundId: round1.id,
        senderId: deepSeek.id,
        recipientIds: [coordinator.id],
        kind: 'response',
        body: 'DeepSeek independent analysis',
      }),
    );
    const glmResponse = messages.store(
      createMessageEnvelope({
        id: 'msg-glm-r1',
        debateId: debate.id,
        roundId: round1.id,
        senderId: glm.id,
        recipientIds: [coordinator.id],
        kind: 'response',
        body: 'GLM independent analysis',
      }),
    );

    const architect = agents.register(
      createAgent({
        id: 'watcher-architect',
        name: 'Architect',
        role: 'watcher',
      }),
    );

    assert.equal(qwenResponse.senderId, qwen.id);
    assert.deepEqual(qwenResponse.recipientIds, [coordinator.id]);
    assert.equal(deepSeekResponse.senderId, deepSeek.id);
    assert.deepEqual(deepSeekResponse.recipientIds, [coordinator.id]);
    assert.equal(glmResponse.senderId, glm.id);
    assert.deepEqual(glmResponse.recipientIds, [coordinator.id]);

    assert.deepEqual(
      exposures.listByAgent(qwen.id).map((record) => record.messageId),
      [brief.id],
    );
    assert.deepEqual(
      exposures.listByAgent(deepSeek.id).map((record) => record.messageId),
      [brief.id],
    );
    assert.deepEqual(
      exposures.listByAgent(glm.id).map((record) => record.messageId),
      [brief.id],
    );

    assert.deepEqual(exposures.listByAgent(coder.id), []);
    assert.deepEqual(exposures.listByAgent(architect.id), []);

    assert.equal(messages.listByDebate(debate.id).length, 4);
    assert.deepEqual(brief.recipientIds, [qwen.id, deepSeek.id, glm.id]);
    assert.deepEqual(
      agents.listByRole('watcher').map((agent) => agent.name),
      ['Qwen', 'DeepSeek', 'GLM', 'Architect'],
    );
  });
});
