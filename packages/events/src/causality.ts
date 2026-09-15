import { EventError } from './error.js';
import type { Event } from './event.js';

/**
 * Mechanical causal checks. Sequence order is authoritative; timestamps are ignored.
 * A cause must already exist in the store, which makes cycles impossible.
 */
export function validateCausalReference(
  event: Event,
  getCause: (id: string) => Event | undefined,
): void {
  const causeId = event.causationEventId;
  if (causeId === undefined) {
    return;
  }
  if (causeId === event.id) {
    throw new EventError(
      `causationEventId cannot reference the same event: ${causeId}`,
    );
  }
  const cause = getCause(causeId);
  if (cause === undefined) {
    throw new EventError(
      `causationEventId ${causeId} does not reference an earlier event`,
    );
  }
  if (
    event.debateId !== undefined &&
    cause.debateId !== undefined &&
    event.debateId !== cause.debateId
  ) {
    throw new EventError(
      `causationEventId ${causeId} belongs to debate ${cause.debateId}, not ${event.debateId}`,
    );
  }
}

export function deliveryCorrelationId(deliveryId: string): string {
  return `delivery:${deliveryId}`;
}

export function messageCorrelationId(messageId: string): string {
  return `message:${messageId}`;
}
