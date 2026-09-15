export interface DebateView {
  readonly id: string;
  readonly topic: string;
  readonly status: string;
  readonly createdAt?: string;
  readonly completedAt?: string;
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
  readonly browserBridge: 'ready';
  readonly activeDebate: DebateView | null;
  readonly debateHistory: readonly DebateView[];
}

const STATUS_URL = 'http://127.0.0.1:8787/api/status';

export async function fetchDesktopStatus(): Promise<RayzanDesktopStatus> {
  const response = await fetch(STATUS_URL);
  if (!response.ok) {
    throw new Error(`status ${response.status}`);
  }
  return (await response.json()) as RayzanDesktopStatus;
}
