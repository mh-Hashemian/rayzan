export interface DebateView {
  readonly id: string;
  readonly topic: string;
  readonly status: string;
  readonly createdAt?: string;
  readonly completedAt?: string;
}

export type AgentConnection = 'connected' | 'disconnected' | 'error';

export interface AgentView {
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
  readonly team: readonly AgentView[];
  readonly browserBridge: 'ready';
  readonly activeDebate: DebateView | null;
  readonly debateHistory: readonly DebateView[];
}

const ORIGIN = 'http://127.0.0.1:8787';

const STREAM_EVENTS = [
  'AGENT_REGISTERED',
  'BINDING_CHANGED',
  'COORDINATOR_CHANGED',
  'WATCHER_PARTICIPATION_CHANGED',
  'DELIVERY_CONFIRMED',
  'RESPONSE_CAPTURED',
  'DEBATE_CREATED',
  'SYNTHESIS_CREATED',
] as const;

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${ORIGIN}${path}`);
  if (!response.ok) {
    throw new Error(`status ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function fetchDesktopStatus(): Promise<RayzanDesktopStatus> {
  return getJson<RayzanDesktopStatus>('/api/status');
}

export async function changeCoordinator(
  agentId: string,
): Promise<RayzanDesktopStatus> {
  const response = await fetch(`${ORIGIN}/api/session/change-coordinator`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(body.error ?? `status ${response.status}`);
  }
  return (await response.json()) as RayzanDesktopStatus;
}

export async function setWatcherParticipation(
  agentId: string,
  enabled: boolean,
): Promise<RayzanDesktopStatus> {
  const response = await fetch(
    `${ORIGIN}/api/session/set-watcher-participation`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, enabled }),
    },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(body.error ?? `status ${response.status}`);
  }
  return (await response.json()) as RayzanDesktopStatus;
}

export function openRuntimeEventStream(
  onEvent: () => void,
): () => void {
  const source = new EventSource(`${ORIGIN}/api/events/stream`);
  source.onopen = () => {
    onEvent();
  };
  for (const type of STREAM_EVENTS) {
    source.addEventListener(type, () => {
      onEvent();
    });
  }
  return () => {
    source.close();
  };
}

export function debateTitle(topic: string): string {
  const line = topic.split('\n').find((part) => part.trim().length > 0);
  return (line ?? topic).trim();
}
