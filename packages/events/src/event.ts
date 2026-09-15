import {
  asAgentId,
  asDebateId,
  asRoundId,
  type AgentId,
  type DebateId,
  type RoundId,
} from '@rayzan/protocol';

import { EventError } from './error.js';
import {
  CURRENT_EVENT_SCHEMA_VERSION,
  EVENT_TYPES,
  type EventType,
} from './types.js';

export interface Event {
  readonly id: string;
  readonly type: EventType;
  readonly schemaVersion: number;
  readonly debateId?: DebateId;
  readonly roundId?: RoundId;
  readonly agentId?: AgentId;
  readonly causationEventId?: string;
  readonly correlationId?: string;
  readonly timestamp: Date;
  readonly payload: unknown;
}

export function createEvent(input: {
  id: string;
  type: EventType;
  schemaVersion?: number;
  debateId?: string;
  roundId?: string;
  agentId?: string;
  causationEventId?: string;
  correlationId?: string;
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
  const schemaVersion =
    input.schemaVersion === undefined
      ? CURRENT_EVENT_SCHEMA_VERSION
      : input.schemaVersion;
  if (!Number.isInteger(schemaVersion) || schemaVersion < 0) {
    throw new EventError('schemaVersion must be a non-negative integer');
  }
  const causationEventId = optionalId(input.causationEventId, 'causationEventId');
  const correlationId = optionalId(input.correlationId, 'correlationId');

  return Object.freeze({
    id,
    type: input.type,
    schemaVersion,
    ...(input.debateId !== undefined
      ? { debateId: asDebateId(input.debateId) }
      : {}),
    ...(input.roundId !== undefined
      ? { roundId: asRoundId(input.roundId) }
      : {}),
    ...(input.agentId !== undefined
      ? { agentId: asAgentId(input.agentId) }
      : {}),
    ...(causationEventId !== undefined ? { causationEventId } : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
    timestamp: new Date(input.timestamp.getTime()),
    payload: copyPayload(input.payload ?? {}),
  });
}

export function copyEvent(event: Event): Event {
  return createEvent({
    id: event.id,
    type: event.type,
    schemaVersion: event.schemaVersion,
    ...(event.debateId !== undefined ? { debateId: event.debateId } : {}),
    ...(event.roundId !== undefined ? { roundId: event.roundId } : {}),
    ...(event.agentId !== undefined ? { agentId: event.agentId } : {}),
    ...(event.causationEventId !== undefined
      ? { causationEventId: event.causationEventId }
      : {}),
    ...(event.correlationId !== undefined
      ? { correlationId: event.correlationId }
      : {}),
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

function optionalId(value: string | undefined, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new EventError(`${field} cannot be empty`);
  }
  return trimmed;
}
