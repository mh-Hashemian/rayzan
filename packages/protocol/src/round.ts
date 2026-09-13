import { asDebateId, asRoundId, type DebateId, type RoundId } from './ids.js';
import { ProtocolError, requireAllowedValue } from './validate.js';

export const ROUND_STATUSES = [
  'pending',
  'active',
  'collecting',
  'completed',
] as const;

export type RoundStatus = (typeof ROUND_STATUSES)[number];

export interface Round {
  readonly id: RoundId;
  readonly debateId: DebateId;
  readonly number: number;
  readonly status: RoundStatus;
}

export function createRound(input: {
  id: string;
  debateId: string;
  number: number;
  status?: RoundStatus;
}): Round {
  if (!Number.isInteger(input.number) || input.number < 1) {
    throw new ProtocolError('round number must be an integer >= 1');
  }

  return Object.freeze({
    id: asRoundId(input.id),
    debateId: asDebateId(input.debateId),
    number: input.number,
    status: requireAllowedValue(
      input.status ?? 'pending',
      ROUND_STATUSES,
      'round status',
    ),
  });
}
