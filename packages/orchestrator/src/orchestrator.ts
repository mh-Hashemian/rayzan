import { recordEvent, type EventStore, type EventType } from '@rayzan/events';
import {
  asMessageId,
  createExposureRecord,
  type ExposureLedgerStore,
  type MessageId,
  type MessageStore,
} from '@rayzan/protocol';
import type {
  InboundResponse,
  OutboundDelivery,
  SubmitResponseInput,
  Transport,
} from '@rayzan/transport';

import type { DispatchIntent } from './dispatch-intent.js';
import { OrchestratorError } from './error.js';

export class Orchestrator {
  readonly #deliveryReferences = new Map<string, readonly MessageId[]>();

  constructor(
    private readonly messages: MessageStore,
    private readonly exposures: ExposureLedgerStore,
    private readonly transport: Transport,
    private readonly events?: EventStore,
  ) {}

  dispatch(intent: DispatchIntent): readonly OutboundDelivery[] {
    const referencedMessageIds = this.#validatedReferences(intent);
    const message = intent.message;

    this.messages.store(message);
    this.#emit('MESSAGE_CREATED', {
      debateId: message.debateId,
      roundId: message.roundId,
      agentId: message.senderId,
      payload: {
        messageId: message.id,
        senderId: message.senderId,
        recipientIds: [...message.recipientIds],
        kind: message.kind,
        body: message.body,
      },
    });

    const deliveries = this.transport.send(message);
    this.#emit('MESSAGE_DISPATCHED', {
      debateId: message.debateId,
      roundId: message.roundId,
      agentId: message.senderId,
      payload: {
        messageId: message.id,
        senderId: message.senderId,
        recipientIds: [...message.recipientIds],
        kind: message.kind,
        deliveryIds: deliveries.map((delivery) => delivery.id),
      },
    });

    for (const delivery of deliveries) {
      this.#deliveryReferences.set(delivery.id, referencedMessageIds);
      this.#emit('DELIVERY_CREATED', {
        debateId: delivery.debateId,
        roundId: delivery.roundId,
        agentId: delivery.recipientId,
        payload: {
          deliveryId: delivery.id,
          messageId: delivery.messageId,
          senderId: delivery.senderId,
          recipientId: delivery.recipientId,
          status: delivery.status,
          referencedMessageIds,
        },
      });
    }

    return deliveries;
  }

  confirmDelivery(deliveryId: string): OutboundDelivery {
    const referencedMessageIds = this.#deliveryReferences.get(deliveryId);
    if (referencedMessageIds === undefined) {
      throw new OrchestratorError(
        `no dispatch intent for delivery: ${deliveryId}`,
      );
    }

    const delivery = this.transport.markDelivered(deliveryId);
    this.#emit('DELIVERY_CONFIRMED', {
      debateId: delivery.debateId,
      roundId: delivery.roundId,
      agentId: delivery.recipientId,
      payload: {
        deliveryId: delivery.id,
        messageId: delivery.messageId,
        recipientId: delivery.recipientId,
      },
    });

    const exposure = this.exposures.record(
      createExposureRecord({
        id: `exposure:${delivery.id}`,
        agentId: delivery.recipientId,
        debateId: delivery.debateId,
        ...(delivery.roundId !== undefined
          ? { roundId: delivery.roundId }
          : {}),
        messageId: delivery.messageId,
        referencedMessageIds,
      }),
    );
    this.#emit('EXPOSURE_CREATED', {
      debateId: exposure.debateId,
      roundId: exposure.roundId,
      agentId: exposure.agentId,
      payload: {
        exposureId: exposure.id,
        messageId: exposure.messageId,
        agentId: exposure.agentId,
        referencedMessageIds: [...exposure.referencedMessageIds],
      },
    });

    return delivery;
  }

  submitResponse(input: SubmitResponseInput): InboundResponse {
    const inbound = this.transport.submitResponse(input);
    this.messages.store(inbound.message);
    this.#emit('MESSAGE_CREATED', {
      debateId: inbound.message.debateId,
      roundId: inbound.message.roundId,
      agentId: inbound.message.senderId,
      payload: {
        messageId: inbound.message.id,
        senderId: inbound.message.senderId,
        recipientIds: [...inbound.message.recipientIds],
        kind: inbound.message.kind,
        body: inbound.message.body,
      },
    });
    this.#emit('RESPONSE_CAPTURED', {
      debateId: inbound.message.debateId,
      roundId: inbound.message.roundId,
      agentId: inbound.message.senderId,
      payload: {
        messageId: inbound.message.id,
        deliveryId: inbound.deliveryId,
        senderId: inbound.message.senderId,
      },
    });
    return inbound;
  }

  restoreDeliveryReferences(
    deliveryId: string,
    referencedMessageIds: readonly MessageId[],
  ): void {
    this.#deliveryReferences.set(deliveryId, referencedMessageIds);
  }

  #emit(
    type: EventType,
    input: {
      debateId?: string;
      roundId?: string;
      agentId?: string;
      payload?: unknown;
    },
  ): void {
    if (this.events === undefined) {
      return;
    }
    recordEvent(this.events, { type, ...input });
  }

  #validatedReferences(intent: DispatchIntent): readonly MessageId[] {
    const seen = new Set<string>();
    const referencedMessageIds: MessageId[] = [];

    for (const rawId of intent.referencedMessageIds) {
      const referencedId = asMessageId(rawId);
      if (seen.has(referencedId)) {
        throw new OrchestratorError(
          `duplicate referenced message id: ${referencedId}`,
        );
      }
      seen.add(referencedId);

      const referenced = this.messages.getById(referencedId);
      if (referenced === undefined) {
        throw new OrchestratorError(
          `unknown referenced message: ${referencedId}`,
        );
      }

      if (referenced.debateId !== intent.message.debateId) {
        throw new OrchestratorError(
          `referenced message ${referencedId} belongs to debate ${referenced.debateId}, not ${intent.message.debateId}`,
        );
      }

      referencedMessageIds.push(referencedId);
    }

    return Object.freeze(referencedMessageIds);
  }
}
