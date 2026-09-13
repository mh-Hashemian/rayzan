import { asDebateId, type DebateId } from './ids.js';
import { requireAllowedValue, requireNonEmptyString } from './validate.js';

export const DEBATE_STATUSES = ['pending', 'active', 'completed'] as const;

export type DebateStatus = (typeof DEBATE_STATUSES)[number];

export interface Debate {
  readonly id: DebateId;
  readonly topic: string;
  readonly status: DebateStatus;
}

export function createDebate(input: {
  id: string;
  topic: string;
  status?: DebateStatus;
}): Debate {
  return Object.freeze({
    id: asDebateId(input.id),
    topic: requireNonEmptyString(input.topic, 'debate topic'),
    status: requireAllowedValue(
      input.status ?? 'pending',
      DEBATE_STATUSES,
      'debate status',
    ),
  });
}
