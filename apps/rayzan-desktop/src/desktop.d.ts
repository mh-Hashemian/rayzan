export interface DesktopInfo {
  readonly userDataPath: string;
  readonly databasePath: string;
  readonly port: number;
  readonly ownsRuntime: boolean;
  readonly runtimeError?: string;
}

export type ManagedProviderId = 'chatgpt' | 'deepseek' | 'qwen' | 'glm';

export type ProviderConnectionStatus =
  | 'not_connected'
  | 'restoring'
  | 'connecting'
  | 'connected'
  | 'needs_attention';

export interface ProviderStatus {
  readonly id: ManagedProviderId;
  readonly label: string;
  readonly status: ProviderConnectionStatus;
  readonly detail?: string;
}

export interface ManagedAttachAgent {
  readonly agentId: string;
  readonly name: string;
  readonly provider?: string;
}

export interface ManagedAttachResult {
  readonly ok: boolean;
  readonly mode: 'managed' | 'extension-fallback' | 'mixed';
  readonly attached: readonly {
    readonly agentId: string;
    readonly providerId: ManagedProviderId;
    readonly conversationId: string;
  }[];
  readonly skipped: readonly {
    readonly agentId: string;
    readonly reason: string;
  }[];
  readonly error?: string;
}

export interface DebateConversationOwnership {
  readonly debateId: string;
  readonly agentId: string;
  readonly providerId: ManagedProviderId;
  readonly conversation: {
    readonly id: string;
    readonly providerId: ManagedProviderId;
    readonly url: string;
    readonly createdAt: string;
  };
  readonly status: 'active' | 'closed' | 'failed';
  readonly createdAt: string;
}

export interface DesktopApi {
  getInfo(): Promise<DesktopInfo>;
  retryRuntime(): Promise<DesktopInfo>;
  openDebug(): Promise<void>;
  listProviders?(): Promise<readonly ProviderStatus[]>;
  refreshProviders?(): Promise<readonly ProviderStatus[]>;
  providersRestoring?(): Promise<boolean>;
  connectProvider?(providerId: ManagedProviderId): Promise<ProviderStatus>;
  openProvider?(providerId: ManagedProviderId): Promise<void>;
  reconnectProvider?(providerId: ManagedProviderId): Promise<ProviderStatus>;
  attachDebateConversations?(payload: {
    readonly debateId: string;
    readonly agents: readonly ManagedAttachAgent[];
  }): Promise<ManagedAttachResult>;
  debateOwnership?(
    debateId: string,
  ): Promise<readonly DebateConversationOwnership[]>;
  stopDebateProviders?(debateId: string): Promise<void>;
}

declare global {
  interface Window {
    readonly rayzanDesktop?: DesktopApi;
  }
}

export {};
