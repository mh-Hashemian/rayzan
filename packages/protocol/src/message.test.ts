import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createMessageEnvelope } from './message.js';
import { ProtocolError } from './validate.js';

describe('MessageEnvelope', () => {
  it('records explicit sender and recipient attribution', () => {
    const message = createMessageEnvelope({
      id: 'msg-1',
      debateId: 'debate-1',
      roundId: 'round-1',
      senderId: 'coordinator',
      recipientIds: ['qwen'],
      kind: 'brief',
      body: 'GLOBAL ROUND 1 MESSAGE',
    });

    assert.equal(message.senderId, 'coordinator');
    assert.deepEqual(message.recipientIds, ['qwen']);
    assert.equal(message.kind, 'brief');
  });

  it('allows multiple concrete recipients for one envelope', () => {
    const message = createMessageEnvelope({
      id: 'msg-2',
      debateId: 'debate-1',
      roundId: 'round-1',
      senderId: 'coordinator',
      recipientIds: ['deepseek', 'qwen'],
      kind: 'brief',
      body: 'Round 1 brief for all Watchers',
    });

    assert.deepEqual(message.recipientIds, ['deepseek', 'qwen']);
  });

  it('covers the agreed agent-to-agent routes without transport fields', () => {
    const routes = [
      {
        senderId: 'coordinator',
        recipientIds: ['qwen'],
        kind: 'brief' as const,
      },
      {
        senderId: 'coordinator',
        recipientIds: ['deepseek', 'qwen'],
        kind: 'brief' as const,
      },
      {
        senderId: 'deepseek',
        recipientIds: ['coordinator'],
        kind: 'response' as const,
      },
      {
        senderId: 'coordinator',
        recipientIds: ['coder'],
        kind: 'query' as const,
      },
      {
        senderId: 'coder',
        recipientIds: ['coordinator'],
        kind: 'fact' as const,
      },
      {
        senderId: 'operator',
        recipientIds: ['coordinator'],
        kind: 'input' as const,
      },
    ];

    for (const [index, route] of routes.entries()) {
      const message = createMessageEnvelope({
        id: `msg-route-${index}`,
        debateId: 'debate-1',
        senderId: route.senderId,
        recipientIds: route.recipientIds,
        kind: route.kind,
        body: `${route.senderId} → ${route.recipientIds.join(',')}`,
      });

      assert.equal(message.senderId, route.senderId);
      assert.deepEqual(message.recipientIds, route.recipientIds);
      assert.equal('url' in message, false);
      assert.equal('tabId' in message, false);
      assert.equal('transport' in message, false);
    }
  });

  it('rejects a missing sender or empty recipient list', () => {
    assert.throws(
      () =>
        createMessageEnvelope({
          id: 'msg-3',
          debateId: 'debate-1',
          senderId: ' ',
          recipientIds: ['coordinator'],
          kind: 'response',
          body: 'hello',
        }),
      ProtocolError,
    );
    assert.throws(
      () =>
        createMessageEnvelope({
          id: 'msg-4',
          debateId: 'debate-1',
          senderId: 'deepseek',
          recipientIds: [],
          kind: 'response',
          body: 'hello',
        }),
      ProtocolError,
    );
  });
});
