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

export interface ProviderConversationRef {
  readonly id: string;
  readonly providerId: ManagedProviderId;
  readonly url: string;
  readonly createdAt: string;
}

export interface DebateConversationOwnership {
  readonly debateId: string;
  readonly agentId: string;
  readonly providerId: ManagedProviderId;
  readonly conversation: ProviderConversationRef;
  readonly status: 'active' | 'closed' | 'failed';
  readonly createdAt: string;
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

export const MANAGED_PROVIDERS: readonly {
  readonly id: ManagedProviderId;
  readonly label: string;
  readonly homeUrl: string;
  readonly partition: string;
}[] = [
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    homeUrl: 'https://chatgpt.com/',
    partition: 'persist:rayzan-chatgpt',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    homeUrl: 'https://chat.deepseek.com/',
    partition: 'persist:rayzan-deepseek',
  },
  {
    id: 'qwen',
    label: 'Qwen',
    homeUrl: 'https://chat.qwen.ai/',
    partition: 'persist:rayzan-qwen',
  },
  {
    id: 'glm',
    label: 'GLM',
    homeUrl: 'https://chat.z.ai/',
    partition: 'persist:rayzan-glm',
  },
] as const;

export function providerIdFromAgent(input: {
  readonly id?: string;
  readonly agentId?: string;
  readonly name: string;
  readonly provider?: string;
}): ManagedProviderId | undefined {
  const raw = `${input.id ?? ''} ${input.agentId ?? ''} ${input.name} ${input.provider ?? ''}`.toLowerCase();
  if (raw.includes('deepseek')) {
    return 'deepseek';
  }
  if (raw.includes('chatgpt') || raw.includes('openai')) {
    return 'chatgpt';
  }
  if (raw.includes('qwen') || raw.includes('alibaba')) {
    return 'qwen';
  }
  if (raw.includes('glm') || raw.includes('zhipu') || raw.includes('chatglm')) {
    return 'glm';
  }
  return undefined;
}
