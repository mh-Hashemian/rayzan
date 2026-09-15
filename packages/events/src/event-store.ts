import type { DebateId } from '@rayzan/protocol';

import type { Event } from './event.js';

export interface EventStore {
  append(event: Event): void;
  getById(id: string): Event | undefined;
  listByDebate(debateId: DebateId): Event[];
  listAll(): Event[];
}
