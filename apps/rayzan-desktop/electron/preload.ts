import { contextBridge, ipcRenderer } from 'electron';

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

contextBridge.exposeInMainWorld('rayzanDesktop', {
  getInfo: (): Promise<DesktopInfo> => ipcRenderer.invoke('desktop:info'),
  retryRuntime: (): Promise<DesktopInfo> => ipcRenderer.invoke('desktop:retry'),
  openDebug: (): Promise<void> => ipcRenderer.invoke('desktop:open-debug'),
  listProviders: (): Promise<readonly ProviderStatus[]> =>
    ipcRenderer.invoke('providers:list'),
  refreshProviders: (): Promise<readonly ProviderStatus[]> =>
    ipcRenderer.invoke('providers:refresh'),
  providersRestoring: (): Promise<boolean> =>
    ipcRenderer.invoke('providers:restoring'),
  connectProvider: (providerId: ManagedProviderId): Promise<ProviderStatus> =>
    ipcRenderer.invoke('providers:connect', providerId),
  openProvider: (providerId: ManagedProviderId): Promise<void> =>
    ipcRenderer.invoke('providers:open', providerId),
  reconnectProvider: (
    providerId: ManagedProviderId,
  ): Promise<ProviderStatus> =>
    ipcRenderer.invoke('providers:reconnect', providerId),
  attachDebateConversations: (payload: {
    readonly debateId: string;
    readonly agents: readonly ManagedAttachAgent[];
  }): Promise<ManagedAttachResult> =>
    ipcRenderer.invoke('providers:attach-debate', payload),
  debateOwnership: (
    debateId: string,
  ): Promise<readonly DebateConversationOwnership[]> =>
    ipcRenderer.invoke('providers:debate-ownership', debateId),
  stopDebateProviders: (debateId: string): Promise<void> =>
    ipcRenderer.invoke('providers:stop-debate', debateId),
});
