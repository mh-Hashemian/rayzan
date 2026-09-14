import {
  asAgentId,
  createMessageEnvelope,
  type Agent,
  type AgentId,
  type AgentRegistry,
} from '@rayzan/protocol';

import {
  createDispatchIntent,
  type DispatchIntent,
} from './dispatch-intent.js';
import type { DispatchPlan } from './dispatch-plan.js';
import { OrchestratorError } from './error.js';

export interface RoundParticipantContext {
  readonly participantIds: readonly string[];
}

export class DispatchPlanner {
  constructor(private readonly agents: AgentRegistry) {}

  plan(
    plan: DispatchPlan,
    context: RoundParticipantContext | undefined = undefined,
  ): DispatchIntent {
    const sender = this.#requireAgent(plan.senderId, 'sender');
    const recipientIds = this.#resolveRecipients(plan, sender, context);

    const message = createMessageEnvelope({
      id: plan.messageId,
      debateId: plan.debateId,
      ...(plan.roundId !== undefined ? { roundId: plan.roundId } : {}),
      senderId: sender.id,
      recipientIds,
      kind: plan.kind,
      body: plan.body,
    });

    return createDispatchIntent({
      message,
      referencedMessageIds: plan.referencedMessageIds,
    });
  }

  #resolveRecipients(
    plan: DispatchPlan,
    sender: Agent,
    context: RoundParticipantContext | undefined,
  ): readonly AgentId[] {
    if (plan.recipients.type === 'round-watchers') {
      return this.#resolveRoundWatchers(plan, sender, context);
    }

    return this.#resolveExplicitAgents(plan.recipients.agentIds);
  }

  #resolveRoundWatchers(
    plan: DispatchPlan,
    sender: Agent,
    context: RoundParticipantContext | undefined,
  ): readonly AgentId[] {
    if (plan.roundId === undefined) {
      throw new OrchestratorError('round-watchers selector requires a roundId');
    }

    if (sender.role !== 'coordinator') {
      throw new OrchestratorError(
        `round-watchers sender ${sender.id} must have role coordinator`,
      );
    }

    if (context === undefined) {
      throw new OrchestratorError(
        `round-watchers selector requires participant ids for round ${plan.roundId}`,
      );
    }

    const watchers: AgentId[] = [];
    const seen = new Set<string>();

    for (const rawId of context.participantIds) {
      const participantId = asAgentId(rawId);
      if (seen.has(participantId)) {
        throw new OrchestratorError(
          `duplicate round participant id: ${participantId}`,
        );
      }
      seen.add(participantId);

      const participant = this.#requireAgent(
        participantId,
        'round participant',
      );
      if (participant.role === 'watcher') {
        watchers.push(participant.id);
      }
    }

    if (watchers.length === 0) {
      throw new OrchestratorError(
        `round ${plan.roundId} has no watcher participants`,
      );
    }

    return Object.freeze(watchers);
  }

  #resolveExplicitAgents(agentIds: readonly AgentId[]): readonly AgentId[] {
    return Object.freeze(
      agentIds.map((agentId) => this.#requireAgent(agentId, 'recipient').id),
    );
  }

  #requireAgent(id: string, label: string): Agent {
    const agent = this.agents.getById(asAgentId(id));
    if (agent === undefined) {
      throw new OrchestratorError(`unknown ${label}: ${id}`);
    }
    return agent;
  }
}
