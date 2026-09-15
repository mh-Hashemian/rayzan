import type { Agent, AgentId, MessageId } from '@rayzan/protocol';
import {
  OrchestratorError,
  type CoordinatorCommandBatch,
  type DispatchCommand,
} from '@rayzan/orchestrator';

export interface AttributedWatcherResponse {
  readonly agentId: AgentId;
  readonly name: string;
  readonly messageId: MessageId;
  readonly body: string;
}

export interface WatcherChallenge {
  readonly agentId: AgentId;
  readonly name: string;
  readonly messageId: string;
  readonly challenge: string;
  readonly referencedMessageIds: readonly string[];
}

export function commonRound1Evidence(input: {
  readonly responses: readonly AttributedWatcherResponse[];
}): string {
  const blocks = input.responses.map(
    (response) => `${response.name}:
${response.body}`,
  );
  return `COMMON ROUND 1 EVIDENCE
=======================
${blocks.join('\n\n')}`;
}

export function round1EvidencePacket(input: {
  readonly problem: string;
  readonly coordinatorBrief?: string;
  readonly responses: readonly AttributedWatcherResponse[];
}): string {
  const responses = input.responses
    .map(
      (response) => `${response.name} Round 1 Response
=======================
${response.body}`,
    )
    .join('\n\n');
  return `Original Operator Problem
=======================
${input.problem}

Coordinator Round 1 Brief
=======================
${input.coordinatorBrief?.trim() || '(none)'}

${responses}`;
}

export function composeRound2WatcherBody(
  watcherName: string,
  commonEvidence: string,
  challenge: string,
): string {
  return `ROLE
====
You are ${watcherName}, a Watcher in Round 2.

${commonEvidence}

PERSONALIZED COORDINATOR CHALLENGE
==================================
${challenge}`;
}

export function mergeReferencedMessageIds(
  fromCoordinator: readonly string[],
  baselineIds: readonly string[],
): readonly string[] {
  const merged: string[] = [];
  for (const id of [...fromCoordinator, ...baselineIds]) {
    if (!merged.includes(id)) {
      merged.push(id);
    }
  }
  return Object.freeze(merged);
}

export function watcherChallengesFromBatch(input: {
  readonly batch: CoordinatorCommandBatch;
  readonly watchers: readonly Agent[];
}): readonly WatcherChallenge[] {
  const dispatches = input.batch.commands.filter(
    (command): command is DispatchCommand => command.type === 'dispatch',
  );
  if (dispatches.length !== input.batch.commands.length) {
    throw new OrchestratorError(
      'Round 2 Coordinator plan must contain only dispatch commands',
    );
  }
  if (dispatches.length !== input.watchers.length) {
    throw new OrchestratorError(
      `Round 2 Coordinator plan must contain exactly one dispatch per Watcher (${input.watchers.length})`,
    );
  }

  const remaining = new Map(
    input.watchers.map((watcher) => [watcher.id, watcher]),
  );
  const challenges: WatcherChallenge[] = [];

  for (const command of dispatches) {
    if (command.recipients.type !== 'explicit-agents') {
      throw new OrchestratorError(
        'Round 2 dispatch recipients must be explicit-agents with one Watcher',
      );
    }
    if (command.recipients.agentIds.length !== 1) {
      throw new OrchestratorError(
        'Round 2 dispatch must target exactly one Watcher',
      );
    }
    const agentId = command.recipients.agentIds[0]!;
    const watcher = remaining.get(agentId);
    if (watcher === undefined) {
      throw new OrchestratorError(
        `Round 2 dispatch recipient is not an unused Round 1 Watcher: ${agentId}`,
      );
    }
    remaining.delete(agentId);
    challenges.push({
      agentId: watcher.id,
      name: watcher.name,
      messageId: command.messageId,
      challenge: command.body,
      referencedMessageIds: command.referencedMessageIds,
    });
  }

  if (remaining.size > 0) {
    throw new OrchestratorError(
      'Round 2 Coordinator plan is missing a Watcher dispatch',
    );
  }

  return Object.freeze(challenges);
}
