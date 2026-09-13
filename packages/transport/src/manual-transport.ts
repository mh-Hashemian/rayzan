import {
  createMessageEnvelope,
  type MessageEnvelope,
  type MessageId,
} from '@rayzan/protocol';

import { TransportError } from './error.js';
import { asDeliveryId, newDeliveryId, type DeliveryId } from './ids.js';
import type {
  InboundResponse,
  OutboundDelivery,
  PendingManualDelivery,
  SubmitResponseInput,
  Transport,
} from './types.js';

export class ManualTransport implements Transport {
  readonly #messages = new Map<MessageId, MessageEnvelope>();
  readonly #deliveries = new Map<DeliveryId, OutboundDelivery>();

  send(message: MessageEnvelope): readonly OutboundDelivery[] {
    if (this.#messages.has(message.id)) {
      throw new TransportError(`message already sent: ${message.id}`);
    }

    this.#messages.set(message.id, message);

    const deliveries = message.recipientIds.map((recipientId) => {
      const delivery: OutboundDelivery = Object.freeze({
        id: newDeliveryId(),
        messageId: message.id,
        debateId: message.debateId,
        ...(message.roundId !== undefined ? { roundId: message.roundId } : {}),
        senderId: message.senderId,
        recipientId,
        status: 'pending',
      });
      this.#deliveries.set(delivery.id, delivery);
      return delivery;
    });

    return Object.freeze(deliveries);
  }

  listPending(): readonly PendingManualDelivery[] {
    return [...this.#deliveries.values()].filter(
      (delivery): delivery is PendingManualDelivery =>
        delivery.status === 'pending',
    );
  }

  getDelivery(id: DeliveryId): OutboundDelivery | undefined {
    return this.#deliveries.get(id);
  }

  getMessage(id: MessageId): MessageEnvelope | undefined {
    return this.#messages.get(id);
  }

  markDelivered(deliveryId: string): OutboundDelivery {
    const id = asDeliveryId(deliveryId);
    const delivery = this.#deliveries.get(id);

    if (delivery === undefined) {
      throw new TransportError(`unknown delivery id: ${id}`);
    }

    if (delivery.status === 'delivered') {
      throw new TransportError(`delivery already confirmed: ${id}`);
    }

    if (delivery.status === 'responded') {
      throw new TransportError(
        `cannot mark a responded delivery as delivered: ${id}`,
      );
    }

    const confirmed = Object.freeze({
      ...delivery,
      status: 'delivered' as const,
    });
    this.#deliveries.set(id, confirmed);
    return confirmed;
  }

  submitResponse(input: SubmitResponseInput): InboundResponse {
    const deliveryId = asDeliveryId(input.deliveryId);
    const delivery = this.#deliveries.get(deliveryId);

    if (delivery === undefined) {
      throw new TransportError(`unknown delivery id: ${deliveryId}`);
    }

    if (delivery.status === 'pending') {
      throw new TransportError(
        `cannot submit a response before delivery is confirmed: ${deliveryId}`,
      );
    }

    if (delivery.status === 'responded') {
      throw new TransportError(
        `response already submitted for delivery: ${deliveryId}`,
      );
    }

    if (input.responderId !== delivery.recipientId) {
      throw new TransportError(
        `responder ${input.responderId} does not match delivery recipient ${delivery.recipientId}`,
      );
    }

    const message = createMessageEnvelope({
      id: input.messageId ?? `response-${deliveryId}`,
      debateId: delivery.debateId,
      ...(delivery.roundId !== undefined ? { roundId: delivery.roundId } : {}),
      senderId: input.responderId,
      recipientIds: [delivery.senderId],
      kind: 'response',
      body: input.body,
    });

    this.#deliveries.set(
      deliveryId,
      Object.freeze({
        ...delivery,
        status: 'responded',
      }),
    );

    return Object.freeze({
      deliveryId,
      outboundMessageId: delivery.messageId,
      message,
    });
  }
}
