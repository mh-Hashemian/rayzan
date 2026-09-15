import type { RayzanRuntime } from './runtime.js';

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
  readonly browserBridge: 'ready';
  readonly activeDebate: {
    readonly id: string;
    readonly topic: string;
  } | null;
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
  const agents = snapshot.agents.filter((agent) => agent.role !== 'operator');
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
    agents: agents.length,
    browserBridge: 'ready',
    activeDebate: snapshot.debate
      ? { id: snapshot.debate.id, topic: snapshot.debate.topic }
      : null,
  };
}
