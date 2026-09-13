import type { Agent, AgentRole } from '../agent.js';
import type { AgentId } from '../ids.js';
import { ProtocolError } from '../validate.js';

export interface AgentRegistry {
  register(agent: Agent): Agent;
  getById(id: AgentId): Agent | undefined;
  list(): readonly Agent[];
  listByRole(role: AgentRole): readonly Agent[];
}

export class InMemoryAgentRegistry implements AgentRegistry {
  readonly #agents = new Map<AgentId, Agent>();

  register(agent: Agent): Agent {
    if (this.#agents.has(agent.id)) {
      throw new ProtocolError(`agent id already exists: ${agent.id}`);
    }

    this.#agents.set(agent.id, agent);
    return agent;
  }

  getById(id: AgentId): Agent | undefined {
    return this.#agents.get(id);
  }

  list(): readonly Agent[] {
    return [...this.#agents.values()];
  }

  listByRole(role: AgentRole): readonly Agent[] {
    return this.list().filter((agent) => agent.role === role);
  }
}
