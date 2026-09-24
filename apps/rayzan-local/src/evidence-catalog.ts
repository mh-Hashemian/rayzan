import type { Agent, MessageEnvelope, MessageId, Round } from '@rayzan/protocol';

export interface EvidenceEntry {
  readonly ref: string;
  readonly messageId: MessageId;
  readonly authorId: string;
  readonly authorName: string;
  readonly roundNumber: number;
  readonly kind: string;
  readonly body: string;
}

/**
 * Stable Coordinator-facing evidence catalog.
 * Refs are deterministic from debate message order: E1, E2, …
 * Includes Watcher responses and Operator answers to ask_operator.
 */
export function buildEvidenceCatalog(input: {
  readonly messages: readonly MessageEnvelope[];
  readonly rounds: readonly Round[];
  readonly agents: readonly Agent[];
  readonly operatorAnswerBodies?: readonly string[];
}): readonly EvidenceEntry[] {
  const roundById = new Map(input.rounds.map((round) => [round.id, round]));
  const agentById = new Map(input.agents.map((agent) => [agent.id, agent]));
  const entries: EvidenceEntry[] = [];
  let index = 0;

  for (const message of input.messages) {
    const author = agentById.get(message.senderId);
    const watcherResponse =
      message.kind === 'response' && author?.role === 'watcher';
    const operatorAnswer =
      message.kind === 'input' &&
      message.senderId === 'operator' &&
      isOperatorAnswerBody(message.body);
    if (!watcherResponse && !operatorAnswer) {
      continue;
    }
    index += 1;
    const round = message.roundId
      ? roundById.get(message.roundId)
      : undefined;
    entries.push({
      ref: `E${index}`,
      messageId: message.id,
      authorId: message.senderId,
      authorName: author?.name ?? message.senderId,
      roundNumber: round?.number ?? 0,
      kind: message.kind,
      body: message.body,
    });
  }

  return Object.freeze(entries);
}

function isOperatorAnswerBody(body: string): boolean {
  return /^OPERATOR ANSWER\b/i.test(body.trim());
}

export function formatEvidenceCatalog(
  entries: readonly EvidenceEntry[],
): string {
  if (entries.length === 0) {
    return '(no forwardable evidence yet)';
  }
  return entries
    .map(
      (entry) =>
        `[${entry.ref}]
Author: ${entry.authorName}
Round: ${entry.roundNumber || '(n/a)'}
Content:
${entry.body}`,
    )
    .join('\n\n');
}

export function resolveEvidenceRefs(input: {
  readonly catalog: readonly EvidenceEntry[];
  readonly sourceRefs: readonly string[];
  readonly sourceMessageIds: readonly MessageId[];
}): readonly EvidenceEntry[] {
  const byRef = new Map(input.catalog.map((entry) => [entry.ref, entry]));
  const byId = new Map(input.catalog.map((entry) => [entry.messageId, entry]));
  const resolved: EvidenceEntry[] = [];
  const seen = new Set<string>();

  for (const ref of input.sourceRefs) {
    const entry = byRef.get(ref);
    if (entry === undefined) {
      throw new Error(`unknown evidence ref: ${ref}`);
    }
    if (!seen.has(entry.messageId)) {
      seen.add(entry.messageId);
      resolved.push(entry);
    }
  }
  for (const messageId of input.sourceMessageIds) {
    const entry = byId.get(messageId);
    if (entry === undefined) {
      throw new Error(`unknown evidence message id: ${messageId}`);
    }
    if (!seen.has(entry.messageId)) {
      seen.add(entry.messageId);
      resolved.push(entry);
    }
  }

  if (resolved.length === 0) {
    throw new Error('forward requires at least one resolvable source');
  }
  return Object.freeze(resolved);
}
