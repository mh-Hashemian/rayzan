import type { ReactNode } from 'react';

import { ChatGptLogo } from './chatgpt.js';
import { DeepSeekLogo } from './deepseek.js';
import { FallbackLogo } from './fallback.js';
import { GlmLogo } from './glm.js';
import { QwenLogo } from './qwen.js';

export function providerKey(name: string, provider?: string): string {
  const raw = `${provider ?? ''} ${name}`.toLowerCase();
  if (raw.includes('deepseek')) {
    return 'deepseek';
  }
  if (raw.includes('qwen')) {
    return 'qwen';
  }
  if (raw.includes('glm')) {
    return 'glm';
  }
  if (raw.includes('chatgpt') || raw.includes('openai')) {
    return 'chatgpt';
  }
  return 'fallback';
}

export function ProviderLogo(input: {
  readonly name: string;
  readonly provider?: string;
  readonly size?: number;
}): ReactNode {
  const size = input.size ?? 32;
  switch (providerKey(input.name, input.provider)) {
    case 'deepseek':
      return <DeepSeekLogo size={size} />;
    case 'qwen':
      return <QwenLogo size={size} />;
    case 'glm':
      return <GlmLogo size={size} />;
    case 'chatgpt':
      return <ChatGptLogo size={size} />;
    default:
      return <FallbackLogo size={size} />;
  }
}
