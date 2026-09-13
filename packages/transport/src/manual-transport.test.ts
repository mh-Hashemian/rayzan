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
  it('splits one canonical message into per-recipient pending deliveries', () => {
    const { qwen, deepSeek, glm, brief } = setupBrief();
    const transport = new ManualTransport();

    const deliveries = transport.send(brief);
    const pending = transport.listPending();

    assert.equal(deliveries.length, 3);
    assert.equal(pending.length, 3);
    assert.deepEqual(
      pending.map((delivery) => delivery.recipientId).sort(),
      [deepSeek.id, glm.id, qwen.id].sort(),
    );
    assert.equal(
      new Set(pending.map((delivery) => delivery.messageId)).size,
      1,
    );
    assert.equal(pending[0]?.messageId, brief.id);
    assert.equal(new Set(pending.map((delivery) => delivery.id)).size, 3);
    assert.ok(pending.every((delivery) => delivery.status === 'pending'));
    assert.equal(transport.getMessage(brief.id), brief);
    assert.deepEqual(brief.recipientIds, [qwen.id, deepSeek.id, glm.id]);
  });

  it('attributes responses by delivery ID and leaves other deliveries pending', () => {
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

    const qwenInbound = transport.submitResponse({
      deliveryId: qwenDelivery.id,
      responderId: qwen.id,
      body: 'Qwen independent analysis',
    });
    const deepSeekInbound = transport.submitResponse({
      deliveryId: deepSeekDelivery.id,
      responderId: deepSeek.id,
      body: 'DeepSeek independent analysis',
    });

    assert.equal(qwenInbound.message.senderId, qwen.id);
    assert.deepEqual(qwenInbound.message.recipientIds, [coordinator.id]);
    assert.equal(qwenInbound.deliveryId, qwenDelivery.id);
    assert.equal(qwenInbound.outboundMessageId, brief.id);
    assert.equal(qwenInbound.message.debateId, brief.debateId);
    assert.equal(qwenInbound.message.kind, 'response');

    assert.equal(deepSeekInbound.message.senderId, deepSeek.id);
    assert.equal(deepSeekInbound.deliveryId, deepSeekDelivery.id);
    assert.notEqual(qwenInbound.deliveryId, deepSeekInbound.deliveryId);

    const pending = transport.listPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.id, glmDelivery.id);
    assert.equal(pending[0]?.recipientId, glm.id);

    assert.throws(
      () =>
        transport.submitResponse({
          deliveryId: qwenDelivery.id,
          responderId: deepSeek.id,
          body: 'This must not satisfy Qwen',
        }),
      TransportError,
    );
  });

  it('rejects unknown, wrong-agent, and duplicate submissions', () => {
    const { qwen, deepSeek, brief } = setupBrief();
    const transport = new ManualTransport();
    const deliveries = transport.send(brief);
    const qwenDelivery = deliveries.find(
      (delivery) => delivery.recipientId === qwen.id,
    );

    assert.ok(qwenDelivery);

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
  });
});
