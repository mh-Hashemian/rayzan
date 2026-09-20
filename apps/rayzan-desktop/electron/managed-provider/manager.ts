import { randomUUID } from 'node:crypto';

import { ConversationStore } from './conversation-store.js';
import { ProviderBrowserHost } from './provider-browser.js';
import {
  MANAGED_PROVIDERS,
  providerIdFromAgent,
  type ManagedAttachAgent,
  type ManagedAttachResult,
  type ManagedProviderId,
  type ProviderConversationRef,
  type ProviderStatus,
} from './types.js';

const BRIDGE = 'http://127.0.0.1:8787';

interface PendingJob {
  readonly deliveryId: string;
  readonly body: string;
  readonly capture?: boolean;
}

export class ManagedProviderManager {
  readonly #browser: ProviderBrowserHost;
  readonly #store: ConversationStore;
  readonly #activeAgents = new Map<string, ManagedProviderId>();
  readonly #watchTimers = new Map<ManagedProviderId, NodeJS.Timeout>();
  readonly #captureFailures = new Map<string, number>();
  #loop: NodeJS.Timeout | undefined;
  #presenceLoop: NodeJS.Timeout | undefined;
  #busy = new Set<string>();
  #restoring = false;
  #restorePromise: Promise<void> | undefined;

  constructor(input: { readonly userDataPath: string; readonly appIcon?: string }) {
    this.#browser = new ProviderBrowserHost(input.appIcon);
    this.#store = new ConversationStore(input.userDataPath);
    this.#ensurePresenceLoop();
    this.#restorePromise = this.#bootstrapSessions();
  }

  /** True while startup session restore is in progress. */
  isRestoring(): boolean {
    return this.#restoring;
  }

  /** Wait until startup restore finishes (safe to call repeatedly). */
  async whenRestored(): Promise<void> {
    await this.#restorePromise;
  }

  /** Stop delivery for a debate that was archived/ended by the Operator. */
  stopDebate(debateId: string): void {
    for (const row of this.#store.forDebate(debateId)) {
      this.#activeAgents.delete(row.agentId);
      if (row.status === 'active') {
        this.#store.markStatus(debateId, row.agentId, 'closed');
      }
    }
    if (this.#activeAgents.size === 0 && this.#loop) {
      clearInterval(this.#loop);
      this.#loop = undefined;
    }
  }

  /** Resume delivery for ownerships belonging to the given active debate. */
  resumeDebate(debateId: string): void {
    for (const row of this.#store.forDebate(debateId)) {
      if (row.status === 'active') {
        this.#activeAgents.set(row.agentId, row.providerId);
      }
    }
    if (this.#activeAgents.size > 0) {
      this.#ensureLoop();
    }
  }

  listProviderStatuses(): readonly ProviderStatus[] {
    return MANAGED_PROVIDERS.map((provider) => ({
      id: provider.id,
      label: provider.label,
      status: this.#browser.statusOf(provider.id),
      ...(this.#browser.detailOf(provider.id)
        ? { detail: this.#browser.detailOf(provider.id) }
        : {}),
    }));
  }

  ownershipsForDebate(debateId: string) {
    return this.#store.forDebate(debateId);
  }

  async connect(providerId: ManagedProviderId): Promise<ProviderStatus> {
    this.#browser.setStatus(
      providerId,
      'connecting',
      'Sign in inside the provider window — status updates automatically',
    );
    await this.#browser.show(providerId);
    // Only hard-navigate when the window is blank/about:blank; do not interrupt
    // an in-progress login form.
    const win = await this.#browser.ensureWindow(providerId, { show: true });
    const url = win.webContents.getURL();
    if (!url || url === 'about:blank') {
      await this.#browser.navigateHome(providerId);
    }
    this.#startLoginWatch(providerId);
    try {
      const probe = await this.#browser.refreshConnection(providerId);
      if (probe.loggedIn) {
        await this.#markConnected(providerId);
      }
    } catch {
      // Operator may still be signing in; watch timer continues.
    }
    return this.#status(providerId);
  }

  async open(providerId: ManagedProviderId): Promise<void> {
    await this.#browser.show(providerId);
    this.#startLoginWatch(providerId);
    await this.#browser.refreshConnection(providerId).catch(() => undefined);
    if (this.#browser.statusOf(providerId) === 'connected') {
      await this.#markConnected(providerId);
    }
  }

  async reconnect(providerId: ManagedProviderId): Promise<ProviderStatus> {
    this.#browser.setStatus(
      providerId,
      'connecting',
      'Re-open provider and confirm sign-in',
    );
    await this.#browser.show(providerId);
    await this.#browser.navigateHome(providerId);
    this.#startLoginWatch(providerId);
    return this.#status(providerId);
  }

  async refreshAll(): Promise<readonly ProviderStatus[]> {
    if (this.#restoring) {
      return this.listProviderStatuses();
    }
    for (const provider of MANAGED_PROVIDERS) {
      const current = this.#browser.statusOf(provider.id);
      // Skip cold not_connected providers unless a login watch is active.
      if (
        current === 'not_connected' &&
        !this.#watchTimers.has(provider.id)
      ) {
        continue;
      }
      try {
        const probe = await this.#browser.refreshConnection(provider.id);
        if (probe.loggedIn) {
          await this.#markConnected(provider.id);
        }
      } catch {
        // Leave prior status.
      }
    }
    return this.listProviderStatuses();
  }

  async attachDebate(input: {
    readonly debateId: string;
    readonly agents: readonly ManagedAttachAgent[];
  }): Promise<ManagedAttachResult> {
    const attached: {
      agentId: string;
      providerId: ManagedProviderId;
      conversationId: string;
    }[] = [];
    const skipped: { agentId: string; reason: string }[] = [];

    for (const agent of input.agents) {
      const providerId = providerIdFromAgent(agent);
      if (providerId === undefined) {
        skipped.push({
          agentId: agent.agentId,
          reason: 'Provider is not managed in this checkpoint (extension fallback)',
        });
        continue;
      }
      try {
        const probe = await this.#browser.refreshConnection(providerId);
        if (!probe.loggedIn) {
          skipped.push({
            agentId: agent.agentId,
            reason: `${label(providerId)} is not connected`,
          });
          continue;
        }
        const created = await this.#browser.createNewChat(providerId);
        const conversation: ProviderConversationRef = {
          id: `conv-${randomUUID()}`,
          providerId,
          url: created.url,
          createdAt: new Date().toISOString(),
        };
        this.#store.upsert({
          debateId: input.debateId,
          agentId: agent.agentId,
          providerId,
          conversation,
        });
        this.#activeAgents.set(agent.agentId, providerId);
        await this.#noteBinding(agent.agentId, providerId, true);
        attached.push({
          agentId: agent.agentId,
          providerId,
          conversationId: conversation.id,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        skipped.push({ agentId: agent.agentId, reason: message });
      }
    }

    const managedIds = new Set(
      input.agents
        .map((agent) => providerIdFromAgent(agent))
        .filter((id): id is ManagedProviderId => id !== undefined),
    );
    const mode =
      attached.length === 0
        ? 'extension-fallback'
        : skipped.some((item) =>
            input.agents.some(
              (agent) =>
                agent.agentId === item.agentId &&
                providerIdFromAgent(agent) !== undefined,
            ),
          ) && attached.length < managedIds.size
          ? 'mixed'
          : attached.length > 0 &&
              attached.length ===
                input.agents.filter((a) => providerIdFromAgent(a)).length
            ? 'managed'
            : 'mixed';

    this.#ensureLoop();
    return {
      ok: attached.length > 0 || skipped.every((s) => /extension fallback/i.test(s.reason)),
      mode,
      attached,
      skipped,
      ...(attached.length === 0 &&
      input.agents.some((a) => providerIdFromAgent(a) !== undefined)
        ? {
            error:
              'Managed providers are not ready. Connect ChatGPT/DeepSeek in Settings, or use the extension fallback.',
          }
        : {}),
    };
  }

  dispose(): void {
    for (const timer of this.#watchTimers.values()) {
      clearInterval(timer);
    }
    this.#watchTimers.clear();
    if (this.#loop) {
      clearInterval(this.#loop);
      this.#loop = undefined;
    }
    if (this.#presenceLoop) {
      clearInterval(this.#presenceLoop);
      this.#presenceLoop = undefined;
    }
    this.#browser.dispose();
  }

  async #bootstrapSessions(): Promise<void> {
    this.#restoring = true;
    for (const provider of MANAGED_PROVIDERS) {
      this.#browser.setStatus(
        provider.id,
        'restoring',
        'Restoring saved session…',
      );
    }
    try {
      for (const provider of MANAGED_PROVIDERS) {
        let restored = false;
        for (let attempt = 0; attempt < 4 && !restored; attempt += 1) {
          try {
            if (attempt > 0) {
              await delay(800 * attempt);
            }
            // Load the partitioned session in the background (no focus steal).
            await this.#browser.ensureWindow(provider.id);
            await this.#browser.navigateHome(provider.id);
            const probe = await this.#browser.refreshConnection(provider.id);
            if (probe.loggedIn) {
              await this.#markConnected(provider.id);
              restored = true;
            } else if (attempt === 3) {
              this.#browser.setStatus(provider.id, 'not_connected');
            } else {
              this.#browser.setStatus(
                provider.id,
                'restoring',
                'Waiting for provider session…',
              );
            }
          } catch {
            if (attempt === 3) {
              this.#browser.setStatus(
                provider.id,
                'not_connected',
                'Could not restore session — Connect to sign in',
              );
            }
          }
        }
      }
    } finally {
      this.#restoring = false;
    }
  }

  #startLoginWatch(providerId: ManagedProviderId): void {
    if (this.#watchTimers.has(providerId)) {
      return;
    }
    const timer = setInterval(() => {
      void (async () => {
        try {
          const probe = await this.#browser.refreshConnection(providerId);
          if (probe.loggedIn) {
            await this.#markConnected(providerId);
            const existing = this.#watchTimers.get(providerId);
            if (existing) {
              clearInterval(existing);
              this.#watchTimers.delete(providerId);
            }
          }
        } catch {
          // Keep watching.
        }
      })();
    }, 1500);
    this.#watchTimers.set(providerId, timer);
  }

  async #markConnected(providerId: ManagedProviderId): Promise<void> {
    this.#browser.setStatus(providerId, 'connected');
    const agentId = defaultAgentId(providerId);
    await this.#noteBinding(agentId, providerId, true);
    await this.#notePresence(agentId, providerId, 'waiting');
  }

  #ensurePresenceLoop(): void {
    if (this.#presenceLoop) {
      return;
    }
    this.#presenceLoop = setInterval(() => {
      void (async () => {
        for (const provider of MANAGED_PROVIDERS) {
          if (this.#browser.statusOf(provider.id) !== 'connected') {
            continue;
          }
          const agentId = defaultAgentId(provider.id);
          await this.#noteBinding(agentId, provider.id, true).catch(() => undefined);
          // Heartbeat idle agents; never clobber an in-flight send/capture phase.
          if (!this.#busy.has(agentId) && !this.#activeAgents.has(agentId)) {
            await this.#notePresence(agentId, provider.id, 'waiting').catch(
              () => undefined,
            );
          }
        }
      })();
    }, 4000);
  }

  #status(id: ManagedProviderId): ProviderStatus {
    return {
      id,
      label: label(id),
      status: this.#browser.statusOf(id),
      ...(this.#browser.detailOf(id)
        ? { detail: this.#browser.detailOf(id) }
        : {}),
    };
  }

  #ensureLoop(): void {
    if (this.#loop) {
      return;
    }
    this.#loop = setInterval(() => {
      void this.#tick();
    }, 1500);
  }

  async #tick(): Promise<void> {
    const work = [...this.#activeAgents.entries()].map(
      async ([agentId, providerId]) => {
        if (this.#busy.has(agentId)) {
          return;
        }
        this.#busy.add(agentId);
        try {
          await this.#processAgent(agentId, providerId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (isIdempotentDeliveryError(message)) {
            await this.#notePresence(agentId, providerId, 'captured');
            return;
          }
          await this.#notePresence(agentId, providerId, 'error', message);
        } finally {
          this.#busy.delete(agentId);
        }
      },
    );
    await Promise.all(work);
  }

  async #processAgent(
    agentId: string,
    providerId: ManagedProviderId,
  ): Promise<void> {
    const pending = await bridgeGet<{ job: PendingJob | null }>(
      `/api/deliveries/pending?agentId=${encodeURIComponent(agentId)}`,
    );
    if (pending.job !== null) {
      await this.#deliverAndCapture(agentId, providerId, pending.job);
      return;
    }

    const awaiting = await bridgeGet<{ job: PendingJob | null }>(
      `/api/deliveries/awaiting?agentId=${encodeURIComponent(agentId)}`,
    );
    if (awaiting.job !== null && awaiting.job.capture !== false) {
      await this.#resumeCapture(agentId, providerId, awaiting.job);
      return;
    }

    await this.#notePresence(agentId, providerId, 'waiting');
  }

  async #deliverAndCapture(
    agentId: string,
    providerId: ManagedProviderId,
    job: PendingJob,
  ): Promise<void> {
    await this.#notePresence(agentId, providerId, 'sending');
    await this.#browser.wakeForWork(providerId);
    const expectJson =
      /reply with json only|json only|command batch/i.test(job.body) &&
      /"commands"\s*:/.test(job.body);
    const body =
      expectJson && providerId === 'deepseek'
        ? `Do not use DeepThink / chain-of-thought. Reply with the JSON object only — no prose before or after.\n\n${job.body}`
        : job.body;
    const before = await this.#browser.snapshot(providerId);
    await this.#browser.sendMessage(providerId, body);
    await this.#ackDelivery(agentId, job.deliveryId);
    await this.#notePresence(agentId, providerId, 'generating');
    if (job.capture === false) {
      await this.#notePresence(agentId, providerId, 'waiting');
      return;
    }
    await this.#captureAndSubmit(agentId, providerId, job, before.count, false);
  }

  async #resumeCapture(
    agentId: string,
    providerId: ManagedProviderId,
    job: PendingJob,
  ): Promise<void> {
    await this.#notePresence(agentId, providerId, 'generating');
    await this.#browser.wakeForWork(providerId);
    const expectJson =
      /reply with json only|json only|command batch/i.test(job.body) &&
      /"commands"\s*:/.test(job.body);
    const snap = await this.#browser.snapshot(providerId);
    const last = snap.last.trim();
    // If the new JSON reply is already on screen, allow it. Otherwise require a
    // new assistant turn so we do not re-parse the previous checkpoint prose.
    const alreadyJson =
      expectJson &&
      (/"commands"\s*:/.test(last) ||
        /"version"\s*:/.test(last) ||
        last.includes('```'));
    const preCount = alreadyJson
      ? Math.max(0, snap.count - 1)
      : snap.count;
    await this.#captureAndSubmit(
      agentId,
      providerId,
      job,
      preCount,
      alreadyJson,
    );
  }

  async #captureAndSubmit(
    agentId: string,
    providerId: ManagedProviderId,
    job: PendingJob,
    preCount: number,
    allowExisting: boolean,
  ): Promise<void> {
    const expectJson =
      /reply with json only|json only|command batch/i.test(job.body) &&
      /"commands"\s*:/.test(job.body);
    try {
      const text = await this.#browser.captureStableResponse(
        providerId,
        preCount,
        {
          expectJson,
          allowExisting,
          // Retries should still allow long DeepSeek thinking on JSON plans.
          timeoutMs: allowExisting
            ? expectJson
              ? 300_000
              : 90_000
            : expectJson
              ? 420_000
              : 180_000,
          // GLM streams while "thinking" UI is up — need a longer settle.
          stabilityMs: providerId === 'glm' ? 5_000 : expectJson ? 3_500 : 2_500,
        },
      );
      await this.#submitResponse(agentId, job.deliveryId, text);
      await this.#notePresence(agentId, providerId, 'captured');
      this.#captureFailures.delete(job.deliveryId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isIdempotentDeliveryError(message)) {
        await this.#notePresence(agentId, providerId, 'captured');
        this.#captureFailures.delete(job.deliveryId);
        return;
      }
      const failures = (this.#captureFailures.get(job.deliveryId) ?? 0) + 1;
      this.#captureFailures.set(job.deliveryId, failures);
      await this.#notePresence(
        agentId,
        providerId,
        'generating',
        `${message} — retrying capture (attempt ${failures})`,
      );
    }
  }

  async #ackDelivery(agentId: string, deliveryId: string): Promise<void> {
    try {
      await bridgePost(`/api/deliveries/${deliveryId}/ack`, { agentId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isIdempotentDeliveryError(message)) {
        throw error;
      }
    }
  }

  async #submitResponse(
    agentId: string,
    deliveryId: string,
    body: string,
  ): Promise<void> {
    try {
      await bridgePost(`/api/deliveries/${deliveryId}/response`, {
        agentId,
        body,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isIdempotentDeliveryError(message)) {
        throw error;
      }
    }
  }

  async #noteBinding(
    agentId: string,
    providerId: ManagedProviderId,
    available: boolean,
  ): Promise<void> {
    await bridgePost('/api/bindings', {
      agentId,
      provider: label(providerId),
      tabId: `managed:${providerId}`,
      available,
    });
  }

  async #notePresence(
    agentId: string,
    providerId: ManagedProviderId,
    phase: string,
    error?: string,
    capture?: Record<string, unknown>,
  ): Promise<void> {
    await bridgePost('/api/presence', {
      agentId,
      provider: label(providerId),
      phase,
      ...(error ? { error } : {}),
      ...(capture ? { capture } : {}),
      diagnostics: { transport: 'managed-browser', providerId },
    });
  }
}

function label(id: ManagedProviderId): string {
  return MANAGED_PROVIDERS.find((item) => item.id === id)?.label ?? id;
}

function defaultAgentId(providerId: ManagedProviderId): string {
  return providerId;
}

function isIdempotentDeliveryError(message: string): boolean {
  return /already confirmed|already submitted|round already completed|response already submitted|cannot mark a responded/i.test(
    message,
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function bridgeGet<T>(path: string): Promise<T> {
  const response = await fetch(`${BRIDGE}${path}`);
  if (!response.ok) {
    throw new Error(`bridge GET ${path} failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

async function bridgePost(path: string, body: unknown): Promise<void> {
  const response = await fetch(`${BRIDGE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(payload.error ?? `bridge POST ${path} failed`);
  }
}
