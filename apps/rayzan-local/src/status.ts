import type { DebateView, RayzanRuntime } from './runtime.js';

export type AgentConnection = 'connected' | 'disconnected' | 'error';

export interface TeamAgentView {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly provider?: string;
  readonly connection: AgentConnection;
  readonly enabled: boolean;
}

export interface RayzanDesktopStatus {
  readonly runtime: 'ready';
  readonly database: 'connected' | 'memory';
  readonly databasePath: string | null;
  readonly recovery: {
    readonly status: 'fresh' | 'restored' | 'failed';
    readonly eventsRead: number;
    readonly warnings: number;
    readonly replayStatus: string;
  };
  readonly agents: number;
  readonly team: readonly TeamAgentView[];
  readonly browserBridge: 'ready';
  readonly activeDebate: DebateView | null;
  readonly debateHistory: readonly DebateView[];
}

export function desktopStatus(
  runtime: RayzanRuntime,
  extras: { databasePath?: string } = {},
): RayzanDesktopStatus {
  const snapshot = runtime.snapshot();
  const replay = snapshot.replay;
  const eventsRead = replay.appliedEvents + replay.skippedEvents;
  const recoveryStatus =
    replay.status === 'FAILED'
      ? 'failed'
      : replay.status === 'FRESH'
        ? 'fresh'
        : 'restored';
  const bindings = new Map(
    snapshot.browserBindings.map((binding) => [binding.agentId, binding]),
  );
  const team = snapshot.agents
    .filter((agent) => agent.role !== 'operator')
    .map((agent) => {
      const binding = bindings.get(agent.id);
      const connection = teamConnection(
        agent.connected,
        agent.phase,
        binding?.state,
      );
      return {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        ...(binding?.provider ?? agent.provider
          ? { provider: binding?.provider ?? agent.provider }
          : {}),
        connection,
        enabled: agent.role === 'watcher' ? agent.enabled : true,
      };
    });
  return {
    runtime: 'ready',
    database: extras.databasePath ? 'connected' : 'memory',
    databasePath: extras.databasePath ?? null,
    recovery: {
      status: recoveryStatus,
      eventsRead,
      warnings: replay.warnings.length,
      replayStatus: replay.status,
    },
    agents: team.length,
    team,
    browserBridge: 'ready',
    activeDebate: snapshot.activeDebate ?? null,
    debateHistory: snapshot.debateHistory,
  };
}

function teamConnection(
  _presenceConnected: boolean,
  phase: string,
  bindingState: 'bound' | 'not-bound' | 'unavailable' | undefined,
): AgentConnection {
  // Only a live binding can be Connected/Error. Unbind and tab-close clear the
  // binding (or mark it unavailable) and must read as Disconnected — not Error.
  if (bindingState === 'bound') {
    return phase === 'error' ? 'error' : 'connected';
  }
  return 'disconnected';
}
