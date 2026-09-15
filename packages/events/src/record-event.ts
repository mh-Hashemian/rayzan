import { createEvent, type Event } from './event.js';
import type { EventStore } from './event-store.js';
import type { EventType } from './types.js';

export function recordEvent(
  store: EventStore,
  input: {
    type: EventType;
    debateId?: string;
    roundId?: string;
    agentId?: string;
    payload?: unknown;
    id?: string;
    timestamp?: Date;
  },
): Event {
  const event = createEvent({
    id: input.id ?? globalThis.crypto.randomUUID(),
    type: input.type,
    timestamp: input.timestamp ?? new Date(),
    ...(input.debateId !== undefined ? { debateId: input.debateId } : {}),
    ...(input.roundId !== undefined ? { roundId: input.roundId } : {}),
    ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
    payload: input.payload ?? {},
  });
  store.append(event);
  return event;
}
