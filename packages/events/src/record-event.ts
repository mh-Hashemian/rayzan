import { createEvent, type Event } from './event.js';
import type { EventStore } from './event-store.js';
import {
  CURRENT_EVENT_SCHEMA_VERSION,
  type EventType,
} from './types.js';

export function recordEvent(
  store: EventStore,
  input: {
    type: EventType;
    debateId?: string;
    roundId?: string;
    agentId?: string;
    causationEventId?: string;
    correlationId?: string;
    payload?: unknown;
    id?: string;
    timestamp?: Date;
    schemaVersion?: number;
  },
): Event {
  const event = createEvent({
    id: input.id ?? globalThis.crypto.randomUUID(),
    type: input.type,
    schemaVersion: input.schemaVersion ?? CURRENT_EVENT_SCHEMA_VERSION,
    timestamp: input.timestamp ?? new Date(),
    ...(input.debateId !== undefined ? { debateId: input.debateId } : {}),
    ...(input.roundId !== undefined ? { roundId: input.roundId } : {}),
    ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
    ...(input.causationEventId !== undefined
      ? { causationEventId: input.causationEventId }
      : {}),
    ...(input.correlationId !== undefined
      ? { correlationId: input.correlationId }
      : {}),
    payload: input.payload ?? {},
  });
  store.append(event);
  return event;
}
