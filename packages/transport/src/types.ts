import type {
  AgentId,
  DebateId,
  MessageEnvelope,
  MessageId,
  RoundId,
} from '@rayzan/protocol';

import type { DeliveryId } from './ids.js';

export const DELIVERY_STATUSES = ['pending', 'responded'] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export interface OutboundDelivery {
  readonly id: DeliveryId;
  readonly messageId: MessageId;
  readonly debateId: DebateId;
  readonly roundId?: RoundId;
  readonly senderId: AgentId;
  readonly recipientId: AgentId;
  readonly status: DeliveryStatus;
}

export type PendingManualDelivery = OutboundDelivery & {
  readonly status: 'pending';
};

export interface InboundResponse {
  readonly deliveryId: DeliveryId;
  readonly outboundMessageId: MessageId;
  readonly message: MessageEnvelope;
}

export interface Transport {
  send(message: MessageEnvelope): readonly OutboundDelivery[];
}
