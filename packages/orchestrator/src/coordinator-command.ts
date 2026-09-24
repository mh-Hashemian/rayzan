import {
  type DebateId,
  type MessageId,
  type MessageKind,
  type RoundId,
} from '@rayzan/protocol';

import type { RecipientSelector } from './dispatch-plan.js';

export const COORDINATOR_COMMAND_PROTOCOL_VERSION = 1 as const;

export const COORDINATOR_COMMAND_TYPES = [
  'dispatch',
  'forward',
  'ask_operator',
  'checkpoint',
  'complete-round',
  'finalize-debate',
] as const;

export type CoordinatorCommandType = (typeof COORDINATOR_COMMAND_TYPES)[number];

export const CHECKPOINT_RECOMMENDATIONS = ['finish', 'continue'] as const;
export type CheckpointRecommendation =
  (typeof CHECKPOINT_RECOMMENDATIONS)[number];

/** Semantic action modes that may appear in a live consultation step. */
export const COORDINATOR_ACTION_MODES = [
  'dispatch',
  'forward',
  'ask_operator',
  'checkpoint',
] as const;
export type CoordinatorActionMode = (typeof COORDINATOR_ACTION_MODES)[number];

export interface DispatchCommand {
  readonly type: 'dispatch';
  readonly messageId: MessageId;
  readonly debateId: DebateId;
  readonly roundId?: RoundId;
  readonly recipients: RecipientSelector;
  readonly kind: MessageKind;
  readonly body: string;
  readonly referencedMessageIds: readonly MessageId[];
}

/**
 * Forward existing evidence verbatim to Watchers, with optional instruction.
 * Prefer sourceRefs (E1, E2, …) from the evidence catalog; message ids also accepted.
 */
export interface ForwardCommand {
  readonly type: 'forward';
  readonly messageId: MessageId;
  readonly debateId: DebateId;
  readonly roundId?: RoundId;
  readonly recipients: RecipientSelector;
  readonly sourceRefs: readonly string[];
  readonly sourceMessageIds: readonly MessageId[];
  readonly instruction?: string;
}

/** Pause consultation and ask the Operator a clarifying question. */
export interface AskOperatorCommand {
  readonly type: 'ask_operator';
  readonly debateId: DebateId;
  readonly roundId: RoundId;
  readonly question: string;
}

/** Operator-facing checkpoint: ends the current consultation step loop. */
export interface CheckpointCommand {
  readonly type: 'checkpoint';
  readonly debateId: DebateId;
  readonly roundId: RoundId;
  readonly content: string;
  readonly recommendation: CheckpointRecommendation;
}

export interface CompleteRoundCommand {
  readonly type: 'complete-round';
  readonly debateId: DebateId;
  readonly roundId: RoundId;
}

export interface FinalizeDebateCommand {
  readonly type: 'finalize-debate';
  readonly debateId: DebateId;
  readonly body: string;
}

export type CoordinatorCommand =
  | DispatchCommand
  | ForwardCommand
  | AskOperatorCommand
  | CheckpointCommand
  | CompleteRoundCommand
  | FinalizeDebateCommand;

export interface CoordinatorCommandBatch {
  readonly version: typeof COORDINATOR_COMMAND_PROTOCOL_VERSION;
  readonly commands: readonly CoordinatorCommand[];
}
