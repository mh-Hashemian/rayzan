import { asDebateId, type DebateId } from './ids.js';
import { requireAllowedValue, requireNonEmptyString } from './validate.js';

export const DEBATE_STATUSES = [
  'pending',
  'active',
  'completed',
  'archived',
] as const;

export const OPEN_DEBATE_STATUSES = ['pending', 'active'] as const;

export type DebateStatus = (typeof DEBATE_STATUSES)[number];

export interface Debate {
  readonly id: DebateId;
  readonly topic: string;
  readonly status: DebateStatus;
  readonly createdAt?: string;
  readonly completedAt?: string;
}

export function isOpenDebateStatus(status: DebateStatus): boolean {
  return status === 'pending' || status === 'active';
}

export function createDebate(input: {
  id: string;
  topic: string;
  status?: DebateStatus;
  createdAt?: string;
  completedAt?: string;
}): Debate {
  return Object.freeze({
    id: asDebateId(input.id),
    topic: requireNonEmptyString(input.topic, 'debate topic'),
    status: requireAllowedValue(
      input.status ?? 'pending',
      DEBATE_STATUSES,
      'debate status',
    ),
    ...(input.createdAt !== undefined ? { createdAt: input.createdAt } : {}),
    ...(input.completedAt !== undefined
      ? { completedAt: input.completedAt }
      : {}),
  });
}

export function withDebateStatus(
  debate: Debate,
  status: DebateStatus,
  extra: { completedAt?: string } = {},
): Debate {
  return createDebate({
    id: debate.id,
    topic: debate.topic,
    status,
    ...(debate.createdAt !== undefined ? { createdAt: debate.createdAt } : {}),
    ...(extra.completedAt !== undefined
      ? { completedAt: extra.completedAt }
      : debate.completedAt !== undefined
        ? { completedAt: debate.completedAt }
        : {}),
  });
}
