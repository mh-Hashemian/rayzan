import type { AgentId, DebateId, MessageId, RoundId } from '@rayzan/protocol';
import type { OutboundDelivery } from '@rayzan/transport';

import type { CheckpointRecommendation } from './coordinator-command.js';

export interface DispatchExecutionResult {
  readonly type: 'dispatch';
  readonly messageId: MessageId;
  readonly debateId: DebateId;
  readonly roundId?: RoundId;
  readonly senderId: AgentId;
  readonly recipientIds: readonly AgentId[];
  readonly deliveries: readonly OutboundDelivery[];
}

export interface CheckpointExecutionResult {
  readonly type: 'checkpoint';
  readonly debateId: DebateId;
  readonly roundId: RoundId;
  readonly content: string;
  readonly recommendation: CheckpointRecommendation;
}

export interface CompleteRoundExecutionResult {
  readonly type: 'complete-round';
  readonly debateId: DebateId;
  readonly roundId: RoundId;
  readonly status: 'completed';
}

export interface FinalizeDebateExecutionResult {
  readonly type: 'finalize-debate';
  readonly debateId: DebateId;
  readonly body: string;
  readonly status: 'completed';
}

export type CoordinatorCommandExecutionResult =
  | DispatchExecutionResult
  | CheckpointExecutionResult
  | CompleteRoundExecutionResult
  | FinalizeDebateExecutionResult;

export interface CoordinatorExecutionResult {
  readonly results: readonly CoordinatorCommandExecutionResult[];
}
