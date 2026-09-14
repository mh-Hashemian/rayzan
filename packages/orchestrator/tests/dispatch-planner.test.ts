import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createAgent,
  createDebate,
  createRound,
  InMemoryAgentRegistry,
  InMemoryDebateStore,
  InMemoryExposureLedgerStore,
  InMemoryMessageStore,
  InMemoryRoundStore,
} from '@rayzan/protocol';
import { ManualTransport } from '@rayzan/transport';

import { createDispatchPlan } from '../src/dispatch-plan.js';
import { DispatchPlanner } from '../src/dispatch-planner.js';
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
  const planner = new DispatchPlanner(agents);

  const operator = agents.register(
    createAgent({
      id: 'operator',
      name: 'Operator',
      role: 'operator',
    }),
  );
  const deepSeekCoordinator = agents.register(
    createAgent({
      id: 'coordinator-deepseek',
      name: 'DeepSeek Coordinator',
      role: 'coordinator',
    }),
  );
  const chatGptCoordinator = agents.register(
    createAgent({
      id: 'coordinator-chatgpt',
      name: 'ChatGPT Coordinator',
      role: 'coordinator',
    }),
  );
  const qwen = agents.register(
    createAgent({ id: 'watcher-qwen', name: 'Qwen', role: 'watcher' }),
  );
  const deepSeek = agents.register(
    createAgent({
      id: 'watcher-deepseek',
      name: 'DeepSeek Reviewer',
      role: 'watcher',
    }),
  );
  const glm = agents.register(
    createAgent({ id: 'watcher-glm', name: 'GLM', role: 'watcher' }),
  );
  const extraWatcher = agents.register(
    createAgent({
      id: 'watcher-extra',
      name: 'Unused Watcher',
      role: 'watcher',
    }),
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
    planner,
    workflow,
    operator,
    deepSeekCoordinator,
    chatGptCoordinator,
    qwen,
    deepSeek,
    glm,
    extraWatcher,
    coder,
    debate,
    round1,
  };
}

describe('DispatchPlanner', () => {
  it("resolves round-watchers to this round's Watchers, not every Watcher", () => {
    const {
      planner,
      workflow,
      deepSeekCoordinator,
      qwen,
      deepSeek,
      glm,
      extraWatcher,
      coder,
      debate,
      round1,
    } = setup();

    workflow.startRound({
      roundId: round1.id,
      participantIds: [qwen.id, deepSeek.id, glm.id, coder.id],
    });

    const intent = planner.plan(
      createDispatchPlan({
        messageId: 'msg-brief-r1',
        debateId: debate.id,
        roundId: round1.id,
        senderId: deepSeekCoordinator.id,
        recipients: { type: 'round-watchers' },
        kind: 'brief',
        body: 'GLOBAL ROUND 1 MESSAGE',
        referencedMessageIds: [],
      }),
      { participantIds: workflow.getParticipantIds(round1.id) },
    );

    assert.deepEqual(intent.message.recipientIds, [
      qwen.id,
      deepSeek.id,
      glm.id,
    ]);
    assert.equal(intent.message.senderId, deepSeekCoordinator.id);
    assert.ok(!intent.message.recipientIds.includes(coder.id));
    assert.ok(!intent.message.recipientIds.includes(extraWatcher.id));
    assert.deepEqual(intent.referencedMessageIds, []);
  });

  it('resolves the same round-watchers plan for any Coordinator agent', () => {
    const { planner, qwen, deepSeek, glm, chatGptCoordinator, debate, round1 } =
      setup();

    const intent = planner.plan(
      createDispatchPlan({
        messageId: 'msg-brief-chatgpt',
        debateId: debate.id,
        roundId: round1.id,
        senderId: chatGptCoordinator.id,
        recipients: { type: 'round-watchers' },
        kind: 'brief',
        body: 'GLOBAL ROUND 1 MESSAGE',
        referencedMessageIds: [],
      }),
      { participantIds: [qwen.id, deepSeek.id, glm.id] },
    );

    assert.equal(intent.message.senderId, chatGptCoordinator.id);
    assert.deepEqual(intent.message.recipientIds, [
      qwen.id,
      deepSeek.id,
      glm.id,
    ]);
  });

  it('resolves explicit Operator → Coordinator and Coordinator → Coder plans', () => {
    const { planner, operator, deepSeekCoordinator, coder, debate } = setup();

    const toCoordinator = planner.plan(
      createDispatchPlan({
        messageId: 'msg-operator-input',
        debateId: debate.id,
        senderId: operator.id,
        recipients: {
          type: 'explicit-agents',
          agentIds: [deepSeekCoordinator.id],
        },
        kind: 'input',
        body: 'Please coordinate this debate',
        referencedMessageIds: [],
      }),
    );

    assert.equal(toCoordinator.message.senderId, operator.id);
    assert.deepEqual(toCoordinator.message.recipientIds, [
      deepSeekCoordinator.id,
    ]);

    const toCoder = planner.plan(
      createDispatchPlan({
        messageId: 'msg-coder-brief',
        debateId: debate.id,
        senderId: deepSeekCoordinator.id,
        recipients: { type: 'explicit-agents', agentIds: [coder.id] },
        kind: 'brief',
        body: 'Implement the agreed fallback',
        referencedMessageIds: [],
      }),
    );

    assert.equal(toCoder.message.senderId, deepSeekCoordinator.id);
    assert.deepEqual(toCoder.message.recipientIds, [coder.id]);
  });

  it('rejects invalid selectors, senders, and recipient lists', () => {
    const { planner, operator, qwen, deepSeek, glm, debate, round1 } = setup();

    assert.throws(
      () =>
        createDispatchPlan({
          messageId: 'msg-bad-selector',
          debateId: debate.id,
          senderId: operator.id,
          recipients: { type: 'all-watchers' },
          kind: 'brief',
          body: 'invalid alias',
          referencedMessageIds: [],
        }),
      OrchestratorError,
    );

    assert.throws(
      () =>
        createDispatchPlan({
          messageId: 'msg-empty-explicit',
          debateId: debate.id,
          senderId: operator.id,
          recipients: { type: 'explicit-agents', agentIds: [] },
          kind: 'brief',
          body: 'empty',
          referencedMessageIds: [],
        }),
      OrchestratorError,
    );

    assert.throws(
      () =>
        createDispatchPlan({
          messageId: 'msg-dup-explicit',
          debateId: debate.id,
          senderId: operator.id,
          recipients: { type: 'explicit-agents', agentIds: [qwen.id, qwen.id] },
          kind: 'brief',
          body: 'duplicate',
          referencedMessageIds: [],
        }),
      OrchestratorError,
    );

    assert.throws(
      () =>
        createDispatchPlan({
          messageId: 'msg-round-watchers-with-ids',
          debateId: debate.id,
          roundId: round1.id,
          senderId: operator.id,
          recipients: { type: 'round-watchers', agentIds: [qwen.id] },
          kind: 'brief',
          body: 'mixed selector',
          referencedMessageIds: [],
        }),
      OrchestratorError,
    );

    assert.throws(
      () =>
        planner.plan(
          createDispatchPlan({
            messageId: 'msg-unknown-sender',
            debateId: debate.id,
            senderId: 'agent-missing',
            recipients: { type: 'explicit-agents', agentIds: [qwen.id] },
            kind: 'brief',
            body: 'unknown sender',
            referencedMessageIds: [],
          }),
        ),
      OrchestratorError,
    );

    assert.throws(
      () =>
        planner.plan(
          createDispatchPlan({
            messageId: 'msg-unknown-recipient',
            debateId: debate.id,
            senderId: operator.id,
            recipients: {
              type: 'explicit-agents',
              agentIds: ['agent-missing'],
            },
            kind: 'brief',
            body: 'unknown recipient',
            referencedMessageIds: [],
          }),
        ),
      OrchestratorError,
    );

    assert.throws(
      () =>
        planner.plan(
          createDispatchPlan({
            messageId: 'msg-round-watchers-no-round',
            debateId: debate.id,
            senderId: operator.id,
            recipients: { type: 'round-watchers' },
            kind: 'brief',
            body: 'missing round',
            referencedMessageIds: [],
          }),
          { participantIds: [qwen.id, deepSeek.id, glm.id] },
        ),
      OrchestratorError,
    );

    assert.throws(
      () =>
        planner.plan(
          createDispatchPlan({
            messageId: 'msg-round-watchers-no-context',
            debateId: debate.id,
            roundId: round1.id,
            senderId: 'coordinator-deepseek',
            recipients: { type: 'round-watchers' },
            kind: 'brief',
            body: 'missing participants',
            referencedMessageIds: [],
          }),
        ),
      OrchestratorError,
    );

    assert.throws(
      () =>
        planner.plan(
          createDispatchPlan({
            messageId: 'msg-operator-round-watchers',
            debateId: debate.id,
            roundId: round1.id,
            senderId: operator.id,
            recipients: { type: 'round-watchers' },
            kind: 'brief',
            body: 'operator cannot use this selector',
            referencedMessageIds: [],
          }),
          { participantIds: [qwen.id, deepSeek.id, glm.id] },
        ),
      OrchestratorError,
    );

    assert.throws(
      () =>
        planner.plan(
          createDispatchPlan({
            messageId: 'msg-no-watchers',
            debateId: debate.id,
            roundId: round1.id,
            senderId: 'coordinator-deepseek',
            recipients: { type: 'round-watchers' },
            kind: 'brief',
            body: 'coder only',
            referencedMessageIds: [],
          }),
          { participantIds: ['coder'] },
        ),
      OrchestratorError,
    );
  });
});
