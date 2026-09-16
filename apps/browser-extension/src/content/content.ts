import { adapterFor } from '../adapters/index.js';
import { bridgeGet, bridgePost, type PendingJob } from '../bridge-client.js';
import {
  CaptureError,
  CaptureJobRegistry,
  runCapture,
  type CaptureEvaluation,
  type CapturePhase,
  type CaptureReport,
  type CaptureSnapshot,
} from '../capture/index.js';
import type { BrowserAdapter } from '../adapters/types.js';

interface Binding {
  agentId: string;
  role: string;
  name: string;
}

interface SerializableSnapshot {
  readonly identities: readonly string[];
  readonly assistantTurnCount: number;
  readonly lastAssistantText?: string;
  readonly lastIncomplete: boolean;
}

const jobs = new CaptureJobRegistry();
const submittedDeliveryIds = new Set<string>();
const capturedDeliveryIds = new Set<string>();
const snapshots = new Map<string, CaptureSnapshot>();
let blockedSendId: string | undefined;
let sendInFlight: string | undefined;

async function bindingForThisTab(): Promise<Binding | undefined> {
  return chrome.runtime.sendMessage({ type: 'get-binding' }) as Promise<
    Binding | undefined
  >;
}

function thisFrameHasComposer(): boolean {
  try {
    return adapterFor(location.href).diagnostics().inputFound;
  } catch {
    return false;
  }
}

function isCaptureFrame(): boolean {
  if (thisFrameHasComposer()) {
    return true;
  }
  try {
    return adapterFor(location.href).diagnostics().assistantTurns > 0;
  } catch {
    return false;
  }
}

function presencePhase(phase: CapturePhase | 'sending' | 'waiting'): string {
  if (phase === 'captured') {
    return 'captured';
  }
  if (phase === 'failed') {
    return 'error';
  }
  if (
    phase === 'sending' ||
    phase === 'snapshot' ||
    phase === 'prompt-submitted'
  ) {
    return 'sending';
  }
  if (
    phase === 'waiting-for-new-turn' ||
    phase === 'generating' ||
    phase === 'stabilizing'
  ) {
    return 'generating';
  }
  return 'waiting';
}

async function reportPresence(
  binding: Binding,
  input: {
    phase: CapturePhase | 'sending' | 'waiting';
    error?: string;
    capture?: CaptureReport;
  },
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
      agentId: binding.agentId,
      provider,
      phase: presencePhase(input.phase),
      ...(input.error ? { error: input.error } : {}),
      ...(diagnostics !== undefined ? { diagnostics } : {}),
      ...(input.capture ? { capture: input.capture } : {}),
    });
  } catch {
    await chrome.runtime.sendMessage({
      type: 'adapter-error',
      message: input.error ?? input.phase,
    });
  }
}

function serializeSnapshot(live: CaptureSnapshot): SerializableSnapshot {
  return {
    identities: [...live.identities],
    assistantTurnCount: live.assistantTurnCount,
    lastAssistantText: live.lastAssistantText,
    lastIncomplete: live.lastIncomplete,
  };
}

function rememberSnapshot(deliveryId: string, live: CaptureSnapshot): void {
  snapshots.set(deliveryId, live);
  void chrome.storage.local.set({
    [`rayzanSnapshot:${deliveryId}`]: serializeSnapshot(live),
  });
}

async function loadSnapshot(
  deliveryId: string,
): Promise<CaptureSnapshot | undefined> {
  const memory = snapshots.get(deliveryId);
  if (memory) {
    return memory;
  }
  const stored = await chrome.storage.local.get(`rayzanSnapshot:${deliveryId}`);
  const value = stored[`rayzanSnapshot:${deliveryId}`] as
    SerializableSnapshot | undefined;
  if (value === undefined) {
    return undefined;
  }
  return {
    identities: value.identities,
    assistantTurnCount: value.assistantTurnCount,
    lastAssistantText: value.lastAssistantText,
    lastIncomplete: value.lastIncomplete,
  };
}

function reportFromEvaluation(
  binding: Binding,
  deliveryId: string,
  provider: string,
  snapshot: CaptureSnapshot,
  evaluation: CaptureEvaluation,
  extras?: Partial<CaptureReport>,
): CaptureReport {
  return {
    deliveryId,
    agentId: binding.agentId,
    provider,
    phase: evaluation.phase,
    promptSubmitted: true,
    preSendTurnCount: snapshot.assistantTurnCount,
    currentTurnCount: adapterFor(location.href).listAssistantTurns().length,
    trackedIdentity: evaluation.tracked?.identity,
    trackedConnected: evaluation.trackedConnected,
    generating: evaluation.phase === 'generating',
    textLength: evaluation.text?.length ?? evaluation.lastText.length,
    posted: extras?.posted ?? false,
    reason: evaluation.failure,
    ...extras,
  };
}

async function startCaptureJob(
  binding: Binding,
  deliveryId: string,
  snapshot: CaptureSnapshot,
): Promise<void> {
  if (capturedDeliveryIds.has(deliveryId) || jobs.isActive(deliveryId)) {
    return;
  }
  const adapter = adapterFor(location.href);
  const started = jobs.begin({
    deliveryId,
    agentId: binding.agentId,
    provider: adapter.providerLabel,
    phase: 'waiting-for-new-turn',
    startedAt: Date.now(),
    report: {
      deliveryId,
      agentId: binding.agentId,
      provider: adapter.providerLabel,
      phase: 'waiting-for-new-turn',
      promptSubmitted: true,
      preSendTurnCount: snapshot.assistantTurnCount,
    },
  });
  if (!started) {
    return;
  }
  void runCaptureJob(binding, deliveryId, snapshot, adapter);
}

async function runCaptureJob(
  binding: Binding,
  deliveryId: string,
  snapshot: CaptureSnapshot,
  adapter: BrowserAdapter,
): Promise<void> {
  const provider = adapter.providerLabel;
  let lastPostedPhase: CapturePhase | undefined;
  let lastPostedAt = 0;
  try {
    const text = await runCapture({
      snapshot,
      observe: () => ({
        turns: adapter.listAssistantTurns(),
        generating: adapter.isGenerating(),
      }),
      onPhase: (evaluation) => {
        const report = reportFromEvaluation(
          binding,
          deliveryId,
          provider,
          snapshot,
          evaluation,
        );
        jobs.update(deliveryId, {
          phase: evaluation.phase,
          trackedIdentity: evaluation.tracked?.identity,
          report,
        });
        const changed = evaluation.phase !== lastPostedPhase;
        lastPostedPhase = evaluation.phase;
        if (changed || Date.now() - lastPostedAt > 750) {
          lastPostedAt = Date.now();
          void reportPresence(binding, {
            phase: evaluation.phase,
            error: evaluation.failure,
            capture: report,
          });
        }
      },
    });
    try {
      await bridgePost(`/api/deliveries/${deliveryId}/response`, {
        agentId: binding.agentId,
        body: text,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const report: CaptureReport = {
        deliveryId,
        agentId: binding.agentId,
        provider,
        phase: 'failed',
        promptSubmitted: true,
        preSendTurnCount: snapshot.assistantTurnCount,
        reason: 'bridge-submit-failed',
        textLength: text.length,
        posted: false,
      };
      jobs.finish(deliveryId, 'failed', report);
      await reportPresence(binding, {
        phase: 'failed',
        error: `bridge-submit-failed: ${message}`,
        capture: report,
      });
      return;
    }
    capturedDeliveryIds.add(deliveryId);
    const report: CaptureReport = {
      deliveryId,
      agentId: binding.agentId,
      provider,
      phase: 'captured',
      promptSubmitted: true,
      preSendTurnCount: snapshot.assistantTurnCount,
      currentTurnCount: adapter.listAssistantTurns().length,
      textLength: text.length,
      posted: true,
    };
    jobs.finish(deliveryId, 'captured', report);
    await reportPresence(binding, { phase: 'captured', capture: report });
    await chrome.runtime.sendMessage({ type: 'adapter-error', message: '' });
  } catch (error) {
    const reason = error instanceof CaptureError ? error.reason : String(error);
    const report: CaptureReport = {
      deliveryId,
      agentId: binding.agentId,
      provider,
      phase: 'failed',
      promptSubmitted: true,
      preSendTurnCount: snapshot.assistantTurnCount,
      reason,
      posted: false,
    };
    jobs.finish(deliveryId, 'failed', report);
    await reportPresence(binding, {
      phase: 'failed',
      error: String(reason),
      capture: report,
    });
    await chrome.runtime.sendMessage({
      type: 'adapter-error',
      message: String(reason),
    });
  }
}

async function acknowledge(agentId: string, deliveryId: string): Promise<void> {
  await bridgePost(`/api/deliveries/${deliveryId}/ack`, { agentId });
}

async function processPending(binding: Binding): Promise<void> {
  if (sendInFlight !== undefined || !thisFrameHasComposer()) {
    return;
  }
  const pending = await bridgeGet<{ job: PendingJob | null }>(
    `/api/deliveries/pending?agentId=${encodeURIComponent(binding.agentId)}`,
  );
  if (pending.job === null) {
    return;
  }
  const deliveryId = pending.job.deliveryId;
  if (deliveryId === blockedSendId) {
    return;
  }
  if (submittedDeliveryIds.has(deliveryId)) {
    try {
      await acknowledge(binding.agentId, deliveryId);
    } catch {
      // Already delivered.
    }
    if (pending.job.capture !== false) {
      const stored = await loadSnapshot(deliveryId);
      if (stored) {
        await startCaptureJob(binding, deliveryId, stored);
      }
    }
    return;
  }

  const adapter = adapterFor(location.href);
  sendInFlight = deliveryId;
  try {
    await reportPresence(binding, { phase: 'sending' });
    const live = adapter.snapshotLive();
    rememberSnapshot(deliveryId, live);
    await reportPresence(binding, {
      phase: 'snapshot',
      capture: {
        deliveryId,
        agentId: binding.agentId,
        provider: adapter.providerLabel,
        phase: 'snapshot',
        promptSubmitted: false,
        preSendTurnCount: live.assistantTurnCount,
        currentTurnCount: live.assistantTurnCount,
      },
    });
    await adapter.sendPrompt(pending.job.body);
    submittedDeliveryIds.add(deliveryId);
    await acknowledge(binding.agentId, deliveryId);
    blockedSendId = undefined;
    await reportPresence(binding, {
      phase: 'prompt-submitted',
      capture: {
        deliveryId,
        agentId: binding.agentId,
        provider: adapter.providerLabel,
        phase: 'prompt-submitted',
        promptSubmitted: true,
        preSendTurnCount: live.assistantTurnCount,
        currentTurnCount: adapter.listAssistantTurns().length,
      },
    });
    if (pending.job.capture !== false) {
      await startCaptureJob(binding, deliveryId, live);
    } else {
      await reportPresence(binding, { phase: 'waiting' });
    }
    await chrome.runtime.sendMessage({ type: 'adapter-error', message: '' });
  } catch (error) {
    blockedSendId = deliveryId;
    const message = error instanceof Error ? error.message : String(error);
    await reportPresence(binding, { phase: 'failed', error: message });
    throw error;
  } finally {
    sendInFlight = undefined;
  }
}

async function processAwaiting(binding: Binding): Promise<void> {
  if (sendInFlight !== undefined || !isCaptureFrame()) {
    return;
  }
  const awaiting = await bridgeGet<{ job: PendingJob | null }>(
    `/api/deliveries/awaiting?agentId=${encodeURIComponent(binding.agentId)}`,
  );
  if (awaiting.job === null || awaiting.job.capture === false) {
    return;
  }
  const deliveryId = awaiting.job.deliveryId;
  if (capturedDeliveryIds.has(deliveryId) || jobs.isActive(deliveryId)) {
    return;
  }
  const existing = jobs.get(deliveryId);
  if (existing?.phase === 'failed' || existing?.phase === 'captured') {
    return;
  }
  const stored = await loadSnapshot(deliveryId);
  if (stored === undefined) {
    const report: CaptureReport = {
      deliveryId,
      agentId: binding.agentId,
      provider: adapterFor(location.href).providerLabel,
      phase: 'failed',
      promptSubmitted: true,
      preSendTurnCount: 0,
      reason: 'snapshot-missing',
    };
    jobs.begin({
      deliveryId,
      agentId: binding.agentId,
      provider: report.provider,
      phase: 'failed',
      startedAt: Date.now(),
      report,
    });
    await reportPresence(binding, {
      phase: 'failed',
      error: 'snapshot-missing',
      capture: report,
    });
    return;
  }
  await startCaptureJob(binding, deliveryId, stored);
}

async function retryCapture(binding: Binding): Promise<void> {
  const awaiting = await bridgeGet<{ job: PendingJob | null }>(
    `/api/deliveries/awaiting?agentId=${encodeURIComponent(binding.agentId)}`,
  );
  if (awaiting.job === null) {
    throw new Error('no delivered message is waiting for capture');
  }
  const deliveryId = awaiting.job.deliveryId;
  const stored = await loadSnapshot(deliveryId);
  if (stored === undefined) {
    throw new Error(
      'snapshot-missing: cannot retry without the pre-send snapshot',
    );
  }
  const existing = jobs.get(deliveryId);
  if (existing && existing.phase === 'failed') {
    existing.phase = 'idle';
  }
  await startCaptureJob(binding, deliveryId, stored);
}

async function manualCapture(binding: Binding): Promise<void> {
  const awaiting = await bridgeGet<{ job: PendingJob | null }>(
    `/api/deliveries/awaiting?agentId=${encodeURIComponent(binding.agentId)}`,
  );
  if (awaiting.job === null) {
    throw new Error('no delivered message is waiting for capture');
  }
  const text = await adapterFor(location.href).captureLatestResponse();
  await bridgePost(`/api/deliveries/${awaiting.job.deliveryId}/response`, {
    agentId: binding.agentId,
    body: text,
  });
  capturedDeliveryIds.add(awaiting.job.deliveryId);
  await reportPresence(binding, {
    phase: 'captured',
    capture: {
      deliveryId: awaiting.job.deliveryId,
      agentId: binding.agentId,
      provider: adapterFor(location.href).providerLabel,
      phase: 'captured',
      promptSubmitted: true,
      preSendTurnCount: 0,
      textLength: text.length,
      posted: true,
    },
  });
}

async function poll(): Promise<void> {
  try {
    if (window !== window.top && !isCaptureFrame()) {
      return;
    }
    const binding = await bindingForThisTab();
    if (binding === undefined) {
      return;
    }
    if (sendInFlight !== undefined) {
      return;
    }
    await processPending(binding);
    await processAwaiting(binding);
    if (jobs.activeJobs().length > 0) {
      return;
    }
    if (blockedSendId !== undefined || jobs.hasTerminalFailure()) {
      return;
    }
    const awaiting = await bridgeGet<{ job: PendingJob | null }>(
      `/api/deliveries/awaiting?agentId=${encodeURIComponent(binding.agentId)}`,
    );
    if (
      awaiting.job !== null &&
      awaiting.job.capture !== false &&
      !capturedDeliveryIds.has(awaiting.job.deliveryId) &&
      jobs.get(awaiting.job.deliveryId)?.phase !== 'failed'
    ) {
      return;
    }
    await reportPresence(binding, { phase: 'waiting' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await chrome.runtime.sendMessage({ type: 'adapter-error', message });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'wake-poll') {
    void poll().finally(() => {
      try {
        sendResponse({ ok: true });
      } catch {
        // Channel may already be closed.
      }
    });
    return true;
  }

  if (message?.type === 'diagnostics') {
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
  }

  if (message?.type === 'retry-capture' || message?.type === 'manual-capture') {
    if (!isCaptureFrame()) {
      return undefined;
    }
    void (async () => {
      try {
        const binding = await bindingForThisTab();
        if (binding === undefined) {
          throw new Error('this tab is not bound');
        }
        if (message.type === 'retry-capture') {
          await retryCapture(binding);
        } else {
          await manualCapture(binding);
        }
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return true;
  }

  return undefined;
});

void poll();
setInterval(() => {
  void poll();
}, 1500);

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void poll();
    }
  });
}
