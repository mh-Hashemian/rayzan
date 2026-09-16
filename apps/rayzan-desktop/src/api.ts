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

export interface AgentView {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly provider?: string;
  readonly connected: boolean;
  readonly bindingState?: 'bound' | 'not-bound' | 'unavailable';
}

export interface RuntimeState {
  readonly agents: readonly AgentView[];
}

const ORIGIN = 'http://127.0.0.1:8787';

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

export async function fetchRegisteredAgents(): Promise<readonly AgentView[]> {
  const listed = await getJson<
    readonly { id: string; name: string; role: string }[]
  >('/api/agents');
  return listed
    .filter((agent) => agent.role !== 'operator')
    .map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      connected: false,
    }));
}

interface StatePayload {
  readonly agents?: readonly {
    readonly id: string;
    readonly name: string;
    readonly role: string;
    readonly provider?: string;
    readonly connected?: boolean;
  }[];
  readonly browserBindings?: readonly {
    readonly agentId: string;
    readonly provider?: string;
    readonly state: 'bound' | 'not-bound' | 'unavailable';
  }[];
}

export async function fetchRuntimeState(): Promise<RuntimeState> {
  const payload = await getJson<StatePayload>('/api/state');
  const bindings = new Map(
    (payload.browserBindings ?? []).map((binding) => [binding.agentId, binding]),
  );
  const agents = (payload.agents ?? [])
    .filter((agent) => agent.role !== 'operator')
    .map((agent) => {
      const binding = bindings.get(agent.id);
      return {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        ...(binding?.provider ?? agent.provider
          ? { provider: binding?.provider ?? agent.provider }
          : {}),
        connected: agent.connected === true || binding?.state === 'bound',
        ...(binding ? { bindingState: binding.state } : {}),
      };
    });
  return { agents };
}

export function debateTitle(topic: string): string {
  const line = topic.split('\n').find((part) => part.trim().length > 0);
  return (line ?? topic).trim();
}
