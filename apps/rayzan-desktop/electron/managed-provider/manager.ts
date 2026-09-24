import { randomUUID } from 'node:crypto';

import type { CaptureEvaluation } from '@rayzan/capture';

import { ConversationStore } from './conversation-store.js';
import { ProviderDebugTracker } from './debug-tracker.js';
import {
  fingerprintText,
  type ManagedCaptureDebug,
} from './managed-capture.js';
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
  readonly #debug = new ProviderDebugTracker();
  readonly #captureActive = new Set<ManagedProviderId>();
  readonly #lastTrackedIdentity = new Map<ManagedProviderId, string>();
  readonly #activeAgents = new Map<string, ManagedProviderId>();
  readonly #watchTimers = new Map<ManagedProviderId, NodeJS.Timeout>();
  readonly #captureFailures = new Map<string, number>();
  readonly #providerReady = new Map<
    ManagedProviderId,
    { readonly promise: Promise<void>; resolve: () => void }
  >();
  #loop: NodeJS.Timeout | undefined;
  #presenceLoop: NodeJS.Timeout | undefined;
  #debugPushLoop: NodeJS.Timeout | undefined;
  #busy = new Set<string>();
  #restoring = false;
  #restorePromise: Promise<void> | undefined;

  constructor(input: { readonly userDataPath: string; readonly appIcon?: string }) {
    this.#browser = new ProviderBrowserHost(input.appIcon, this.#debug);
    this.#store = new ConversationStore(input.userDataPath);
    for (const provider of MANAGED_PROVIDERS) {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      this.#providerReady.set(provider.id, { promise, resolve });
    }
    this.#ensurePresenceLoop();
    // The delivery loop must exist so #reconcilePendingManagedAgents can
    // activate providers with pending/awaiting work even when the debate was
    // started headlessly (no UI attach) — otherwise reconcile never runs.
    this.#ensureLoop();
    this.#ensureDebugPushLoop();
    this.#restorePromise = this.#bootstrapSessions();
  }

  /** True while any provider startup restore is still in progress. */
  isRestoring(): boolean {
    return this.#restoring;
  }

  /** Wait until all startup restores finish (safe to call repeatedly). */
  async whenRestored(): Promise<void> {
    await this.#restorePromise;
  }

  /** Wait until a specific provider's restore/navigation lock is released. */
  async whenProviderReady(providerId: ManagedProviderId): Promise<void> {
    const gate = this.#providerReady.get(providerId);
    if (gate) {
      await gate.promise;
    }
  }

  #releaseProviderReady(providerId: ManagedProviderId): void {
    const gate = this.#providerReady.get(providerId);
    gate?.resolve();
  }

  /** Stop delivery for a debate that was archived/ended by the Operator. */
  stopDebate(debateId: string): void {
    for (const row of this.#store.forDebate(debateId)) {
      this.#activeAgents.delete(row.agentId);
      if (row.status === 'active') {
        this.#store.markStatus(debateId, row.agentId, 'closed');
        this.#debug.setConversation(row.providerId, 'none');
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
        this.#debug.setConversation(
          row.providerId,
          'ready',
          row.conversation.id,
        );
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
        let created: { url: string };
        try {
          created = await this.#browser.createNewChat(providerId);
        } catch (error) {
          // Still register the agent so pending deliveries are processed; use
          // the current page URL instead of aborting attach.
          const message = error instanceof Error ? error.message : String(error);
          console.log(
            `[attach] ${providerId} createNewChat failed (${message}); using current URL`,
          );
          const win = await this.#browser.ensureWindow(providerId);
          created = {
            url:
              win.webContents.getURL() ||
              MANAGED_PROVIDERS.find((item) => item.id === providerId)?.homeUrl ||
              '',
          };
        }
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
        this.#debug.setConversation(providerId, 'ready', conversation.id);
        await this.#noteBinding(agent.agentId, providerId, true);
        attached.push({
          agentId: agent.agentId,
          providerId,
          conversationId: conversation.id,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`[attach] ${agent.agentId} skipped: ${message}`);
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
    if (this.#debugPushLoop) {
      clearInterval(this.#debugPushLoop);
      this.#debugPushLoop = undefined;
    }
    this.#browser.dispose();
  }

  async #bootstrapSessions(): Promise<void> {
    this.#restoring = true;
    const startedAt = Date.now();
    console.log(`[restore-trace] bootstrap start +0ms`);
    for (const provider of MANAGED_PROVIDERS) {
      this.#browser.setStatus(
        provider.id,
        'restoring',
        'Restoring saved session…',
      );
    }
    try {
      await Promise.allSettled(
        MANAGED_PROVIDERS.map((provider) =>
          this.#restoreProvider(provider.id, startedAt),
        ),
      );
    } finally {
      this.#restoring = false;
      console.log(
        `[restore-trace] bootstrap complete +${Date.now() - startedAt}ms`,
      );
    }
    if (process.env.RAYZAN_SEND_TRACE === '1') {
      setImmediate(() => {
        void this.runSendLatencyProbe();
      });
    }
  }

  async #restoreProvider(
    providerId: ManagedProviderId,
    startedAt: number,
  ): Promise<void> {
    const mark = (label: string) => {
      console.log(
        `[restore-trace] ${providerId} ${label} +${Date.now() - startedAt}ms`,
      );
    };
    mark('started');
    try {
      let restored = false;
      for (let attempt = 0; attempt < 4 && !restored; attempt += 1) {
        try {
          if (attempt > 0) {
            await delay(800 * attempt);
          }
          // Load partitioned session once — no redundant second home navigation.
          await this.#browser.ensureProviderHome(providerId);
          const probe = await this.#browser.refreshConnection(providerId);
          if (probe.loggedIn) {
            await this.#markConnected(providerId);
            restored = true;
            mark('connected');
          } else if (attempt === 3) {
            this.#browser.setStatus(providerId, 'not_connected');
            mark('not_connected');
            // Keep probing — SPA may hydrate after the restore budget.
            this.#startLoginWatch(providerId);
          } else {
            this.#browser.setStatus(
              providerId,
              'restoring',
              'Waiting for provider session…',
            );
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(
            `[restore-trace] ${providerId} attempt ${attempt} error: ${message}`,
          );
          if (attempt === 3) {
            this.#browser.setStatus(
              providerId,
              'not_connected',
              'Could not restore session — Connect to sign in',
            );
            mark('failed');
            this.#startLoginWatch(providerId);
          }
        }
      }
    } finally {
      this.#releaseProviderReady(providerId);
      mark('ready_gate_released');
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

  /** Push the ephemeral managed debug snapshot to the bridge (debug only). */
  #ensureDebugPushLoop(): void {
    if (this.#debugPushLoop) {
      return;
    }
    this.#debugPushLoop = setInterval(() => {
      void this.#pushDebugState();
    }, 2_000);
  }

  async #pushDebugState(): Promise<void> {
    this.#browser.reconcilePageStates();
    const payload = {
      pushedAt: Date.now(),
      restoring: this.#restoring,
      sendTraceEnabled: process.env.RAYZAN_SEND_TRACE === '1',
      providers: MANAGED_PROVIDERS.map((provider) =>
        this.#debug.snapshot(provider.id),
      ),
    };
    try {
      await bridgePost('/api/debug/managed-state', payload);
    } catch {
      // Debug-only best effort; bridge may be starting or unavailable.
    }
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

  /**
   * If the Coordinator dispatched to a managed agent that was never attached
   * (createNewChat failed / attach skipped), register it so pending work runs.
   */
  async #reconcilePendingManagedAgents(): Promise<void> {
    for (const provider of MANAGED_PROVIDERS) {
      const agentId = defaultAgentId(provider.id);
      if (this.#activeAgents.has(agentId)) {
        continue;
      }
      if (this.#browser.statusOf(provider.id) !== 'connected') {
        continue;
      }
      try {
        const pending = await bridgeGet<{ job: PendingJob | null }>(
          `/api/deliveries/pending?agentId=${encodeURIComponent(agentId)}`,
        );
        const awaiting = await bridgeGet<{ job: PendingJob | null }>(
          `/api/deliveries/awaiting?agentId=${encodeURIComponent(agentId)}`,
        );
        if (pending.job === null && awaiting.job === null) {
          continue;
        }
        console.log(
          `[reconcile] activating ${agentId} for pending/awaiting delivery`,
        );
        this.#activeAgents.set(agentId, provider.id);
        this.#ensureLoop();
      } catch {
        // Bridge may be briefly unavailable.
      }
    }
  }

  async #tick(): Promise<void> {
    await this.#reconcilePendingManagedAgents();
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
    const t0 = Date.now();
    const mark = (label: string) => {
      console.log(
        `[send-trace] deliver ${providerId} ${label} +${Date.now() - t0}ms restoring=${this.#restoring}`,
      );
    };
    mark('pendingSelected');
    this.#debug.transition(providerId, 'delivery-selected', job.deliveryId);
    // Per-provider restore lock — never wait for other providers.
    await this.whenProviderReady(providerId);
    mark('providerReady');
    await this.#notePresence(agentId, providerId, 'sending');
    mark('presenceSending');
    await this.#browser.wakeForWork(providerId);
    mark('wakeForWork');
    const expectJson = jobExpectsJsonDispatch(job.body);
    const body =
      expectJson && providerId === 'deepseek'
        ? `Do not use DeepThink / chain-of-thought. Reply with the JSON object only — no prose before or after.\n\n${job.body}`
        : job.body;
    const beforeSend = await this.#browser.conversationSnapshot(providerId);
    mark('conversationSnapshot');
    let generatingNoted = false;
    const noteGenerating = () => {
      if (generatingNoted) {
        return;
      }
      generatingNoted = true;
      mark('presenceGenerating');
      void this.#notePresence(agentId, providerId, 'generating').catch(
        () => undefined,
      );
    };
    try {
      await this.#browser.sendMessage(providerId, body, {
        onSubmissionAccepted: noteGenerating,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#debug.noteError(providerId, `send failed: ${message}`);
      throw error;
    }
    mark('sendMessageReturned');
    noteGenerating();
    await this.#ackDelivery(agentId, job.deliveryId);
    mark('ackDelivery');
    if (job.capture === false) {
      await this.#notePresence(agentId, providerId, 'waiting');
      return;
    }
    await this.#captureAndSubmit(agentId, providerId, job, beforeSend);
  }

  /** Temporary comparative send probe — only when RAYZAN_SEND_TRACE=1. */
  async runSendLatencyProbe(): Promise<void> {
    const mode = process.env.RAYZAN_SEND_TRACE;
    if (mode !== '1' && mode !== 'insert') {
      return;
    }

    if (mode === 'insert' || mode === '1') {
      const sizes: { readonly name: string; readonly text: string }[] = [
        { name: 'short_50', text: 'x'.repeat(50) },
        {
          name: 'medium_2kb',
          text: 'Evidence line.\n'.repeat(Math.ceil(2048 / 14)),
        },
        {
          name: 'large_10kb',
          text: 'Coordinator evidence packet line with Unicode Δ — 你好.\n'.repeat(
            Math.ceil(10_240 / 52),
          ),
        },
      ];
      for (const size of sizes) {
        if (this.#browser.statusOf('chatgpt') !== 'connected') {
          console.log(`[send-trace] skip insert bench: chatgpt not connected`);
          break;
        }
        try {
          const result = await this.#browser.traceFillLatency(
            'chatgpt',
            size.text,
          );
          console.log(
            `[send-trace] INSERT_BENCH ${size.name} chars=${size.text.length}`,
            JSON.stringify(result),
          );
        } catch (error) {
          console.log(
            `[send-trace] INSERT_BENCH_FAIL ${size.name}`,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    }

    if (mode !== '1') {
      return;
    }

    for (const id of ['chatgpt', 'deepseek'] as const) {
      if (this.#browser.statusOf(id) !== 'connected') {
        console.log(`[send-trace] skip ${id}: status=${this.#browser.statusOf(id)}`);
        continue;
      }
      try {
        const result = await this.#browser.traceSendLatency(
          id,
          'Rayzan send-latency probe. Reply with exactly one word: ok',
        );
        console.log(`[send-trace] RESULT ${id}`, JSON.stringify(result));
      } catch (error) {
        console.log(
          `[send-trace] FAIL ${id}`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  async #resumeCapture(
    agentId: string,
    providerId: ManagedProviderId,
    job: PendingJob,
  ): Promise<void> {
    await this.whenProviderReady(providerId);
    this.#debug.transition(
      providerId,
      'delivery-selected',
      `${job.deliveryId} (capture resumed)`,
    );
    await this.#notePresence(agentId, providerId, 'generating');
    await this.#browser.wakeForWork(providerId);
    // Resume: treat current turns minus the latest as the before-send snapshot
    // when a new turn may already exist; otherwise use live snapshot as baseline
    // and wait for a newer turn via the capture machine.
    const live = await this.#browser.conversationSnapshot(providerId);
    const beforeSend =
      live.assistantTurnCount > 0
        ? {
            identities: live.identities.slice(0, -1),
            assistantTurnCount: Math.max(0, live.assistantTurnCount - 1),
            lastAssistantText: live.identities.length > 1
              ? live.lastAssistantText
              : undefined,
            lastIncomplete: false,
          }
        : live;
    await this.#captureAndSubmit(agentId, providerId, job, beforeSend);
  }

  async #captureAndSubmit(
    agentId: string,
    providerId: ManagedProviderId,
    job: PendingJob,
    beforeSend: Awaited<
      ReturnType<ProviderBrowserHost['conversationSnapshot']>
    >,
  ): Promise<void> {
    const debugBox: { current?: ManagedCaptureDebug } = {};
    // Heartbeat keeps lastSeen fresh without claiming a false generation state.
    let lastPhase: string = 'generating';
    const heartbeat = setInterval(() => {
      void this.#notePresence(agentId, providerId, lastPhase).catch(
        () => undefined,
      );
    }, 3_000);
    this.#captureActive.add(providerId);
    this.#lastTrackedIdentity.delete(providerId);
    this.#debug.setCaptureActive(providerId, true);
    try {
      await this.#notePresence(agentId, providerId, 'generating');
      const text = await this.#browser.captureResponse(providerId, beforeSend, {
        deliveryId: job.deliveryId,
        lastDebug: debugBox,
        onPhase: (phase) => {
          lastPhase = phase;
          void this.#notePresence(agentId, providerId, phase).catch(
            () => undefined,
          );
        },
        onEvaluation: (evaluation) => {
          this.#observeCaptureEvaluation(providerId, evaluation);
        },
      });
      // Diagnostic A/B/C/D recording for the capture boundary (dev log only).
      const debug = debugBox.current;
      let finalDom:
        | {
            length: number;
            hash: string;
            tail: string;
            changedAfterCapture: boolean;
          }
        | undefined;
      try {
        const finalObs = await this.#browser.observe(providerId);
        const finalText = finalObs.turns.at(-1)?.finalText ?? '';
        finalDom = {
          ...fingerprintText(finalText),
          changedAfterCapture: finalText !== text,
        };
      } catch {
        // Diagnostic only.
      }
      console.log(
        '[capture-debug]',
        JSON.stringify({
          provider: providerId,
          deliveryId: job.deliveryId,
          textAtGenerationEnd: debug?.textAtGenerationEnd,
          captured: debug
            ? {
                length: debug.finalLength,
                tail: debug.capturedTextTail,
                hash: debug.capturedTextHash,
                capturedAt: debug.capturedAt,
                generationEndedAt: debug.generationEndedAt,
              }
            : undefined,
          settledRead: debug?.settledRead,
          finalDom,
          transitions: debug?.transitions,
        }),
      );
      await this.#submitResponse(agentId, job.deliveryId, text);
      await this.#notePresence(agentId, providerId, 'captured', undefined, {
        deliveryId: job.deliveryId,
        phase: 'captured',
        ...(debug
          ? {
              textLength: debug.finalLength,
              preSendTurnCount: debug.beforeSend.assistantTurnCount,
              trackedIdentity: debug.newTurnIdentity,
              generationEndedAt: debug.generationEndedAt,
              capturedAt: debug.capturedAt,
              ...(debug.settledRead
                ? {
                    domChangedAfterTerminal:
                      debug.settledRead.changedAfterTerminalRead,
                  }
                : {}),
            }
          : {}),
        ...(finalDom ? { domChangedAfterCapture: finalDom.changedAfterCapture } : {}),
      });
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
      this.#debug.noteError(
        providerId,
        `capture failed for ${job.deliveryId}: ${message}`,
      );
      await this.#notePresence(
        agentId,
        providerId,
        'attention',
        `${message} — capture failed (attempt ${failures}); Operator recovery required`,
        {
          deliveryId: job.deliveryId,
          phase: 'failed',
          reason: message,
          ...(debugBox.current
            ? {
                textLength: debugBox.current.finalLength,
                trackedIdentity: debugBox.current.newTurnIdentity,
              }
            : {}),
        },
      );
    } finally {
      clearInterval(heartbeat);
      this.#captureActive.delete(providerId);
      this.#debug.setCaptureActive(providerId, false);
    }
  }

  /**
   * Feed one capture-machine evaluation into the ephemeral debug tracker.
   * States come straight from the machine — never inferred from timers.
   */
  #observeCaptureEvaluation(
    providerId: ManagedProviderId,
    evaluation: CaptureEvaluation,
  ): void {
    const debug = this.#debug;
    const identity = evaluation.tracked?.identity;
    if (identity !== undefined) {
      const previous = this.#lastTrackedIdentity.get(providerId);
      if (previous !== identity) {
        this.#lastTrackedIdentity.set(providerId, identity);
        debug.transition(providerId, 'new-turn-detected', identity);
      }
    }
    if (evaluation.phase === 'captured') {
      debug.setGeneration(providerId, 'ended');
      debug.transition(
        providerId,
        'capture-captured',
        `${evaluation.text?.length ?? 0} chars`,
      );
      return;
    }
    if (evaluation.phase === 'failed') {
      if (evaluation.generationEndedAt !== undefined) {
        debug.setGeneration(providerId, 'ended');
      }
      debug.transition(
        providerId,
        'capture-failed',
        evaluation.failure ?? 'unknown',
      );
      return;
    }
    if (evaluation.sawGenerating && evaluation.generationEndedAt === undefined) {
      debug.setGeneration(providerId, 'active');
    }
    if (evaluation.generationEndedAt !== undefined) {
      debug.setGeneration(providerId, 'ended');
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

/**
 * True only when this job's *instructions* ask for a Coordinator JSON command
 * batch. Do not scan the evidence packet — prior Watcher/Coordinator text often
 * contains "json only" / `"commands"` and would force Markdown checkpoints into
 * an endless JSON wait (ChatGPT coordinator stuck on delivered).
 */
function jobExpectsJsonDispatch(body: string): boolean {
  const instruction = body.split(
    /Semantic evidence|Evidence packet|OPERATOR PROBLEM:|Original Operator problem|COMMON (?:ROUND 1 |DEBATE )?EVIDENCE/i,
  )[0] ?? body;
  if (/Do not (?:emit|write) JSON/i.test(instruction)) {
    return false;
  }
  return (
    /Reply with JSON only/i.test(instruction) &&
    /"commands"\s*:/.test(instruction)
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
