import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  asMessageId,
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

import { CoordinatorCommandExecutor } from '../src/coordinator-command-executor.js';
import { parseCoordinatorCommandBatch } from '../src/coordinator-command-parser.js';
import { createCoordinatorExecutionContext } from '../src/coordinator-execution-context.js';
import { createDispatchPlan } from '../src/dispatch-plan.js';
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
  const executor = new CoordinatorCommandExecutor(
    agents,
    debates,
    rounds,
    workflow,
    orchestrator,
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
  const coder = agents.register(
    createAgent({ id: 'coder', name: 'Coder', role: 'coder' }),
  );

  const debate = debates.create(
    createDebate({
      id: 'debate-1',
      topic: 'Transport fallback policy',
      status: 'active',
    }),
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
    executor,
    deepSeekCoordinator,
    chatGptCoordinator,
    qwen,
    deepSeek,
    glm,
    coder,
    debate,
    round1,
  };
}

function contextFor(coordinatorId: string, debateId: string) {
  return createCoordinatorExecutionContext({ coordinatorId, debateId });
}

function collectRound(
  workflow: RoundWorkflow,
  roundId: string,
  plan: ReturnType<typeof createDispatchPlan>,
  participantIds: readonly string[],
) {
  workflow.startRound({ roundId, participantIds });
  const deliveries = workflow.dispatchPlan(roundId, plan);
  for (const delivery of deliveries) {
    workflow.confirmDelivery(roundId, delivery.id);
    workflow.submitResponse(roundId, {
      deliveryId: delivery.id,
      responderId: delivery.recipientId,
      body: `${delivery.recipientId} response`,
    });
  }
}

describe('CoordinatorCommandExecutor', () => {
  it('dispatches a Coordinator round-watchers command to the round participants', () => {
    const {
      executor,
      workflow,
      transport,
      deepSeekCoordinator,
      chatGptCoordinator,
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

    const batch = parseCoordinatorCommandBatch(`{
  "version": 1,
  "commands": [
    {
      "type": "dispatch",
      "messageId": "round1-brief",
      "debateId": "debate-1",
      "roundId": "round-1",
      "recipients": {
        "type": "round-watchers"
      },
      "kind": "brief",
      "body": "Analyze independently.",
      "referencedMessageIds": []
    }
  ]
}`);

    const result = executor.execute(
      contextFor(deepSeekCoordinator.id, debate.id),
      batch,
    );

    assert.equal(result.results.length, 1);
    const dispatch = result.results[0];
    assert.equal(dispatch?.type, 'dispatch');
    assert.equal(dispatch.senderId, deepSeekCoordinator.id);
    assert.notEqual(dispatch.senderId, chatGptCoordinator.id);
    assert.deepEqual(dispatch.recipientIds, [qwen.id, deepSeek.id, glm.id]);
    assert.equal(dispatch.deliveries.length, 3);
    assert.ok(
      dispatch.deliveries.every((delivery) => delivery.status === 'pending'),
    );
    assert.ok(
      dispatch.deliveries.every(
        (delivery) => delivery.senderId === deepSeekCoordinator.id,
      ),
    );
    assert.equal(transport.listPending().length, 3);
  });

  it('binds the canonical sender from trusted context, not command JSON', () => {
    const {
      executor,
      workflow,
      messages,
      deepSeekCoordinator,
      chatGptCoordinator,
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

    const batch = parseCoordinatorCommandBatch(
      JSON.stringify({
        version: 1,
        commands: [
          {
            type: 'dispatch',
            messageId: 'round1-brief',
            debateId: debate.id,
            roundId: round1.id,
            recipients: { type: 'round-watchers' },
            kind: 'brief',
            body: 'Analyze independently.',
            referencedMessageIds: [],
          },
        ],
      }),
    );

    executor.execute(contextFor(chatGptCoordinator.id, debate.id), batch);

    const message = messages.getById(asMessageId('round1-brief'));
    assert.equal(message?.senderId, chatGptCoordinator.id);
    assert.notEqual(message?.senderId, deepSeekCoordinator.id);
  });

  it('executes the same command format for DeepSeek and ChatGPT Coordinators', () => {
    const {
      executor,
      workflow,
      debates,
      rounds,
      chatGptCoordinator,
      qwen,
      deepSeek,
      glm,
    } = setup();

    const debate2 = debates.create(
      createDebate({
        id: 'debate-2',
        topic: 'Second coordinator debate',
        status: 'active',
      }),
    );
    const roundA = rounds.create(
      createRound({ id: 'round-a', debateId: debate2.id, number: 1 }),
    );
    workflow.startRound({
      roundId: roundA.id,
      participantIds: [qwen.id, deepSeek.id, glm.id],
    });

    const result = executor.execute(
      contextFor(chatGptCoordinator.id, debate2.id),
      parseCoordinatorCommandBatch(
        JSON.stringify({
          version: 1,
          commands: [
            {
              type: 'dispatch',
              messageId: 'debate2-brief',
              debateId: debate2.id,
              roundId: roundA.id,
              recipients: { type: 'round-watchers' },
              kind: 'brief',
              body: 'Analyze independently.',
              referencedMessageIds: [],
            },
          ],
        }),
      ),
    );

    assert.equal(result.results[0]?.type, 'dispatch');
    assert.equal(result.results[0]?.senderId, chatGptCoordinator.id);
  });

  it('executes an ordered Round 2 personalized dispatch batch without completing the round', () => {
    const {
      executor,
      workflow,
      messages,
      exposures,
      rounds,
      deepSeekCoordinator,
      qwen,
      deepSeek,
      glm,
      debate,
    } = setup();

    messages.store(
      createMessageEnvelope({
        id: 'msg-qwen-r1',
        debateId: debate.id,
        senderId: qwen.id,
        recipientIds: [deepSeekCoordinator.id],
        kind: 'response',
        body: 'Qwen analysis',
      }),
    );
    messages.store(
      createMessageEnvelope({
        id: 'msg-deepseek-r1',
        debateId: debate.id,
        senderId: deepSeek.id,
        recipientIds: [deepSeekCoordinator.id],
        kind: 'response',
        body: 'DeepSeek analysis',
      }),
    );
    messages.store(
      createMessageEnvelope({
        id: 'msg-glm-r1',
        debateId: debate.id,
        senderId: glm.id,
        recipientIds: [deepSeekCoordinator.id],
        kind: 'response',
        body: 'GLM analysis',
      }),
    );

    const round2 = rounds.create(
      createRound({ id: 'round-2', debateId: debate.id, number: 2 }),
    );
    workflow.startRound({
      roundId: round2.id,
      participantIds: [qwen.id, deepSeek.id, glm.id],
    });

    const result = executor.execute(
      contextFor(deepSeekCoordinator.id, debate.id),
      parseCoordinatorCommandBatch(
        JSON.stringify({
          version: 1,
          commands: [
            {
              type: 'dispatch',
              messageId: 'msg-r2-qwen',
              debateId: debate.id,
              roundId: round2.id,
              recipients: {
                type: 'explicit-agents',
                agentIds: [qwen.id],
              },
              kind: 'brief',
              body: 'ROUND 2 MESSAGE FOR QWEN',
              referencedMessageIds: ['msg-deepseek-r1', 'msg-glm-r1'],
            },
            {
              type: 'dispatch',
              messageId: 'msg-r2-deepseek',
              debateId: debate.id,
              roundId: round2.id,
              recipients: {
                type: 'explicit-agents',
                agentIds: [deepSeek.id],
              },
              kind: 'brief',
              body: 'ROUND 2 MESSAGE FOR DEEPSEEK',
              referencedMessageIds: ['msg-qwen-r1', 'msg-glm-r1'],
            },
            {
              type: 'dispatch',
              messageId: 'msg-r2-glm',
              debateId: debate.id,
              roundId: round2.id,
              recipients: {
                type: 'explicit-agents',
                agentIds: [glm.id],
              },
              kind: 'brief',
              body: 'ROUND 2 MESSAGE FOR GLM',
              referencedMessageIds: ['msg-qwen-r1', 'msg-deepseek-r1'],
            },
          ],
        }),
      ),
    );

    assert.equal(result.results.length, 3);
    assert.deepEqual(
      result.results.map((item) => item.type),
      ['dispatch', 'dispatch', 'dispatch'],
    );
    assert.ok(
      result.results.every(
        (item) =>
          item.type === 'dispatch' && item.senderId === deepSeekCoordinator.id,
      ),
    );
    assert.ok(messages.getById(asMessageId('msg-r2-qwen')));
    assert.ok(messages.getById(asMessageId('msg-r2-deepseek')));
    assert.ok(messages.getById(asMessageId('msg-r2-glm')));

    for (const item of result.results) {
      assert.equal(item.type, 'dispatch');
      workflow.confirmDelivery(round2.id, item.deliveries[0]!.id);
    }

    assert.deepEqual(
      exposures.listByAgentInRound(qwen.id, round2.id)[0]?.referencedMessageIds,
      ['msg-deepseek-r1', 'msg-glm-r1'],
    );
    assert.deepEqual(
      exposures.listByAgentInRound(deepSeek.id, round2.id)[0]
        ?.referencedMessageIds,
      ['msg-qwen-r1', 'msg-glm-r1'],
    );
    assert.deepEqual(
      exposures.listByAgentInRound(glm.id, round2.id)[0]?.referencedMessageIds,
      ['msg-qwen-r1', 'msg-deepseek-r1'],
    );
    assert.equal(workflow.getRoundProgress(round2.id).complete, false);
    assert.equal(workflow.getRoundProgress(round2.id).status, 'collecting');
    assert.equal(rounds.listByDebate(debate.id).length, 2);
  });

  it('dispatches Coordinator to Coder outside a round', () => {
    const {
      executor,
      workflow,
      messages,
      deepSeekCoordinator,
      qwen,
      deepSeek,
      glm,
      coder,
      debate,
      round1,
    } = setup();

    workflow.startRound({
      roundId: round1.id,
      participantIds: [qwen.id, deepSeek.id, glm.id],
    });

    const result = executor.execute(
      contextFor(deepSeekCoordinator.id, debate.id),
      parseCoordinatorCommandBatch(
        JSON.stringify({
          version: 1,
          commands: [
            {
              type: 'dispatch',
              messageId: 'msg-coder-brief',
              debateId: debate.id,
              recipients: {
                type: 'explicit-agents',
                agentIds: [coder.id],
              },
              kind: 'brief',
              body: 'Implement the agreed fallback.',
              referencedMessageIds: [],
            },
          ],
        }),
      ),
    );

    assert.equal(result.results[0]?.type, 'dispatch');
    assert.equal(result.results[0].roundId, undefined);
    assert.deepEqual(result.results[0].recipientIds, [coder.id]);
    assert.equal(
      messages.getById(asMessageId('msg-coder-brief'))?.senderId,
      deepSeekCoordinator.id,
    );
    assert.deepEqual(
      workflow
        .getRoundProgress(round1.id)
        .participants.flatMap((participant) => participant.deliveryIds),
      [],
    );
  });

  it('completes a round and finalizes the debate without creating another round', () => {
    const {
      executor,
      workflow,
      debates,
      rounds,
      deepSeekCoordinator,
      qwen,
      deepSeek,
      glm,
      debate,
      round1,
    } = setup();

    collectRound(
      workflow,
      round1.id,
      createDispatchPlan({
        messageId: 'msg-r1-brief',
        debateId: debate.id,
        roundId: round1.id,
        senderId: deepSeekCoordinator.id,
        recipients: { type: 'round-watchers' },
        kind: 'brief',
        body: 'Round 1 brief',
        referencedMessageIds: [],
      }),
      [qwen.id, deepSeek.id, glm.id],
    );
    workflow.completeRound(round1.id);

    const round2 = rounds.create(
      createRound({ id: 'round-2', debateId: debate.id, number: 2 }),
    );
    collectRound(
      workflow,
      round2.id,
      createDispatchPlan({
        messageId: 'msg-r2-brief',
        debateId: debate.id,
        roundId: round2.id,
        senderId: deepSeekCoordinator.id,
        recipients: { type: 'round-watchers' },
        kind: 'brief',
        body: 'Round 2 brief',
        referencedMessageIds: [],
      }),
      [qwen.id, deepSeek.id, glm.id],
    );

    const result = executor.execute(
      contextFor(deepSeekCoordinator.id, debate.id),
      parseCoordinatorCommandBatch(`{
  "version": 1,
  "commands": [
    {
      "type": "complete-round",
      "debateId": "debate-1",
      "roundId": "round-2"
    },
    {
      "type": "finalize-debate",
      "debateId": "debate-1",
      "body": "Final synthesis..."
    }
  ]
}`),
    );

    assert.deepEqual(result.results, [
      {
        type: 'complete-round',
        debateId: debate.id,
        roundId: round2.id,
        status: 'completed',
      },
      {
        type: 'finalize-debate',
        debateId: debate.id,
        body: 'Final synthesis...',
        status: 'completed',
      },
    ]);
    assert.equal(rounds.getById(round2.id)?.status, 'completed');
    assert.equal(debates.getById(debate.id)?.status, 'completed');
    assert.equal(rounds.listByDebate(debate.id).length, 2);
    assert.ok(
      !rounds.listByDebate(debate.id).some((round) => round.number === 3),
    );
  });

  it('rejects invalid trusted context, debate scope, and finalize ordering before side effects', () => {
    const {
      executor,
      workflow,
      transport,
      debates,
      qwen,
      deepSeek,
      glm,
      coder,
      debate,
      round1,
    } = setup();

    workflow.startRound({
      roundId: round1.id,
      participantIds: [qwen.id, deepSeek.id, glm.id],
    });

    const dispatchBatch = parseCoordinatorCommandBatch(
      JSON.stringify({
        version: 1,
        commands: [
          {
            type: 'dispatch',
            messageId: 'round1-brief',
            debateId: debate.id,
            roundId: round1.id,
            recipients: { type: 'round-watchers' },
            kind: 'brief',
            body: 'Analyze independently.',
            referencedMessageIds: [],
          },
        ],
      }),
    );

    assert.throws(
      () =>
        executor.execute(
          contextFor('coordinator-missing', debate.id),
          dispatchBatch,
        ),
      OrchestratorError,
    );
    assert.throws(
      () => executor.execute(contextFor(qwen.id, debate.id), dispatchBatch),
      OrchestratorError,
    );
    assert.throws(
      () => executor.execute(contextFor(coder.id, debate.id), dispatchBatch),
      OrchestratorError,
    );
    assert.equal(transport.listPending().length, 0);

    const otherDebate = debates.create(
      createDebate({
        id: 'debate-2',
        topic: 'Other debate',
        status: 'active',
      }),
    );
    const crossDebate = parseCoordinatorCommandBatch(
      JSON.stringify({
        version: 1,
        commands: [
          {
            type: 'dispatch',
            messageId: 'cross-debate',
            debateId: otherDebate.id,
            roundId: round1.id,
            recipients: { type: 'round-watchers' },
            kind: 'brief',
            body: 'Wrong debate.',
            referencedMessageIds: [],
          },
        ],
      }),
    );
    assert.throws(
      () =>
        executor.execute(
          contextFor('coordinator-deepseek', debate.id),
          crossDebate,
        ),
      OrchestratorError,
    );
    assert.equal(transport.listPending().length, 0);

    const finalizeThenDispatch = parseCoordinatorCommandBatch(
      JSON.stringify({
        version: 1,
        commands: [
          {
            type: 'finalize-debate',
            debateId: debate.id,
            body: 'Too early.',
          },
          {
            type: 'dispatch',
            messageId: 'after-finalize',
            debateId: debate.id,
            roundId: round1.id,
            recipients: { type: 'round-watchers' },
            kind: 'brief',
            body: 'Should not run.',
            referencedMessageIds: [],
          },
        ],
      }),
    );
    assert.throws(
      () =>
        executor.execute(
          contextFor('coordinator-deepseek', debate.id),
          finalizeThenDispatch,
        ),
      OrchestratorError,
    );
    assert.equal(transport.listPending().length, 0);
    assert.equal(debates.getById(debate.id)?.status, 'active');

    const multipleFinalize = parseCoordinatorCommandBatch(
      JSON.stringify({
        version: 1,
        commands: [
          {
            type: 'finalize-debate',
            debateId: debate.id,
            body: 'First.',
          },
          {
            type: 'finalize-debate',
            debateId: debate.id,
            body: 'Second.',
          },
        ],
      }),
    );
    assert.throws(
      () =>
        executor.execute(
          contextFor('coordinator-deepseek', debate.id),
          multipleFinalize,
        ),
      OrchestratorError,
    );
    assert.equal(debates.getById(debate.id)?.status, 'active');
  });

  it('rejects incomplete rounds, non-participants, and invalid dispatch during execution', () => {
    const {
      executor,
      workflow,
      messages,
      debates,
      rounds,
      deepSeekCoordinator,
      qwen,
      deepSeek,
      glm,
      coder,
      debate,
      round1,
    } = setup();

    workflow.startRound({
      roundId: round1.id,
      participantIds: [qwen.id, deepSeek.id, glm.id],
    });

    assert.throws(
      () =>
        executor.execute(
          contextFor(deepSeekCoordinator.id, debate.id),
          parseCoordinatorCommandBatch(
            JSON.stringify({
              version: 1,
              commands: [
                {
                  type: 'dispatch',
                  messageId: 'msg-coder-in-round',
                  debateId: debate.id,
                  roundId: round1.id,
                  recipients: {
                    type: 'explicit-agents',
                    agentIds: [coder.id],
                  },
                  kind: 'brief',
                  body: 'Coder is not a participant.',
                  referencedMessageIds: [],
                },
              ],
            }),
          ),
        ),
      OrchestratorError,
    );

    assert.throws(
      () =>
        executor.execute(
          contextFor(deepSeekCoordinator.id, debate.id),
          parseCoordinatorCommandBatch(
            JSON.stringify({
              version: 1,
              commands: [
                {
                  type: 'complete-round',
                  debateId: debate.id,
                  roundId: round1.id,
                },
              ],
            }),
          ),
        ),
      OrchestratorError,
    );

    assert.throws(
      () =>
        executor.execute(
          contextFor(deepSeekCoordinator.id, debate.id),
          parseCoordinatorCommandBatch(
            JSON.stringify({
              version: 1,
              commands: [
                {
                  type: 'finalize-debate',
                  debateId: debate.id,
                  body: 'Round still open.',
                },
              ],
            }),
          ),
        ),
      OrchestratorError,
    );
    assert.equal(debates.getById(debate.id)?.status, 'active');

    assert.throws(
      () =>
        executor.execute(
          contextFor(deepSeekCoordinator.id, debate.id),
          parseCoordinatorCommandBatch(
            JSON.stringify({
              version: 1,
              commands: [
                {
                  type: 'dispatch',
                  messageId: 'round1-brief',
                  debateId: debate.id,
                  roundId: round1.id,
                  recipients: { type: 'round-watchers' },
                  kind: 'brief',
                  body: 'Analyze independently.',
                  referencedMessageIds: [],
                },
                {
                  type: 'dispatch',
                  messageId: 'msg-unknown-recipient',
                  debateId: debate.id,
                  recipients: {
                    type: 'explicit-agents',
                    agentIds: ['agent-missing'],
                  },
                  kind: 'brief',
                  body: 'Unknown recipient.',
                  referencedMessageIds: [],
                },
              ],
            }),
          ),
        ),
      OrchestratorError,
    );
    assert.ok(messages.getById(asMessageId('round1-brief')));
    assert.equal(
      messages.getById(asMessageId('msg-unknown-recipient')),
      undefined,
    );

    const progress = workflow.getRoundProgress(round1.id);
    for (const participant of progress.participants) {
      for (const deliveryId of participant.deliveryIds) {
        workflow.confirmDelivery(round1.id, deliveryId);
        workflow.submitResponse(round1.id, {
          deliveryId,
          responderId: participant.agentId,
          body: `${participant.agentId} response`,
        });
      }
    }
    workflow.completeRound(round1.id);

    executor.execute(
      contextFor(deepSeekCoordinator.id, debate.id),
      parseCoordinatorCommandBatch(
        JSON.stringify({
          version: 1,
          commands: [
            {
              type: 'finalize-debate',
              debateId: debate.id,
              body: 'Done.',
            },
          ],
        }),
      ),
    );
    assert.equal(debates.getById(debate.id)?.status, 'completed');
    assert.throws(
      () =>
        executor.execute(
          contextFor(deepSeekCoordinator.id, debate.id),
          parseCoordinatorCommandBatch(
            JSON.stringify({
              version: 1,
              commands: [
                {
                  type: 'finalize-debate',
                  debateId: debate.id,
                  body: 'Again.',
                },
              ],
            }),
          ),
        ),
      OrchestratorError,
    );
    assert.equal(rounds.listByDebate(debate.id).length, 1);
  });
});
