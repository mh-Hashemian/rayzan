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
  return composeRoundWatcherBody(2, watcherName, commonEvidence, challenge);
}

export function composeRoundWatcherBody(
  roundNumber: number,
  watcherName: string,
  commonEvidence: string,
  challenge: string,
): string {
  // Thin mechanical framing only. The Coordinator owns question, format, and depth.
  const evidence = commonEvidence.trim();
  return `ROLE
====
You are ${watcherName}, a Watcher in consultation Round ${roundNumber}.

Answer the Coordinator's request below. Follow any format or depth constraints exactly.
Do not reveal hidden chain-of-thought.

${evidence ? `${evidence}\n\n` : ''}COORDINATOR REQUEST
===================
${challenge}`;
}

export interface ForwardSourceBlock {
  readonly authorName: string;
  readonly body: string;
}

/** Build a Watcher-visible forward payload with verbatim provenance. */
export function composeForwardWatcherBody(
  roundNumber: number,
  watcherName: string,
  sources: readonly ForwardSourceBlock[],
  instruction?: string,
): string {
  if (sources.length === 0) {
    throw new OrchestratorError('forward requires at least one source message');
  }
  const sourceBlocks = sources
    .map(
      (source) => `${source.authorName}:
${source.body}`,
    )
    .join('\n\n');
  const instructionBlock =
    instruction && instruction.trim().length > 0
      ? `\n\nCOORDINATOR REQUEST
===================
${instruction.trim()}`
      : '';
  return `ROLE
====
You are ${watcherName}, a Watcher in consultation Round ${roundNumber}.

The following evidence is forwarded verbatim. Authorship is preserved.
Do not reveal hidden chain-of-thought.

SOURCE
======
${sourceBlocks}${instructionBlock}`;
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

/**
 * Extract selective Watcher challenges from a Coordinator dispatch batch.
 * One dispatch may target one or many Watchers; not every Watcher must appear.
 */
export function watcherChallengesFromBatch(input: {
  readonly batch: CoordinatorCommandBatch;
  readonly watchers: readonly Agent[];
}): readonly WatcherChallenge[] {
  const dispatches = input.batch.commands.filter(
    (command): command is DispatchCommand => command.type === 'dispatch',
  );
  if (dispatches.length === 0) {
    throw new OrchestratorError(
      'Coordinator action must contain at least one dispatch, or a checkpoint',
    );
  }
  if (dispatches.length !== input.batch.commands.length) {
    throw new OrchestratorError(
      'dispatch batches cannot mix non-dispatch commands',
    );
  }

  const byId = new Map(input.watchers.map((watcher) => [watcher.id, watcher]));
  const challenges: WatcherChallenge[] = [];

  for (const command of dispatches) {
    const recipientIds =
      command.recipients.type === 'explicit-agents'
        ? command.recipients.agentIds
        : input.watchers.map((watcher) => watcher.id);

    if (recipientIds.length === 0) {
      throw new OrchestratorError('dispatch recipients cannot be empty');
    }

    for (const agentId of recipientIds) {
      const watcher = byId.get(agentId);
      if (watcher === undefined) {
        throw new OrchestratorError(
          `dispatch recipient is not an active Watcher: ${agentId}`,
        );
      }
      challenges.push({
        agentId: watcher.id,
        name: watcher.name,
        messageId: command.messageId,
        challenge: command.body,
        referencedMessageIds: command.referencedMessageIds,
      });
    }
  }

  return Object.freeze(challenges);
}
