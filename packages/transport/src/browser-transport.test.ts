import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createAgent,
  createDebate,
  createMessageEnvelope,
  createRound,
} from '@rayzan/protocol';

import { BrowserTransport } from './browser-transport.js';
import { TransportError } from './error.js';

describe('BrowserTransport', () => {
  it('queues pending outbox entries per recipient without provider fields', () => {
    const coordinator = createAgent({
      id: 'coordinator-deepseek',
      name: 'DeepSeek Coordinator',
      role: 'coordinator',
    });
    const watcher = createAgent({
      id: 'watcher-deepseek',
      name: 'DeepSeek Watcher',
      role: 'watcher',
    });
    const debate = createDebate({
      id: 'debate-1',
      topic: 'Demo',
      status: 'active',
    });
    const round = createRound({
      id: 'round-1',
      debateId: debate.id,
      number: 1,
    });
    const message = createMessageEnvelope({
      id: 'msg-1',
      debateId: debate.id,
      roundId: round.id,
      senderId: coordinator.id,
      recipientIds: [watcher.id],
      kind: 'brief',
      body: 'Analyze independently.',
    });

    const transport = new BrowserTransport();
    const deliveries = transport.send(message);

    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0]?.status, 'pending');
    assert.equal(
      transport.listPendingForAgent(watcher.id)[0]?.id,
      deliveries[0]?.id,
    );
    assert.deepEqual(transport.listPendingForAgent(coordinator.id), []);
    assert.equal(transport.getMessage(message.id), message);
    assert.equal('tabId' in (deliveries[0] ?? {}), false);
  });

  it('moves a browser delivery pending → delivered → responded', () => {
    const coordinator = createAgent({
      id: 'coordinator-deepseek',
      name: 'DeepSeek Coordinator',
      role: 'coordinator',
    });
    const watcher = createAgent({
      id: 'watcher-deepseek',
      name: 'DeepSeek Watcher',
      role: 'watcher',
    });
    const message = createMessageEnvelope({
      id: 'msg-1',
      debateId: 'debate-1',
      senderId: coordinator.id,
      recipientIds: [watcher.id],
      kind: 'brief',
      body: 'Analyze independently.',
    });
    const transport = new BrowserTransport();
    const [delivery] = transport.send(message);
    assert.ok(delivery);

    const delivered = transport.markDelivered(delivery.id);
    assert.equal(delivered.status, 'delivered');
    assert.deepEqual(transport.listPendingForAgent(watcher.id), []);
    assert.equal(
      transport.listAwaitingResponseForAgent(watcher.id)[0]?.id,
      delivery.id,
    );

    const inbound = transport.submitResponse({
      deliveryId: delivery.id,
      responderId: watcher.id,
      body: 'Watcher analysis',
    });
    assert.equal(inbound.message.senderId, watcher.id);
    assert.equal(transport.getDelivery(delivery.id)?.status, 'responded');
  });

  it('rejects unknown ack and wrong-agent captured responses', () => {
    const coordinator = createAgent({
      id: 'coordinator-deepseek',
      name: 'DeepSeek Coordinator',
      role: 'coordinator',
    });
    const watcher = createAgent({
      id: 'watcher-deepseek',
      name: 'DeepSeek Watcher',
      role: 'watcher',
    });
    const other = createAgent({
      id: 'watcher-other',
      name: 'Other Watcher',
      role: 'watcher',
    });
    const message = createMessageEnvelope({
      id: 'msg-1',
      debateId: 'debate-1',
      senderId: coordinator.id,
      recipientIds: [watcher.id],
      kind: 'brief',
      body: 'Analyze independently.',
    });
    const transport = new BrowserTransport();
    const [delivery] = transport.send(message);
    assert.ok(delivery);

    assert.throws(
      () => transport.markDelivered('missing-delivery'),
      TransportError,
    );
    transport.markDelivered(delivery.id);
    assert.throws(
      () =>
        transport.submitResponse({
          deliveryId: delivery.id,
          responderId: other.id,
          body: 'wrong agent',
        }),
      TransportError,
    );
  });

  it('rejects duplicate ack and duplicate captured responses', () => {
    const coordinator = createAgent({
      id: 'coordinator-deepseek',
      name: 'DeepSeek Coordinator',
      role: 'coordinator',
    });
    const watcher = createAgent({
      id: 'watcher-qwen',
      name: 'Qwen',
      role: 'watcher',
    });
    const message = createMessageEnvelope({
      id: 'msg-1',
      debateId: 'debate-1',
      senderId: coordinator.id,
      recipientIds: [watcher.id],
      kind: 'brief',
      body: 'Analyze independently.',
    });
    const transport = new BrowserTransport();
    const [delivery] = transport.send(message);
    assert.ok(delivery);
    transport.markDelivered(delivery.id);
    assert.throws(() => transport.markDelivered(delivery.id), TransportError);
    transport.submitResponse({
      deliveryId: delivery.id,
      responderId: watcher.id,
      body: 'first',
    });
    assert.throws(
      () =>
        transport.submitResponse({
          deliveryId: delivery.id,
          responderId: watcher.id,
          body: 'second',
        }),
      TransportError,
    );
  });
});
