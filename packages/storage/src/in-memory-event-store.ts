import {
  copyEvent,
  EventError,
  type Event,
  type EventStore,
} from '@rayzan/events';
import type { DebateId } from '@rayzan/protocol';

export class InMemoryEventStore implements EventStore {
  readonly #events: Event[] = [];
  readonly #byId = new Map<string, Event>();

  append(event: Event): void {
    if (this.#byId.has(event.id)) {
      throw new EventError(`duplicate event id: ${event.id}`);
    }
    const stored = copyEvent(event);
    this.#byId.set(event.id, stored);
    this.#events.push(stored);
  }

  getById(id: string): Event | undefined {
    const found = this.#byId.get(id);
    return found === undefined ? undefined : copyEvent(found);
  }

  listByDebate(debateId: DebateId): Event[] {
    return this.#events
      .filter((event) => event.debateId === debateId)
      .map((event) => copyEvent(event));
  }

  listAll(): Event[] {
    return this.#events.map((event) => copyEvent(event));
  }
}
