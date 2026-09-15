import { asAgentId, asDebateId, type AgentId, type DebateId } from './ids.js';
import { requireNonEmptyString } from './validate.js';

export interface DebateSynthesis {
  readonly debateId: DebateId;
  readonly coordinatorId: AgentId;
  readonly body: string;
  readonly createdAt: string;
}

export function createDebateSynthesis(input: {
  debateId: string;
  coordinatorId: string;
  body: string;
  createdAt: string;
}): DebateSynthesis {
  return Object.freeze({
    debateId: asDebateId(input.debateId),
    coordinatorId: asAgentId(input.coordinatorId),
    body: requireNonEmptyString(input.body, 'synthesis body'),
    createdAt: requireNonEmptyString(input.createdAt, 'synthesis createdAt'),
  });
}
