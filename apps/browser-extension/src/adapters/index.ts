import { deepSeekAdapter } from './deepseek.js';
import { fixtureAdapter } from './fixture.js';
import { glmAdapter } from './glm.js';
import { qwenAdapter } from './qwen.js';
import type { BrowserAdapter } from './types.js';

const adapters: readonly BrowserAdapter[] = [
  fixtureAdapter,
  deepSeekAdapter,
  qwenAdapter,
  glmAdapter,
];

export function adapterFor(url: string): BrowserAdapter {
  const adapter = adapters.find((item) => item.canHandle(url));
  if (adapter === undefined) {
    throw new Error(`no browser adapter handles ${url}`);
  }
  return adapter;
}

export type { BrowserAdapter } from './types.js';
