import type { AgentId, DebateId, MessageId, RoundId } from '@rayzan/protocol';
import type { OutboundDelivery } from '@rayzan/transport';

export interface DispatchExecutionResult {
  readonly type: 'dispatch';
  readonly messageId: MessageId;
  readonly debateId: DebateId;
  readonly roundId?: RoundId;
  readonly senderId: AgentId;
  readonly recipientIds: readonly AgentId[];
  readonly deliveries: readonly OutboundDelivery[];
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
  | CompleteRoundExecutionResult
  | FinalizeDebateExecutionResult;

export interface CoordinatorExecutionResult {
  readonly results: readonly CoordinatorCommandExecutionResult[];
}
