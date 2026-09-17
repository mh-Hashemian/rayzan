import { asDebateId, asRoundId, type DebateId, type RoundId } from './ids.js';
import { requireAllowedValue, requireNonEmptyString } from './validate.js';

export const CHECKPOINT_RECOMMENDATIONS = ['finish', 'continue'] as const;

export type CheckpointRecommendation =
  (typeof CHECKPOINT_RECOMMENDATIONS)[number];

/** A Coordinator-owned semantic assessment made after a mechanically complete round. */
export interface CoordinatorCheckpoint {
  readonly debateId: DebateId;
  readonly roundId: RoundId;
  readonly body: string;
  readonly recommendation: CheckpointRecommendation;
  readonly createdAt: string;
}

export function createCoordinatorCheckpoint(input: {
  debateId: string;
  roundId: string;
  body: string;
  recommendation: CheckpointRecommendation;
  createdAt: string;
}): CoordinatorCheckpoint {
  return Object.freeze({
    debateId: asDebateId(input.debateId),
    roundId: asRoundId(input.roundId),
    body: requireNonEmptyString(input.body, 'checkpoint body'),
    recommendation: requireAllowedValue(
      input.recommendation,
      CHECKPOINT_RECOMMENDATIONS,
      'checkpoint recommendation',
    ),
    createdAt: requireNonEmptyString(input.createdAt, 'checkpoint createdAt'),
  });
}
