import {
  asAgentId,
  asDebateId,
  asRoundId,
  type AgentId,
  type DebateId,
  type RoundId,
} from '@rayzan/protocol';

import { EventError } from './error.js';
import { EVENT_TYPES, type EventType } from './types.js';

export interface Event {
  readonly id: string;
  readonly type: EventType;
  readonly debateId?: DebateId;
  readonly roundId?: RoundId;
  readonly agentId?: AgentId;
  readonly timestamp: Date;
  readonly payload: unknown;
}

export function createEvent(input: {
  id: string;
  type: EventType;
  debateId?: string;
  roundId?: string;
  agentId?: string;
  timestamp: Date;
  payload?: unknown;
}): Event {
  const id = input.id.trim();
  if (id.length === 0) {
    throw new EventError('event id cannot be empty');
  }
  if (!EVENT_TYPES.includes(input.type)) {
    throw new EventError('event type is not a recognized value');
  }
  if (
    !(input.timestamp instanceof Date) ||
    Number.isNaN(input.timestamp.getTime())
  ) {
    throw new EventError('timestamp must be a valid Date');
  }

  return Object.freeze({
    id,
    type: input.type,
    ...(input.debateId !== undefined
      ? { debateId: asDebateId(input.debateId) }
      : {}),
    ...(input.roundId !== undefined
      ? { roundId: asRoundId(input.roundId) }
      : {}),
    ...(input.agentId !== undefined
      ? { agentId: asAgentId(input.agentId) }
      : {}),
    timestamp: new Date(input.timestamp.getTime()),
    payload: copyPayload(input.payload ?? {}),
  });
}

export function copyEvent(event: Event): Event {
  return createEvent({
    id: event.id,
    type: event.type,
    ...(event.debateId !== undefined ? { debateId: event.debateId } : {}),
    ...(event.roundId !== undefined ? { roundId: event.roundId } : {}),
    ...(event.agentId !== undefined ? { agentId: event.agentId } : {}),
    timestamp: event.timestamp,
    payload: event.payload,
  });
}

export function copyPayload(payload: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(payload)) as unknown;
  } catch {
    throw new EventError('event payload must be JSON-serializable');
  }
}
