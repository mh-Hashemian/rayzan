import { asAgentId, type AgentId } from './ids.js';
import { requireAllowedValue, requireNonEmptyString } from './validate.js';

export const AGENT_ROLES = [
  'operator',
  'coordinator',
  'watcher',
  'coder',
] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];

export interface Agent {
  readonly id: AgentId;
  readonly name: string;
  readonly role: AgentRole;
}

export function createAgent(input: {
  id: string;
  name: string;
  role: AgentRole;
}): Agent {
  return Object.freeze({
    id: asAgentId(input.id),
    name: requireNonEmptyString(input.name, 'agent name'),
    role: requireAllowedValue(input.role, AGENT_ROLES, 'agent role'),
  });
}
