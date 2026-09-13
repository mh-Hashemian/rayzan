import {
  createExposureRecord,
  type ExposureLedgerStore,
  type MessageEnvelope,
  type MessageStore,
} from '@rayzan/protocol';
import type {
  InboundResponse,
  OutboundDelivery,
  SubmitResponseInput,
  Transport,
} from '@rayzan/transport';

export class Orchestrator {
  constructor(
    private readonly messages: MessageStore,
    private readonly exposures: ExposureLedgerStore,
    private readonly transport: Transport,
  ) {}

  dispatch(message: MessageEnvelope): readonly OutboundDelivery[] {
    this.messages.store(message);
    return this.transport.send(message);
  }

  confirmDelivery(deliveryId: string): OutboundDelivery {
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
      }),
    );

    return delivery;
  }

  submitResponse(input: SubmitResponseInput): InboundResponse {
    const inbound = this.transport.submitResponse(input);
    this.messages.store(inbound.message);
    return inbound;
  }
}
