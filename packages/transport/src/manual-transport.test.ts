import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createAgent,
  createDebate,
  createMessageEnvelope,
  createRound,
} from '@rayzan/protocol';

import { TransportError } from './error.js';
import { ManualTransport } from './manual-transport.js';

function setupBrief() {
  const coordinator = createAgent({
    id: 'coordinator',
    name: 'Coordinator',
    role: 'coordinator',
  });
  const qwen = createAgent({
    id: 'watcher-qwen',
    name: 'Qwen',
    role: 'watcher',
  });
  const deepSeek = createAgent({
    id: 'watcher-deepseek',
    name: 'DeepSeek',
    role: 'watcher',
  });
  const glm = createAgent({
    id: 'watcher-glm',
    name: 'GLM',
    role: 'watcher',
  });
  const debate = createDebate({
    id: 'debate-123',
    topic: 'Transport fallback policy',
  });
  const round = createRound({
    id: 'round-1',
    debateId: debate.id,
    number: 1,
  });
  const brief = createMessageEnvelope({
    id: 'msg-abc',
    debateId: debate.id,
    roundId: round.id,
    senderId: coordinator.id,
    recipientIds: [qwen.id, deepSeek.id, glm.id],
    kind: 'brief',
    body: 'GLOBAL ROUND 1 MESSAGE',
  });

  return { coordinator, qwen, deepSeek, glm, debate, round, brief };
}

describe('ManualTransport', () => {
  it('queues one pending delivery per recipient without implying exposure', () => {
    const { qwen, deepSeek, glm, brief } = setupBrief();
    const transport = new ManualTransport();

    const deliveries = transport.send(brief);
    const pending = transport.listPending();

    assert.equal(deliveries.length, 3);
    assert.equal(pending.length, 3);
    assert.ok(deliveries.every((delivery) => delivery.status === 'pending'));
    assert.deepEqual(
      pending.map((delivery) => delivery.recipientId).sort(),
      [deepSeek.id, glm.id, qwen.id].sort(),
    );
    assert.equal(new Set(pending.map((delivery) => delivery.id)).size, 3);
    assert.equal(transport.getMessage(brief.id), brief);
    assert.deepEqual(brief.recipientIds, [qwen.id, deepSeek.id, glm.id]);
  });

  it('moves deliveries pending → delivered → responded independently', () => {
    const { coordinator, qwen, deepSeek, glm, brief } = setupBrief();
    const transport = new ManualTransport();
    const deliveries = transport.send(brief);

    const qwenDelivery = deliveries.find(
      (delivery) => delivery.recipientId === qwen.id,
    );
    const deepSeekDelivery = deliveries.find(
      (delivery) => delivery.recipientId === deepSeek.id,
    );
    const glmDelivery = deliveries.find(
      (delivery) => delivery.recipientId === glm.id,
    );

    assert.ok(qwenDelivery);
    assert.ok(deepSeekDelivery);
    assert.ok(glmDelivery);

    transport.markDelivered(qwenDelivery.id);

    assert.equal(transport.getDelivery(qwenDelivery.id)?.status, 'delivered');
    assert.equal(transport.getDelivery(deepSeekDelivery.id)?.status, 'pending');
    assert.equal(transport.getDelivery(glmDelivery.id)?.status, 'pending');

    assert.throws(
      () =>
        transport.submitResponse({
          deliveryId: deepSeekDelivery.id,
          responderId: deepSeek.id,
          body: 'DeepSeek cannot respond while pending',
        }),
      TransportError,
    );

    transport.markDelivered(deepSeekDelivery.id);
    const deepSeekInbound = transport.submitResponse({
      deliveryId: deepSeekDelivery.id,
      responderId: deepSeek.id,
      body: 'DeepSeek independent analysis',
    });

    assert.equal(deepSeekInbound.message.senderId, deepSeek.id);
    assert.deepEqual(deepSeekInbound.message.recipientIds, [coordinator.id]);
    assert.equal(deepSeekInbound.deliveryId, deepSeekDelivery.id);
    assert.equal(deepSeekInbound.outboundMessageId, brief.id);
    assert.equal(
      transport.getDelivery(deepSeekDelivery.id)?.status,
      'responded',
    );
    assert.equal(transport.getDelivery(qwenDelivery.id)?.status, 'delivered');
    assert.equal(transport.getDelivery(glmDelivery.id)?.status, 'pending');
  });

  it('rejects unknown, duplicate, premature, and misattributed actions', () => {
    const { qwen, deepSeek, brief } = setupBrief();
    const transport = new ManualTransport();
    const deliveries = transport.send(brief);
    const qwenDelivery = deliveries.find(
      (delivery) => delivery.recipientId === qwen.id,
    );

    assert.ok(qwenDelivery);

    assert.throws(
      () => transport.markDelivered('missing-delivery'),
      TransportError,
    );
    assert.throws(
      () =>
        transport.submitResponse({
          deliveryId: 'missing-delivery',
          responderId: qwen.id,
          body: 'hello',
        }),
      TransportError,
    );

    assert.throws(
      () =>
        transport.submitResponse({
          deliveryId: qwenDelivery.id,
          responderId: qwen.id,
          body: 'response before delivery',
        }),
      TransportError,
    );

    transport.markDelivered(qwenDelivery.id);
    assert.throws(
      () => transport.markDelivered(qwenDelivery.id),
      TransportError,
    );

    assert.throws(
      () =>
        transport.submitResponse({
          deliveryId: qwenDelivery.id,
          responderId: deepSeek.id,
          body: 'DeepSeek cannot answer for Qwen',
        }),
      TransportError,
    );

    transport.submitResponse({
      deliveryId: qwenDelivery.id,
      responderId: qwen.id,
      body: 'Qwen response',
    });

    assert.throws(
      () =>
        transport.submitResponse({
          deliveryId: qwenDelivery.id,
          responderId: qwen.id,
          body: 'Second Qwen response',
        }),
      TransportError,
    );
    assert.throws(
      () => transport.markDelivered(qwenDelivery.id),
      TransportError,
    );
  });
});
