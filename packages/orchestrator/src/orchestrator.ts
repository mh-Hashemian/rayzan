import {
  deliveryCorrelationId,
  messageCorrelationId,
  recordEvent,
  type Event,
  type EventStore,
  type EventType,
} from '@rayzan/events';
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
  readonly #promptRequestedByDelivery = new Map<string, string>();
  readonly #captureRequestedByDelivery = new Map<string, string>();
  readonly #deliveryCreatedByDelivery = new Map<string, string>();

  constructor(
    private readonly messages: MessageStore,
    private readonly exposures: ExposureLedgerStore,
    private readonly transport: Transport,
    private readonly events?: EventStore,
  ) {}

  dispatch(intent: DispatchIntent): readonly OutboundDelivery[] {
    const referencedMessageIds = this.#validatedReferences(intent);
    const message = intent.message;
    const messageCorrelation = messageCorrelationId(message.id);

    this.messages.store(message);
    const created = this.#emit('MESSAGE_CREATED', {
      debateId: message.debateId,
      roundId: message.roundId,
      agentId: message.senderId,
      correlationId: messageCorrelation,
      payload: {
        messageId: message.id,
        senderId: message.senderId,
        recipientIds: [...message.recipientIds],
        kind: message.kind,
        body: message.body,
      },
    });

    const deliveries = this.transport.send(message);
    const dispatched = this.#emit('MESSAGE_DISPATCHED', {
      debateId: message.debateId,
      roundId: message.roundId,
      agentId: message.senderId,
      causationEventId: created?.id,
      correlationId: messageCorrelation,
      payload: {
        messageId: message.id,
        senderId: message.senderId,
        recipientIds: [...message.recipientIds],
        kind: message.kind,
        deliveryIds: deliveries.map((delivery) => delivery.id),
      },
    });

    for (const delivery of deliveries) {
      const deliveryCorrelation = deliveryCorrelationId(delivery.id);
      const deliveryCreated = this.#emit('DELIVERY_CREATED', {
        debateId: delivery.debateId,
        roundId: delivery.roundId,
        agentId: delivery.recipientId,
        causationEventId: dispatched?.id,
        correlationId: deliveryCorrelation,
        payload: {
          deliveryId: delivery.id,
          messageId: delivery.messageId,
          senderId: delivery.senderId,
          recipientId: delivery.recipientId,
          status: delivery.status,
          referencedMessageIds,
        },
      });
      if (deliveryCreated !== undefined) {
        this.#deliveryCreatedByDelivery.set(delivery.id, deliveryCreated.id);
      }
      this.#deliveryReferences.set(delivery.id, referencedMessageIds);
      const requested = this.#emit('PROMPT_DISPATCH_REQUESTED', {
        debateId: delivery.debateId,
        roundId: delivery.roundId,
        agentId: delivery.recipientId,
        causationEventId: deliveryCreated?.id,
        correlationId: deliveryCorrelation,
        payload: {
          deliveryId: delivery.id,
          messageId: delivery.messageId,
          recipientId: delivery.recipientId,
          action: 'prompt-dispatch',
        },
      });
      if (requested !== undefined) {
        this.#promptRequestedByDelivery.set(delivery.id, requested.id);
      }
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
    const deliveryCorrelation = deliveryCorrelationId(delivery.id);
    const promptRequestedId = this.#promptRequestedByDelivery.get(delivery.id);
    const deliveryCreatedId = this.#deliveryCreatedByDelivery.get(delivery.id);

    const confirmed = this.#emit('DELIVERY_CONFIRMED', {
      debateId: delivery.debateId,
      roundId: delivery.roundId,
      agentId: delivery.recipientId,
      causationEventId: promptRequestedId ?? deliveryCreatedId,
      correlationId: deliveryCorrelation,
      payload: {
        deliveryId: delivery.id,
        messageId: delivery.messageId,
        recipientId: delivery.recipientId,
      },
    });
    this.#emit('PROMPT_DISPATCH_CONFIRMED', {
      debateId: delivery.debateId,
      roundId: delivery.roundId,
      agentId: delivery.recipientId,
      causationEventId: promptRequestedId ?? confirmed?.id,
      correlationId: deliveryCorrelation,
      payload: {
        deliveryId: delivery.id,
        messageId: delivery.messageId,
        recipientId: delivery.recipientId,
        action: 'prompt-dispatch',
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
      causationEventId: confirmed?.id,
      correlationId: deliveryCorrelation,
      payload: {
        exposureId: exposure.id,
        messageId: exposure.messageId,
        agentId: exposure.agentId,
        referencedMessageIds: [...exposure.referencedMessageIds],
      },
    });

    const captureRequested = this.#emit('CAPTURE_REQUESTED', {
      debateId: delivery.debateId,
      roundId: delivery.roundId,
      agentId: delivery.recipientId,
      causationEventId: promptRequestedId ?? confirmed?.id,
      correlationId: deliveryCorrelation,
      payload: {
        deliveryId: delivery.id,
        messageId: delivery.messageId,
        recipientId: delivery.recipientId,
        action: 'capture',
      },
    });
    if (captureRequested !== undefined) {
      this.#captureRequestedByDelivery.set(delivery.id, captureRequested.id);
    }

    return delivery;
  }

  submitResponse(input: SubmitResponseInput): InboundResponse {
    const inbound = this.transport.submitResponse(input);
    this.messages.store(inbound.message);
    const deliveryCorrelation = deliveryCorrelationId(inbound.deliveryId);
    const captureRequestedId = this.#captureRequestedByDelivery.get(
      inbound.deliveryId,
    );
    const created = this.#emit('MESSAGE_CREATED', {
      debateId: inbound.message.debateId,
      roundId: inbound.message.roundId,
      agentId: inbound.message.senderId,
      causationEventId: captureRequestedId,
      correlationId: deliveryCorrelation,
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
      causationEventId: created?.id ?? captureRequestedId,
      correlationId: deliveryCorrelation,
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

  failPromptDispatch(input: {
    deliveryId: string;
    recipientId: string;
    debateId?: string;
    roundId?: string;
    messageId?: string;
    reason: string;
  }): void {
    const correlation = deliveryCorrelationId(input.deliveryId);
    if (this.#alreadyTerminated(correlation, 'prompt-dispatch')) {
      return;
    }
    this.#emit('PROMPT_DISPATCH_FAILED', {
      debateId: input.debateId,
      roundId: input.roundId,
      agentId: input.recipientId,
      causationEventId:
        this.#promptRequestedByDelivery.get(input.deliveryId) ??
        this.#latestEventId(
          deliveryCorrelationId(input.deliveryId),
          'PROMPT_DISPATCH_REQUESTED',
        ),
      correlationId: correlation,
      payload: {
        deliveryId: input.deliveryId,
        ...(input.messageId !== undefined ? { messageId: input.messageId } : {}),
        recipientId: input.recipientId,
        action: 'prompt-dispatch',
        reason: input.reason,
      },
    });
  }

  failCapture(input: {
    deliveryId: string;
    recipientId: string;
    debateId?: string;
    roundId?: string;
    reason: string;
  }): void {
    const correlation = deliveryCorrelationId(input.deliveryId);
    if (this.#alreadyTerminated(correlation, 'capture')) {
      return;
    }
    this.#emit('CAPTURE_FAILED', {
      debateId: input.debateId,
      roundId: input.roundId,
      agentId: input.recipientId,
      causationEventId:
        this.#captureRequestedByDelivery.get(input.deliveryId) ??
        this.#latestEventId(
          deliveryCorrelationId(input.deliveryId),
          'CAPTURE_REQUESTED',
        ),
      correlationId: correlation,
      payload: {
        deliveryId: input.deliveryId,
        recipientId: input.recipientId,
        action: 'capture',
        reason: input.reason,
      },
    });
  }

  #latestEventId(correlationId: string, type: EventType): string | undefined {
    if (this.events === undefined) {
      return undefined;
    }
    const match = this.events
      .listAll()
      .filter(
        (event) =>
          event.type === type && event.correlationId === correlationId,
      )
      .at(-1);
    return match?.id;
  }

  #alreadyTerminated(
    correlationId: string,
    action: 'prompt-dispatch' | 'capture',
  ): boolean {
    if (this.events === undefined) {
      return false;
    }
    const terminals =
      action === 'prompt-dispatch'
        ? new Set(['PROMPT_DISPATCH_CONFIRMED', 'PROMPT_DISPATCH_FAILED'])
        : new Set(['RESPONSE_CAPTURED', 'CAPTURE_FAILED']);
    return this.events
      .listAll()
      .some(
        (event) =>
          event.correlationId === correlationId && terminals.has(event.type),
      );
  }

  #emit(
    type: EventType,
    input: {
      debateId?: string;
      roundId?: string;
      agentId?: string;
      causationEventId?: string;
      correlationId?: string;
      payload?: unknown;
    },
  ): Event | undefined {
    if (this.events === undefined) {
      return undefined;
    }
    return recordEvent(this.events, { type, ...input });
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
