import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createAgent,
  createDebate,
  createMessageEnvelope,
  createRound,
  InMemoryExposureLedgerStore,
  InMemoryMessageStore,
} from '@rayzan/protocol';
import { InMemoryEventStore } from '@rayzan/storage';
import { ManualTransport, TransportError } from '@rayzan/transport';

import { createDispatchIntent } from '../src/dispatch-intent.js';
import { Orchestrator } from '../src/orchestrator.js';
import { OrchestratorError } from '../src/error.js';

function setup() {
  const messages = new InMemoryMessageStore();
  const exposures = new InMemoryExposureLedgerStore();
  const transport = new ManualTransport();
  const orchestrator = new Orchestrator(messages, exposures, transport);

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
  const coder = createAgent({
    id: 'coder',
    name: 'Coder',
    role: 'coder',
  });
  const debate = createDebate({
    id: 'debate-1',
    topic: 'Transport fallback policy',
  });
  const round = createRound({
    id: 'round-1',
    debateId: debate.id,
    number: 1,
  });
  const brief = createMessageEnvelope({
    id: 'msg-brief-r1',
    debateId: debate.id,
    roundId: round.id,
    senderId: coordinator.id,
    recipientIds: [qwen.id, deepSeek.id, glm.id],
    kind: 'brief',
    body: 'GLOBAL ROUND 1 MESSAGE',
  });

  return {
    messages,
    exposures,
    transport,
    orchestrator,
    coordinator,
    qwen,
    deepSeek,
    glm,
    coder,
    debate,
    round,
    brief,
  };
}

describe('Orchestrator', () => {
  it('dispatches without recording exposure until delivery is confirmed', () => {
    const {
      messages,
      exposures,
      transport,
      orchestrator,
      qwen,
      deepSeek,
      glm,
      coder,
      brief,
    } = setup();

    const deliveries = orchestrator.dispatch(
      createDispatchIntent({
        message: brief,
        referencedMessageIds: [],
      }),
    );

    assert.equal(messages.getById(brief.id), brief);
    assert.equal(deliveries.length, 3);
    assert.ok(deliveries.every((delivery) => delivery.status === 'pending'));
    assert.deepEqual(exposures.listByDebate(brief.debateId), []);
    assert.deepEqual(exposures.listByAgent(qwen.id), []);
    assert.deepEqual(exposures.listByAgent(deepSeek.id), []);
    assert.deepEqual(exposures.listByAgent(glm.id), []);
    assert.deepEqual(exposures.listByAgent(coder.id), []);

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

    orchestrator.confirmDelivery(qwenDelivery.id);

    assert.equal(transport.getDelivery(qwenDelivery.id)?.status, 'delivered');
    assert.equal(exposures.listByAgent(qwen.id).length, 1);
    assert.equal(exposures.listByAgent(qwen.id)[0]?.messageId, brief.id);
    assert.deepEqual(exposures.listByAgent(deepSeek.id), []);
    assert.deepEqual(exposures.listByAgent(glm.id), []);

    orchestrator.confirmDelivery(deepSeekDelivery.id);
    const inbound = orchestrator.submitResponse({
      deliveryId: deepSeekDelivery.id,
      responderId: deepSeek.id,
      body: 'DeepSeek independent analysis',
    });

    assert.equal(
      transport.getDelivery(deepSeekDelivery.id)?.status,
      'responded',
    );
    assert.equal(messages.getById(inbound.message.id), inbound.message);
    assert.equal(inbound.message.senderId, deepSeek.id);
    assert.deepEqual(inbound.message.recipientIds, [brief.senderId]);
    assert.equal(inbound.message.debateId, brief.debateId);
    assert.equal(inbound.message.roundId, brief.roundId);
    assert.equal(inbound.deliveryId, deepSeekDelivery.id);
    assert.equal(inbound.outboundMessageId, brief.id);

    assert.equal(transport.getDelivery(glmDelivery.id)?.status, 'pending');
    assert.deepEqual(exposures.listByAgent(glm.id), []);
  });

  it('does not store a response or exposure when transport rejects the action', () => {
    const { messages, exposures, orchestrator, qwen, deepSeek, brief } =
      setup();

    const deliveries = orchestrator.dispatch(
      createDispatchIntent({
        message: brief,
        referencedMessageIds: [],
      }),
    );
    const qwenDelivery = deliveries.find(
      (delivery) => delivery.recipientId === qwen.id,
    );
    const deepSeekDelivery = deliveries.find(
      (delivery) => delivery.recipientId === deepSeek.id,
    );

    assert.ok(qwenDelivery);
    assert.ok(deepSeekDelivery);

    const storedBeforeFailures = messages.listByDebate(brief.debateId).length;

    assert.throws(
      () =>
        orchestrator.submitResponse({
          deliveryId: deepSeekDelivery.id,
          responderId: deepSeek.id,
          body: 'too early',
        }),
      TransportError,
    );
    assert.equal(
      messages.listByDebate(brief.debateId).length,
      storedBeforeFailures,
    );

    assert.throws(
      () => orchestrator.confirmDelivery('missing-delivery'),
      OrchestratorError,
    );
    assert.deepEqual(exposures.listByDebate(brief.debateId), []);

    orchestrator.confirmDelivery(qwenDelivery.id);
    assert.equal(exposures.listByAgent(qwen.id).length, 1);

    assert.throws(
      () => orchestrator.confirmDelivery(qwenDelivery.id),
      TransportError,
    );
    assert.equal(exposures.listByAgent(qwen.id).length, 1);

    assert.throws(
      () =>
        orchestrator.submitResponse({
          deliveryId: qwenDelivery.id,
          responderId: deepSeek.id,
          body: 'wrong responder',
        }),
      TransportError,
    );
    assert.equal(
      messages.listByDebate(brief.debateId).length,
      storedBeforeFailures,
    );

    const inbound = orchestrator.submitResponse({
      deliveryId: qwenDelivery.id,
      responderId: qwen.id,
      body: 'Qwen response',
    });

    assert.throws(
      () =>
        orchestrator.submitResponse({
          deliveryId: qwenDelivery.id,
          responderId: qwen.id,
          body: 'duplicate',
        }),
      TransportError,
    );

    const responses = messages
      .listByDebate(brief.debateId)
      .filter((message) => message.kind === 'response');
    assert.deepEqual(responses, [inbound.message]);
  });

  it('rejects unknown, cross-debate, and duplicate referenced message ids', () => {
    const { orchestrator, messages, qwen, coordinator, debate, brief } =
      setup();

    assert.throws(
      () =>
        orchestrator.dispatch(
          createDispatchIntent({
            message: brief,
            referencedMessageIds: ['msg-missing'],
          }),
        ),
      OrchestratorError,
    );

    messages.store(
      createMessageEnvelope({
        id: 'msg-other-debate',
        debateId: 'debate-other',
        senderId: coordinator.id,
        recipientIds: [qwen.id],
        kind: 'brief',
        body: 'other debate',
      }),
    );

    assert.throws(
      () =>
        orchestrator.dispatch(
          createDispatchIntent({
            message: brief,
            referencedMessageIds: ['msg-other-debate'],
          }),
        ),
      OrchestratorError,
    );

    messages.store(
      createMessageEnvelope({
        id: 'msg-same-debate',
        debateId: debate.id,
        senderId: coordinator.id,
        recipientIds: [qwen.id],
        kind: 'fact',
        body: 'prior fact',
      }),
    );

    assert.throws(
      () =>
        createDispatchIntent({
          message: brief,
          referencedMessageIds: ['msg-same-debate', 'msg-same-debate'],
        }),
      OrchestratorError,
    );
  });
});

describe('Orchestrator event emission', () => {
  it('records MESSAGE_DISPATCHED and RESPONSE_CAPTURED without changing dispatch', () => {
    const events = new InMemoryEventStore();
    const messages = new InMemoryMessageStore();
    const exposures = new InMemoryExposureLedgerStore();
    const transport = new ManualTransport();
    const orchestrator = new Orchestrator(
      messages,
      exposures,
      transport,
      events,
    );
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
    const debate = createDebate({
      id: 'debate-1',
      topic: 'Event emission',
    });
    const brief = createMessageEnvelope({
      id: 'msg-brief',
      debateId: debate.id,
      senderId: coordinator.id,
      recipientIds: [qwen.id],
      kind: 'brief',
      body: 'Round 1 brief',
    });

    const deliveries = orchestrator.dispatch(
      createDispatchIntent({
        message: brief,
        referencedMessageIds: [],
      }),
    );
    const delivery = deliveries[0];
    assert.ok(delivery);

    assert.deepEqual(
      events.listByDebate(debate.id).map((event) => event.type),
      ['MESSAGE_CREATED', 'MESSAGE_DISPATCHED', 'DELIVERY_CREATED'],
    );

    orchestrator.confirmDelivery(delivery.id);
    orchestrator.submitResponse({
      deliveryId: delivery.id,
      responderId: qwen.id,
      body: 'Qwen independent analysis',
    });

    assert.deepEqual(
      events.listByDebate(debate.id).map((event) => event.type),
      [
        'MESSAGE_CREATED',
        'MESSAGE_DISPATCHED',
        'DELIVERY_CREATED',
        'DELIVERY_CONFIRMED',
        'EXPOSURE_CREATED',
        'MESSAGE_CREATED',
        'RESPONSE_CAPTURED',
      ],
    );
    assert.equal(messages.getById(brief.id), brief);
    assert.equal(exposures.listByAgent(qwen.id).length, 1);
  });
});
