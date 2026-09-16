import type { AgentRole } from '@rayzan/protocol';

/** Fixed product team — seeded on server start; Operator only toggles Watcher participation. */
export interface DefaultTeamMember {
  readonly id: string;
  readonly name: string;
  readonly role: Exclude<AgentRole, 'operator' | 'coder'>;
  readonly provider: string;
}

export const DEFAULT_TEAM: readonly DefaultTeamMember[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    role: 'coordinator',
    provider: 'DeepSeek',
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    role: 'watcher',
    provider: 'OpenAI',
  },
  {
    id: 'qwen',
    name: 'Qwen',
    role: 'watcher',
    provider: 'Alibaba Cloud',
  },
  {
    id: 'glm',
    name: 'GLM',
    role: 'watcher',
    provider: 'Zhipu AI',
  },
  {
    id: 'grok',
    name: 'Grok',
    role: 'watcher',
    provider: 'xAI',
  },
];
