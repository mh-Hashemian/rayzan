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
  ) {}

  dispatch(intent: DispatchIntent): readonly OutboundDelivery[] {
    const referencedMessageIds = this.#validatedReferences(intent);

    this.messages.store(intent.message);
    const deliveries = this.transport.send(intent.message);

    for (const delivery of deliveries) {
      this.#deliveryReferences.set(delivery.id, referencedMessageIds);
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

    this.exposures.record(
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

    return delivery;
  }

  submitResponse(input: SubmitResponseInput): InboundResponse {
    const inbound = this.transport.submitResponse(input);
    this.messages.store(inbound.message);
    return inbound;
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
