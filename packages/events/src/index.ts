export { EventError } from './error.js';
export { copyEvent, copyPayload, createEvent, type Event } from './event.js';
export type { EventStore } from './event-store.js';
export { recordEvent } from './record-event.js';
export {
  CURRENT_EVENT_SCHEMA_VERSION,
  EVENT_TYPES,
  LEGACY_EVENT_SCHEMA_VERSION,
  type EventType,
} from './types.js';
export {
  deliveryCorrelationId,
  messageCorrelationId,
  validateCausalReference,
} from './causality.js';
