import { adapterFor } from '../adapters/index.js';
import { bridgeGet, bridgePost, type PendingJob } from '../bridge-client.js';

interface Binding {
  agentId: string;
  role: string;
  name: string;
}

async function bindingForThisTab(): Promise<Binding | undefined> {
  return chrome.runtime.sendMessage({ type: 'get-binding' }) as Promise<
    Binding | undefined
  >;
}

let blockedDeliveryId: string | undefined;
let inFlightDeliveryId: string | undefined;
const submittedDeliveryIds = new Set<string>();

async function report(
  agentId: string,
  phase: string,
  error?: string,
): Promise<void> {
  let provider: string;
  let diagnostics: unknown;
  try {
    const adapter = adapterFor(location.href);
    provider = adapter.providerLabel;
    diagnostics = adapter.diagnostics();
  } catch {
    provider = 'unknown';
  }
  try {
    await bridgePost('/api/presence', {
      agentId,
      provider,
      phase,
      ...(error ? { error } : {}),
      ...(diagnostics !== undefined ? { diagnostics } : {}),
    });
  } catch {
    await chrome.runtime.sendMessage({
      type: 'adapter-error',
      message: error ?? phase,
    });
  }
}

async function processPending(binding: Binding): Promise<void> {
  if (inFlightDeliveryId !== undefined) {
    return;
  }
  const pending = await bridgeGet<{ job: PendingJob | null }>(
    `/api/deliveries/pending?agentId=${encodeURIComponent(binding.agentId)}`,
  );
  if (pending.job === null) {
    return;
  }
  const deliveryId = pending.job.deliveryId;
  if (pending.job.deliveryId === blockedDeliveryId) {
    return;
  }
  if (submittedDeliveryIds.has(deliveryId)) {
    try {
      await bridgePost(`/api/deliveries/${deliveryId}/ack`, {
        agentId: binding.agentId,
      });
    } catch {
      // Delivery may already be delivered.
    }
    return;
  }

  const adapter = adapterFor(location.href);
  inFlightDeliveryId = deliveryId;
  try {
    await report(binding.agentId, 'sending');
    await adapter.sendPrompt(pending.job.body);
    submittedDeliveryIds.add(deliveryId);
    await bridgePost(`/api/deliveries/${deliveryId}/ack`, {
      agentId: binding.agentId,
    });
    blockedDeliveryId = undefined;
    await report(binding.agentId, 'waiting');
    await chrome.runtime.sendMessage({ type: 'adapter-error', message: '' });
  } catch (error) {
    blockedDeliveryId = deliveryId;
    const message = error instanceof Error ? error.message : String(error);
    await report(binding.agentId, 'error', message);
    throw error;
  } finally {
    inFlightDeliveryId = undefined;
  }
}

async function poll(): Promise<void> {
  try {
    const binding = await bindingForThisTab();
    if (binding === undefined) {
      return;
    }
    await report(binding.agentId, inFlightDeliveryId ? 'sending' : 'waiting');
    await processPending(binding);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await chrome.runtime.sendMessage({ type: 'adapter-error', message });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'diagnostics') {
    return;
  }
  void (async () => {
    try {
      sendResponse({
        ok: true,
        diagnostics: adapterFor(location.href).diagnostics(),
      });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
  return true;
});

void poll();
setInterval(() => {
  void poll();
}, 1500);
