import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseCoordinatorCommandBatch } from '../src/coordinator-command-parser.js';
import { OrchestratorError } from '../src/error.js';

describe('parseCoordinatorCommandBatch', () => {
  it('parses a Round 1 dispatch command without executing it', () => {
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
      "body": "Analyze the problem independently.",
      "referencedMessageIds": []
    }
  ]
}`);

    assert.equal(batch.version, 1);
    assert.equal(batch.commands.length, 1);
    assert.deepEqual(batch.commands[0], {
      type: 'dispatch',
      messageId: 'round1-brief',
      debateId: 'debate-1',
      roundId: 'round-1',
      recipients: { type: 'round-watchers' },
      kind: 'brief',
      body: 'Analyze the problem independently.',
      referencedMessageIds: [],
    });
  });

  it('treats omitted referencedMessageIds as an empty list', () => {
    const batch = parseCoordinatorCommandBatch(`{
  "version": 1,
  "commands": [
    {
      "type": "dispatch",
      "messageId": "round1-brief",
      "debateId": "debate-1",
      "roundId": "round-1",
      "recipients": { "type": "round-watchers" },
      "kind": "brief",
      "body": "Analyze the problem independently."
    }
  ]
}`);
    const command = batch.commands[0];
    assert.equal(command?.type, 'dispatch');
    assert.deepEqual(
      command?.type === 'dispatch' ? command.referencedMessageIds : undefined,
      [],
    );
  });

  it('still rejects a non-array referencedMessageIds value', () => {
    assert.throws(
      () =>
        parseCoordinatorCommandBatch(
          JSON.stringify({
            version: 1,
            commands: [
              {
                type: 'dispatch',
                messageId: 'round1-brief',
                debateId: 'debate-1',
                roundId: 'round-1',
                recipients: { type: 'round-watchers' },
                kind: 'brief',
                body: 'Analyze the problem independently.',
                referencedMessageIds: 'none',
              },
            ],
          }),
        ),
      OrchestratorError,
    );
  });

  it('preserves ordered Round 2 personalized dispatch commands', () => {
    const batch = parseCoordinatorCommandBatch(
      JSON.stringify({
        version: 1,
        commands: [
          {
            type: 'dispatch',
            messageId: 'msg-r2-qwen',
            debateId: 'debate-1',
            roundId: 'round-2',
            recipients: {
              type: 'explicit-agents',
              agentIds: ['watcher-qwen'],
            },
            kind: 'brief',
            body: 'ROUND 2 MESSAGE FOR QWEN',
            referencedMessageIds: ['msg-deepseek-r1', 'msg-glm-r1'],
          },
          {
            type: 'dispatch',
            messageId: 'msg-r2-deepseek',
            debateId: 'debate-1',
            roundId: 'round-2',
            recipients: {
              type: 'explicit-agents',
              agentIds: ['watcher-deepseek'],
            },
            kind: 'brief',
            body: 'ROUND 2 MESSAGE FOR DEEPSEEK',
            referencedMessageIds: ['msg-qwen-r1', 'msg-glm-r1'],
          },
          {
            type: 'dispatch',
            messageId: 'msg-r2-glm',
            debateId: 'debate-1',
            roundId: 'round-2',
            recipients: {
              type: 'explicit-agents',
              agentIds: ['watcher-glm'],
            },
            kind: 'brief',
            body: 'ROUND 2 MESSAGE FOR GLM',
            referencedMessageIds: ['msg-qwen-r1', 'msg-deepseek-r1'],
          },
        ],
      }),
    );

    assert.equal(batch.commands.length, 3);
    assert.deepEqual(
      batch.commands.map((command) => {
        assert.equal(command.type, 'dispatch');
        return {
          messageId: command.messageId,
          recipientIds:
            command.recipients.type === 'explicit-agents'
              ? command.recipients.agentIds
              : [],
          body: command.body,
          referencedMessageIds: command.referencedMessageIds,
        };
      }),
      [
        {
          messageId: 'msg-r2-qwen',
          recipientIds: ['watcher-qwen'],
          body: 'ROUND 2 MESSAGE FOR QWEN',
          referencedMessageIds: ['msg-deepseek-r1', 'msg-glm-r1'],
        },
        {
          messageId: 'msg-r2-deepseek',
          recipientIds: ['watcher-deepseek'],
          body: 'ROUND 2 MESSAGE FOR DEEPSEEK',
          referencedMessageIds: ['msg-qwen-r1', 'msg-glm-r1'],
        },
        {
          messageId: 'msg-r2-glm',
          recipientIds: ['watcher-glm'],
          body: 'ROUND 2 MESSAGE FOR GLM',
          referencedMessageIds: ['msg-qwen-r1', 'msg-deepseek-r1'],
        },
      ],
    );
  });

  it('parses complete-round and finalize-debate in order without changing state', () => {
    const batch = parseCoordinatorCommandBatch(`{
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
}`);

    assert.deepEqual(batch.commands, [
      {
        type: 'complete-round',
        debateId: 'debate-1',
        roundId: 'round-2',
      },
      {
        type: 'finalize-debate',
        debateId: 'debate-1',
        body: 'Final synthesis...',
      },
    ]);
  });

  it('rejects prose, malformed JSON, and invalid command shapes', () => {
    assert.throws(
      () =>
        parseCoordinatorCommandBatch('Please dispatch this to the Watchers.'),
      OrchestratorError,
    );
    assert.throws(
      () =>
        parseCoordinatorCommandBatch(`Here is what I think:

{
  "version": 1,
  "commands": [
    {
      "type": "complete-round",
      "debateId": "debate-1",
      "roundId": "round-2"
    }
  ]
}

Hope that helps.`),
      OrchestratorError,
    );
    assert.throws(() => parseCoordinatorCommandBatch('{'), OrchestratorError);
    assert.throws(
      () =>
        parseCoordinatorCommandBatch(
          JSON.stringify({
            version: 2,
            commands: [
              {
                type: 'complete-round',
                debateId: 'debate-1',
                roundId: 'round-2',
              },
            ],
          }),
        ),
      OrchestratorError,
    );
    assert.throws(
      () =>
        parseCoordinatorCommandBatch(
          JSON.stringify({
            version: 1,
            commands: [
              {
                type: 'start-round',
                debateId: 'debate-1',
                roundId: 'round-2',
              },
            ],
          }),
        ),
      OrchestratorError,
    );
    assert.throws(
      () =>
        parseCoordinatorCommandBatch(
          JSON.stringify({ version: 1, commands: [] }),
        ),
      OrchestratorError,
    );
    assert.throws(
      () =>
        parseCoordinatorCommandBatch(
          JSON.stringify({
            version: 1,
            commands: [
              {
                type: 'dispatch',
                messageId: 'round1-brief',
                debateId: 'debate-1',
                recipients: { type: 'all-watchers' },
                kind: 'brief',
                body: 'Analyze the problem independently.',
                referencedMessageIds: [],
              },
            ],
          }),
        ),
      OrchestratorError,
    );
    assert.throws(
      () =>
        parseCoordinatorCommandBatch(
          JSON.stringify({
            version: 1,
            commands: [
              {
                type: 'dispatch',
                messageId: 'round1-brief',
                debateId: 'debate-1',
                recipients: {
                  type: 'explicit-agents',
                  agentIds: ['watcher-qwen', 'watcher-qwen'],
                },
                kind: 'brief',
                body: 'Analyze the problem independently.',
                referencedMessageIds: [],
              },
            ],
          }),
        ),
      OrchestratorError,
    );
    assert.throws(
      () =>
        parseCoordinatorCommandBatch(
          JSON.stringify({
            version: 1,
            commands: [
              {
                type: 'dispatch',
                messageId: 'round1-brief',
                debateId: 'debate-1',
                recipients: { type: 'round-watchers' },
                kind: 'brief',
                body: 'Analyze the problem independently.',
                referencedMessageIds: ['msg-qwen-r1', 'msg-qwen-r1'],
              },
            ],
          }),
        ),
      OrchestratorError,
    );
    assert.throws(
      () =>
        parseCoordinatorCommandBatch(
          JSON.stringify({
            version: 1,
            commands: [
              {
                type: 'dispatch',
                messageId: 'round1-brief',
                debateId: 'debate-1',
                recipients: { type: 'round-watchers' },
                kind: 'opinion',
                body: 'Analyze the problem independently.',
                referencedMessageIds: [],
              },
            ],
          }),
        ),
      OrchestratorError,
    );
    assert.throws(
      () =>
        parseCoordinatorCommandBatch(
          JSON.stringify({
            version: 1,
            commands: [
              {
                type: 'dispatch',
                messageId: 'round1-brief',
                debateId: 'debate-1',
                recipients: { type: 'round-watchers' },
                kind: 'brief',
                body: '   ',
                referencedMessageIds: [],
              },
            ],
          }),
        ),
      OrchestratorError,
    );
    assert.throws(
      () =>
        parseCoordinatorCommandBatch(
          JSON.stringify({
            version: 1,
            commands: [
              {
                type: 'finalize-debate',
                debateId: 'debate-1',
                body: '',
              },
            ],
          }),
        ),
      OrchestratorError,
    );
    assert.throws(
      () =>
        parseCoordinatorCommandBatch(
          JSON.stringify({
            version: '1',
            commands: [
              {
                type: 'complete-round',
                debateId: 'debate-1',
                roundId: 'round-2',
              },
            ],
          }),
        ),
      OrchestratorError,
    );
    assert.throws(
      () =>
        parseCoordinatorCommandBatch(
          JSON.stringify({
            version: 1,
            commands: [
              {
                type: 'dispatch',
                messageId: 'round1-brief',
                debateId: 'debate-1',
                recipients: { type: 'explicit-agents', agentIds: [] },
                kind: 'brief',
                body: 'Analyze the problem independently.',
                referencedMessageIds: [],
              },
            ],
          }),
        ),
      OrchestratorError,
    );
    assert.throws(
      () =>
        parseCoordinatorCommandBatch(
          JSON.stringify({
            version: 1,
            commands: [
              {
                type: 'dispatch',
                messageId: 'round1-brief',
                debateId: 'debate-1',
                senderId: 'coordinator-deepseek',
                recipients: { type: 'round-watchers' },
                kind: 'brief',
                body: 'Analyze the problem independently.',
                referencedMessageIds: [],
              },
            ],
          }),
        ),
      OrchestratorError,
    );
  });

  it('parses checkpoint without requiring machine ids from the LLM', () => {
    const batch = parseCoordinatorCommandBatch(`{
  "version": 1,
  "commands": [
    {
      "type": "checkpoint",
      "content": "DeepSeek asked X. GLM answered Y.",
      "recommendation": "FINISH"
    }
  ]
}`);
    assert.equal(batch.commands.length, 1);
    assert.equal(batch.commands[0]?.type, 'checkpoint');
    if (batch.commands[0]?.type === 'checkpoint') {
      assert.equal(batch.commands[0].recommendation, 'finish');
      assert.match(batch.commands[0].content, /DeepSeek asked/);
    }
  });

  it('rejects mixing dispatch and checkpoint in one step', () => {
    assert.throws(
      () =>
        parseCoordinatorCommandBatch(
          JSON.stringify({
            version: 1,
            commands: [
              {
                type: 'dispatch',
                recipients: {
                  type: 'explicit-agents',
                  agentIds: ['deepseek'],
                },
                body: 'Ask a question.',
              },
              {
                type: 'checkpoint',
                content: 'Too early.',
                recommendation: 'CONTINUE',
              },
            ],
          }),
        ),
      /only one action mode/i,
    );
  });
});
