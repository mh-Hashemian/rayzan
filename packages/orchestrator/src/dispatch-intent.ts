import {
  asMessageId,
  type MessageEnvelope,
  type MessageId,
} from '@rayzan/protocol';

import { OrchestratorError } from './error.js';

export interface DispatchIntent {
  readonly message: MessageEnvelope;
  readonly referencedMessageIds: readonly MessageId[];
}

export function createDispatchIntent(input: {
  message: MessageEnvelope;
  referencedMessageIds: readonly string[];
}): DispatchIntent {
  const referencedMessageIds = input.referencedMessageIds.map((id) =>
    asMessageId(id),
  );

  if (new Set(referencedMessageIds).size !== referencedMessageIds.length) {
    throw new OrchestratorError('duplicate referenced message ids');
  }

  return Object.freeze({
    message: input.message,
    referencedMessageIds: Object.freeze(referencedMessageIds),
  });
}
