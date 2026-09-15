export { DEFAULT_BRIDGE_URL } from './bridge-http.js';

export interface AgentSummary {
  readonly id: string;
  readonly name: string;
  readonly role: string;
}

export interface PendingJob {
  readonly deliveryId: string;
  readonly messageId: string;
  readonly body: string;
  readonly capture?: boolean;
}

interface BridgeProxyResult<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: string;
}

async function viaBackground<T>(
  type: 'bridge-get' | 'bridge-post',
  path: string,
  body?: unknown,
): Promise<T> {
  const result = (await chrome.runtime.sendMessage({
    type,
    path,
    body,
  })) as BridgeProxyResult<T> | undefined;
  if (result === undefined) {
    throw new Error('bridge proxy returned no response');
  }
  if (!result.ok) {
    throw new Error(result.error ?? 'bridge request failed');
  }
  return result.data as T;
}

export async function bridgeGet<T>(path: string): Promise<T> {
  return viaBackground<T>('bridge-get', path);
}

export async function bridgePost<T>(path: string, body: unknown): Promise<T> {
  return viaBackground<T>('bridge-post', path, body);
}
