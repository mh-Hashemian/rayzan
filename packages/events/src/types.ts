export const EVENT_TYPES = [
  'DEBATE_CREATED',
  'DEBATE_ARCHIVED',
  'ROUND_CREATED',
  'AGENT_REGISTERED',
  'COORDINATOR_CHANGED',
  'WATCHER_PARTICIPATION_CHANGED',
  'BINDING_CHANGED',
  'MESSAGE_CREATED',
  'MESSAGE_DISPATCHED',
  'DELIVERY_CREATED',
  'DELIVERY_CONFIRMED',
  'RESPONSE_CAPTURED',
  'EXPOSURE_CREATED',
  'ROUND_COMPLETED',
  'SYNTHESIS_CREATED',
  'OPERATOR_INTERVENTION',
  'PROMPT_DISPATCH_REQUESTED',
  'PROMPT_DISPATCH_CONFIRMED',
  'PROMPT_DISPATCH_FAILED',
  'CAPTURE_REQUESTED',
  'CAPTURE_FAILED',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** Envelope version written on newly emitted events. Historical rows may omit it. */
export const CURRENT_EVENT_SCHEMA_VERSION = 1;

/** Read-time value for events persisted before 3B.4. Never rewritten onto disk. */
export const LEGACY_EVENT_SCHEMA_VERSION = 0;
