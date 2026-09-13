import {
  asAgentId,
  asDebateId,
  asMessageId,
  asRoundId,
  type AgentId,
  type DebateId,
  type MessageId,
  type RoundId,
} from './ids.js';
import {
  ProtocolError,
  requireAllowedValue,
  requireNonEmptyString,
} from './validate.js';

export const MESSAGE_KINDS = [
  'input',
  'brief',
  'query',
  'response',
  'fact',
  'synthesis',
] as const;

export type MessageKind = (typeof MESSAGE_KINDS)[number];

export interface MessageEnvelope {
  readonly id: MessageId;
  readonly debateId: DebateId;
  readonly roundId?: RoundId;
  readonly senderId: AgentId;
  readonly recipientIds: readonly AgentId[];
  readonly kind: MessageKind;
  readonly body: string;
}

export function createMessageEnvelope(input: {
  id: string;
  debateId: string;
  roundId?: string;
  senderId: string;
  recipientIds: readonly string[];
  kind: MessageKind;
  body: string;
}): MessageEnvelope {
  if (!Array.isArray(input.recipientIds) || input.recipientIds.length === 0) {
    throw new ProtocolError('recipient list cannot be empty');
  }

  const recipientIds = Object.freeze(
    input.recipientIds.map((recipientId, index) =>
      asAgentId(requireNonEmptyString(recipientId, `recipientIds[${index}]`)),
    ),
  );

  const envelope: MessageEnvelope = {
    id: asMessageId(input.id),
    debateId: asDebateId(input.debateId),
    senderId: asAgentId(input.senderId),
    recipientIds,
    kind: requireAllowedValue(input.kind, MESSAGE_KINDS, 'message kind'),
    body: requireNonEmptyString(input.body, 'message body'),
  };

  if (input.roundId !== undefined) {
    return Object.freeze({
      ...envelope,
      roundId: asRoundId(input.roundId),
    });
  }

  return Object.freeze(envelope);
}
