import {
  asAgentId,
  asDebateId,
  type AgentId,
  type DebateId,
} from '@rayzan/protocol';

export interface CoordinatorExecutionContext {
  readonly coordinatorId: AgentId;
  readonly debateId: DebateId;
}

export function createCoordinatorExecutionContext(input: {
  coordinatorId: string;
  debateId: string;
}): CoordinatorExecutionContext {
  return Object.freeze({
    coordinatorId: asAgentId(input.coordinatorId),
    debateId: asDebateId(input.debateId),
  });
}
