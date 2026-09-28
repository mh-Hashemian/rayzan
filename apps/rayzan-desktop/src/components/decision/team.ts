import type { AgentView } from '../../api.js';

/**
 * Team choice held by the New Decision wizard. It is draft state: nothing is
 * pushed to the runtime until the Operator presses Start, so editing the form
 * never mutates the running app.
 */
export interface TeamDraft {
  readonly coordinatorId: string;
  readonly watcherIds: readonly string[];
}

export type TeamReadiness =
  | { readonly canStart: true }
  | { readonly canStart: false; readonly message: string };

export const REQUIRED_WATCHERS = 1;

export const NO_COORDINATOR_MESSAGE =
  'Choose a connected Coordinator to continue.';
export const NO_WATCHER_MESSAGE =
  'Choose at least one connected Watcher to continue.';
export const DISCONNECTED_MESSAGE =
  'Connect the selected Coordinator and Watchers before starting.';

/** Agents the runtime allows in a debate team: any non-operator role. */
export function teamCandidates(
  team: readonly AgentView[],
): readonly AgentView[] {
  return team.filter(
    (agent) => agent.role === 'coordinator' || agent.role === 'watcher',
  );
}

export function isConnected(agent: AgentView): boolean {
  return agent.connection === 'connected';
}

/**
 * Seed the draft from the team the runtime currently has. Watchers that are
 * enabled globally but offline are left out, so a fresh wizard offers a team
 * that can actually start; an explicit selection is kept even if it later
 * drops (see `syncTeamDraft`).
 */
export function deriveTeamDraft(team: readonly AgentView[]): TeamDraft {
  return {
    coordinatorId: team.find((agent) => agent.role === 'coordinator')?.id ?? '',
    watcherIds: team
      .filter((agent) => agent.role === 'watcher' && agent.enabled)
      .filter(isConnected)
      .map((agent) => agent.id),
  };
}

/**
 * Re-apply a draft to freshly hydrated team state. Selections survive a
 * disconnect (so Start can explain it), but ids the runtime no longer knows
 * are dropped, and a Coordinator that vanished falls back to the live one.
 */
export function syncTeamDraft(
  draft: TeamDraft,
  team: readonly AgentView[],
): TeamDraft {
  const known = new Set(team.map((agent) => agent.id));
  const coordinatorId = known.has(draft.coordinatorId)
    ? draft.coordinatorId
    : (team.find((agent) => agent.role === 'coordinator')?.id ?? '');
  return {
    coordinatorId,
    watcherIds: draft.watcherIds.filter(
      (id) => known.has(id) && id !== coordinatorId,
    ),
  };
}

/** Promoting a Watcher removes it from the Watcher selection. */
export function selectCoordinator(draft: TeamDraft, agentId: string): TeamDraft {
  return {
    coordinatorId: agentId,
    watcherIds: draft.watcherIds.filter((id) => id !== agentId),
  };
}

/** The Coordinator is never also a Watcher in the same debate. */
export function toggleWatcher(
  draft: TeamDraft,
  agentId: string,
  selected: boolean,
): TeamDraft {
  if (agentId === draft.coordinatorId) {
    return draft;
  }
  const already = draft.watcherIds.includes(agentId);
  if (selected === already) {
    return draft;
  }
  return {
    coordinatorId: draft.coordinatorId,
    watcherIds: selected
      ? [...draft.watcherIds, agentId]
      : draft.watcherIds.filter((id) => id !== agentId),
  };
}

export function draftedCoordinator(
  draft: TeamDraft,
  team: readonly AgentView[],
): AgentView | undefined {
  return team.find((agent) => agent.id === draft.coordinatorId);
}

export function draftedWatchers(
  draft: TeamDraft,
  team: readonly AgentView[],
): readonly AgentView[] {
  return draft.watcherIds.flatMap((id) => {
    const agent = team.find((candidate) => candidate.id === id);
    return agent === undefined ? [] : [agent];
  });
}

/**
 * Readiness is derived from live `/api/status` connection state on every
 * render, never from what the wizard assumed when the Operator arrived.
 */
export function validateTeamDraft(
  draft: TeamDraft,
  team: readonly AgentView[],
): TeamReadiness {
  const coordinator = draftedCoordinator(draft, team);
  if (coordinator === undefined) {
    return { canStart: false, message: NO_COORDINATOR_MESSAGE };
  }
  const watchers = draftedWatchers(draft, team);
  if (watchers.length < REQUIRED_WATCHERS) {
    return { canStart: false, message: NO_WATCHER_MESSAGE };
  }
  const offline = [coordinator, ...watchers].filter(
    (agent) => !isConnected(agent),
  );
  if (offline.length > 0) {
    return { canStart: false, message: DISCONNECTED_MESSAGE };
  }
  return { canStart: true };
}
