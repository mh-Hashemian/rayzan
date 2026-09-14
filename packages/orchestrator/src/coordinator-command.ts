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
  'complete-round',
  'finalize-debate',
] as const;

export type CoordinatorCommandType = (typeof COORDINATOR_COMMAND_TYPES)[number];

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
  DispatchCommand | CompleteRoundCommand | FinalizeDebateCommand;

export interface CoordinatorCommandBatch {
  readonly version: typeof COORDINATOR_COMMAND_PROTOCOL_VERSION;
  readonly commands: readonly CoordinatorCommand[];
}
