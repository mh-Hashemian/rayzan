import type { AssistantTurn, CaptureSnapshot } from './types.js';

const IDENTITY_ATTRS = [
  'data-message-id',
  'data-msgid',
  'data-messageid',
  'data-id',
  'data-turn-id',
  'data-unique-id',
] as const;

export function turnIdentity(element: Element, index: number): string {
  for (const name of IDENTITY_ATTRS) {
    const value = element.getAttribute(name)?.trim();
    if (value) {
      return `${name}:${value}`;
    }
  }
  const id = element.getAttribute('id')?.trim();
  if (id && !/^ember|react|aria/.test(id)) {
    return `id:${id}`;
  }
  return `idx:${index}`;
}

export function liveSnapshotFromTurns(
  turns: readonly AssistantTurn[],
): CaptureSnapshot & { readonly turns: readonly AssistantTurn[] } {
  const last = turns.at(-1);
  return {
    turns,
    identities: turns.map((turn) => turn.identity),
    assistantTurnCount: turns.length,
    lastAssistantText: last?.finalText,
    lastIncomplete: last ? last.thinkingOnly || !last.hasFinalAnswer : false,
    elements: new Set(turns.map((turn) => turn.element)),
  };
}

export function selectTrackedTurn(
  turns: readonly AssistantTurn[],
  snapshot: CaptureSnapshot,
): AssistantTurn | undefined {
  const elements = snapshot.elements;
  if (elements && elements.size > 0) {
    const byNode = turns.filter((turn) => !elements.has(turn.element));
    if (byNode.length > 0 && byNode.length < turns.length) {
      return byNode.at(-1);
    }
    if (
      byNode.length === turns.length &&
      snapshot.assistantTurnCount > 0 &&
      turns.length > snapshot.assistantTurnCount
    ) {
      return turns[snapshot.assistantTurnCount];
    }
    if (byNode.length === turns.length && snapshot.assistantTurnCount === 0) {
      return turns.at(-1);
    }
  }

  const known = new Set(snapshot.identities);
  const unknown = turns.filter((turn) => !known.has(turn.identity));
  if (unknown.length > 0) {
    return unknown.at(-1);
  }
  if (turns.length > snapshot.assistantTurnCount) {
    return turns[snapshot.assistantTurnCount];
  }

  const last = turns.at(-1);
  const lastIdentity = snapshot.identities.at(-1);
  if (
    last &&
    snapshot.lastIncomplete &&
    lastIdentity !== undefined &&
    last.identity === lastIdentity
  ) {
    return last;
  }
  return undefined;
}

export function resolveTrackedTurn(
  turns: readonly AssistantTurn[],
  snapshot: CaptureSnapshot,
  trackedIdentity: string | undefined,
): AssistantTurn | undefined {
  if (trackedIdentity) {
    const stillThere = turns.find((turn) => turn.identity === trackedIdentity);
    if (stillThere) {
      return stillThere;
    }
    return selectTrackedTurn(turns, snapshot);
  }
  return selectTrackedTurn(turns, snapshot);
}
