export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8787';

export async function bridgeFetch<T>(
  path: string,
  init: RequestInit | undefined,
  bridgeUrl = DEFAULT_BRIDGE_URL,
): Promise<T> {
  const response = await fetch(`${bridgeUrl}${path}`, init);
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? response.statusText);
  }
  return data;
}
