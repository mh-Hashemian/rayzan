import type { CaptureSnapshot, CaptureTurn } from './types.js';

const IDENTITY_ATTRS = [
  'data-message-id',
  'data-msgid',
  'data-messageid',
  'data-id',
  'data-turn-id',
  'data-unique-id',
] as const;

export function turnIdentityFromAttributes(
  getAttr: (name: string) => string | null | undefined,
  index: number,
  id?: string | null,
): string {
  for (const name of IDENTITY_ATTRS) {
    const value = getAttr(name)?.trim();
    if (value) {
      return `${name}:${value}`;
    }
  }
  const trimmedId = id?.trim();
  if (trimmedId && !/^ember|react|aria/.test(trimmedId)) {
    return `id:${trimmedId}`;
  }
  return `idx:${index}`;
}

export function liveSnapshotFromTurns(
  turns: readonly CaptureTurn[],
): CaptureSnapshot & { readonly turns: readonly CaptureTurn[] } {
  const last = turns.at(-1);
  return {
    turns,
    identities: turns.map((turn) => turn.identity),
    assistantTurnCount: turns.length,
    lastAssistantText: last?.finalText,
    lastIncomplete: last ? last.thinkingOnly || !last.hasFinalAnswer : false,
  };
}

export function selectTrackedTurn(
  turns: readonly CaptureTurn[],
  snapshot: CaptureSnapshot,
): CaptureTurn | undefined {
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
  turns: readonly CaptureTurn[],
  snapshot: CaptureSnapshot,
  trackedIdentity: string | undefined,
): CaptureTurn | undefined {
  if (trackedIdentity) {
    const stillThere = turns.find((turn) => turn.identity === trackedIdentity);
    if (stillThere) {
      return stillThere;
    }
    return selectTrackedTurn(turns, snapshot);
  }
  return selectTrackedTurn(turns, snapshot);
}
