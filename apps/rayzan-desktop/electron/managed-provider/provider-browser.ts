import { BrowserWindow, session } from 'electron';

import {
  CaptureError,
  liveSnapshotFromTurns,
  type CaptureEvaluation,
  type CaptureObservation,
  type CaptureSnapshot,
  type CaptureTurn,
} from '@rayzan/capture';

import { ProviderDebugTracker } from './debug-tracker.js';
import {
  presenceFromCapturePhase,
  runManagedCapture,
  type ManagedCaptureDebug,
} from './managed-capture.js';
import {
  chatgptPageScript,
  deepseekPageScript,
  glmPageScript,
  qwenPageScript,
} from './page-scripts.js';
import { chatgptSendIifeSource } from './chatgpt-send-bundle.js';
import {
  MANAGED_PROVIDERS,
  type ManagedProviderId,
  type ProviderConnectionStatus,
} from './types.js';

export interface ProviderProbe {
  readonly loggedIn: boolean;
  readonly needsLogin: boolean;
  readonly hasComposer: boolean;
  readonly hasSend: boolean;
  readonly generating: boolean;
  readonly url: string;
  readonly title: string;
}

export interface ProviderSnapshot {
  readonly count: number;
  readonly last: string;
  readonly generating: boolean;
  readonly turns?: readonly CaptureTurn[];
}

function meta(id: ManagedProviderId) {
  const found = MANAGED_PROVIDERS.find((item) => item.id === id);
  if (!found) {
    throw new Error(`unknown managed provider: ${id}`);
  }
  return found;
}

function isAcceptableProviderUrl(id: ManagedProviderId, url: string): boolean {
  if (!url || url === 'about:blank') {
    return false;
  }
  try {
    const host = new URL(url).hostname;
    switch (id) {
      case 'chatgpt':
        return host === 'chatgpt.com' || host === 'chat.openai.com';
      case 'deepseek':
        return host === 'chat.deepseek.com' || host.endsWith('.deepseek.com');
      case 'qwen':
        return host === 'chat.qwen.ai' || host.endsWith('.qwen.ai');
      case 'glm':
        return host === 'chat.z.ai' || host.endsWith('.z.ai');
      default:
        return false;
    }
  } catch {
    return false;
  }
}

function pageScript(id: ManagedProviderId): string {
  switch (id) {
    case 'chatgpt':
      return chatgptPageScript;
    case 'deepseek':
      return deepseekPageScript;
    case 'qwen':
      return qwenPageScript;
    case 'glm':
      return glmPageScript;
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

export class ProviderBrowserHost {
  readonly #windows = new Map<ManagedProviderId, BrowserWindow>();
  readonly #status = new Map<ManagedProviderId, ProviderConnectionStatus>();
  readonly #detail = new Map<ManagedProviderId, string>();
  readonly #debug: ProviderDebugTracker | undefined;
  readonly #wiredWindows = new WeakSet<BrowserWindow>();

  constructor(private readonly appIcon?: string, debug?: ProviderDebugTracker) {
    this.#debug = debug;
    for (const provider of MANAGED_PROVIDERS) {
      this.#status.set(provider.id, 'not_connected');
    }
  }

  statusOf(id: ManagedProviderId): ProviderConnectionStatus {
    return this.#status.get(id) ?? 'not_connected';
  }

  detailOf(id: ManagedProviderId): string | undefined {
    return this.#detail.get(id);
  }

  setStatus(
    id: ManagedProviderId,
    status: ProviderConnectionStatus,
    detail?: string,
    probe?: { readonly loggedIn?: boolean; readonly needsLogin?: boolean },
  ): void {
    this.#status.set(id, status);
    if (detail !== undefined) {
      this.#detail.set(id, detail);
    } else {
      this.#detail.delete(id);
    }
    this.#debug?.observeSession(id, status, detail, probe);
  }

  #wireDebugListeners(id: ManagedProviderId, win: BrowserWindow): void {
    const debug = this.#debug;
    if (debug === undefined || this.#wiredWindows.has(win)) {
      return;
    }
    this.#wiredWindows.add(win);
    const contents = win.webContents;
    // Main-frame navigation signals only: 'did-start-loading'/'did-finish-load'
    // also fire for subframes (ChatGPT iframes) and made the debug page show
    // LOADING while the main document was idle.
    contents.on(
      'did-start-navigation',
      (...args: unknown[]) => {
        const url = typeof args[1] === 'string' ? args[1] : undefined;
        const isMainFrame = args[2] !== false;
        if (!isMainFrame) {
          return;
        }
        debug.observePage(id, { state: 'loading', ...(url ? { url } : {}) });
      },
    );
    contents.on('dom-ready', () => {
      debug.observePage(id, { state: 'ready', url: contents.getURL() });
    });
    contents.on('did-navigate', (_event, url: string) => {
      // Main-frame navigation committed — the document is materializing even
      // if dom-ready has not fired yet; loading is corrected below if idle.
      debug.observePage(id, { url });
    });
    contents.on('did-fail-load', (...args: unknown[]) => {
      const errorCode = Number(args[1]);
      const errorDescription = String(args[2] ?? '');
      const isMainFrame = args[4] !== false;
      if (!isMainFrame || errorCode === -3) {
        return;
      }
      debug.observePage(id, {
        state: 'error',
        detail: `main frame load failed (${errorCode}): ${errorDescription}`,
      });
    });
    win.on('show', () => {
      debug.observePage(id, { visible: true });
    });
    win.on('hide', () => {
      debug.observePage(id, { visible: false });
    });
    debug.observePage(id, { visible: win.isVisible() });
  }

  async ensureWindow(
    id: ManagedProviderId,
    options?: { readonly show?: boolean },
  ): Promise<BrowserWindow> {
    const existing = this.#windows.get(id);
    if (existing && !existing.isDestroyed()) {
      if (options?.show) {
        existing.show();
        existing.focus();
      }
      return existing;
    }
    const provider = meta(id);
    const ses = session.fromPartition(provider.partition);
    const win = new BrowserWindow({
      width: 1100,
      height: 800,
      title: `${provider.label} — Rayzan`,
      show: options?.show === true,
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      ...(this.appIcon ? { icon: this.appIcon } : {}),
      webPreferences: {
        session: ses,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: provider.partition,
        // Hidden provider windows must keep streaming/timers alive or auto-capture
        // stalls until the Operator opens the window from Settings.
        backgroundThrottling: false,
      },
    });
    win.setMenuBarVisibility(false);
    try {
      win.webContents.setBackgroundThrottling(false);
    } catch {
      // Older Electron builds may not expose the method.
    }
    win.on('close', (event) => {
      // Hide instead of destroy so the session/page keep running for debates.
      if (!win.isDestroyed()) {
        event.preventDefault();
        win.hide();
      }
    });
    this.#wireDebugListeners(id, win);
    win.webContents.on('did-finish-load', () => {
      // Force page-script reinstall after navigation.
      void win.webContents
        .executeJavaScript(`window.__rayzanProviderApi = undefined; true`, true)
        .catch(() => undefined);
    });
    this.#windows.set(id, win);
    const url = win.webContents.getURL();
    if (!url || url === 'about:blank') {
      await win.loadURL(provider.homeUrl);
    }
    return win;
  }

  /**
   * Ensure the provider window is on an acceptable origin without redundant
   * reload when already on the provider site (e.g. after ensureWindow loaded home).
   */
  async ensureProviderHome(id: ManagedProviderId): Promise<BrowserWindow> {
    const win = await this.ensureWindow(id);
    const url = win.webContents.getURL();
    if (!isAcceptableProviderUrl(id, url)) {
      await win.loadURL(meta(id).homeUrl);
      await this.#waitReady(win);
    }
    return win;
  }

  async show(id: ManagedProviderId): Promise<void> {
    const win = await this.ensureWindow(id, { show: true });
    win.show();
    win.focus();
  }

  async hide(id: ManagedProviderId): Promise<void> {
    const win = this.#windows.get(id);
    if (win && !win.isDestroyed()) {
      win.hide();
    }
  }

  /**
   * Provider SPAs often pause generation while `document.hidden`. Show the
   * window without stealing focus so send/capture can complete.
   */
  async wakeForWork(id: ManagedProviderId): Promise<void> {
    const win = await this.ensureWindow(id);
    try {
      win.webContents.setBackgroundThrottling(false);
    } catch {
      // ignore
    }
    if (!win.isVisible()) {
      // showInactive keeps Rayzan focused while un-hiding the provider page.
      if (typeof win.showInactive === 'function') {
        win.showInactive();
      } else {
        win.show();
      }
    }
  }

  async navigateHome(id: ManagedProviderId): Promise<void> {
    await this.ensureProviderHome(id);
  }

  async #installPageApi(
    id: ManagedProviderId,
    win: BrowserWindow,
  ): Promise<void> {
    // Probe/snapshot must not depend on the ChatGPT send bundle. Injecting that
    // IIFE during restore previously threw and left ChatGPT stuck on sign-in.
    await win.webContents.executeJavaScript(
      `window.__rayzanProviderApi = (${pageScript(id)}); true`,
      true,
    );
  }

  async #ensureChatGptSendHelpers(win: BrowserWindow): Promise<void> {
    // Concatenate (do not use a host template literal) so `${` inside the
    // esbuild IIFE cannot be interpolated by the Electron main process.
    const source =
      'if (!globalThis.__rayzanChatGptSend) {\n' +
      chatgptSendIifeSource() +
      '\n} true';
    await win.webContents.executeJavaScript(source, true);
  }

  async probe(id: ManagedProviderId): Promise<ProviderProbe> {
    const win = await this.ensureWindow(id);
    await this.#waitReady(win);
    await this.#installPageApi(id, win);
    return (await win.webContents.executeJavaScript(
      `window.__rayzanProviderApi.probe()`,
      true,
    )) as ProviderProbe;
  }

  async refreshConnection(id: ManagedProviderId): Promise<ProviderProbe> {
    try {
      const win = await this.ensureWindow(id);
      await this.#waitReady(win);
      await this.#installPageApi(id, win);
      let probe = (await win.webContents.executeJavaScript(
        `window.__rayzanProviderApi.probe()`,
        true,
      )) as ProviderProbe;

      // ChatGPT SPA often paints before composer/shell hydrate. Poll briefly
      // when we are on the product origin but not yet seeing logged-in chrome.
      if (
        id === 'chatgpt' &&
        !probe.loggedIn &&
        !/\/(auth|login|signin)/i.test(probe.url)
      ) {
        for (let i = 0; i < 12 && !probe.loggedIn; i += 1) {
          await delay(400);
          await this.#installPageApi(id, win);
          probe = (await win.webContents.executeJavaScript(
            `window.__rayzanProviderApi.probe()`,
            true,
          )) as ProviderProbe;
        }
      }

      const prior = this.#status.get(id);
      if (probe.loggedIn) {
        this.setStatus(id, 'connected');
      } else if (prior === 'connecting' || prior === 'restoring') {        // Keep Connecting/Restoring through OAuth / interstitial pages so the
        // Operator does not have to click Connect again after finishing sign-in.
        this.setStatus(
          id,
          prior,
          probe.needsLogin
            ? prior === 'restoring'
              ? 'Restoring saved session…'
              : 'Sign in inside the provider window — status updates automatically'
            : prior === 'restoring'
              ? 'Waiting for provider session…'
              : 'Finishing sign-in…',
        );
      } else if (probe.needsLogin) {
        this.setStatus(
          id,
          'needs_attention',
          `${meta(id).label} needs sign-in`,
          { loggedIn: probe.loggedIn, needsLogin: probe.needsLogin },
        );
      } else {
        this.setStatus(id, 'not_connected');
      }
      this.#debug?.observeProbe(id, probe);
      return probe;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[provider-probe] ${id} refresh failed: ${message}`);
      // Do not demote an in-progress Connect/restore attempt on transient load errors.
      const prior = this.#status.get(id);
      if (prior !== 'connecting' && prior !== 'restoring') {
        this.setStatus(id, 'needs_attention', message);
      }
      throw error;
    }
  }

  async createNewChat(id: ManagedProviderId): Promise<{ url: string }> {
    await this.wakeForWork(id);
    const win = await this.ensureWindow(id);
    await this.#waitReady(win);
    if (id === 'chatgpt') {
      await this.#ensureChatGptSendHelpers(win);
    }
    await this.#installPageApi(id, win);
    await win.webContents.executeJavaScript(
      `window.__rayzanProviderApi.createNewChat()`,
      true,
    );
    await this.#waitReady(win);
    await delay(1200);
    return { url: win.webContents.getURL() };
  }

  async sendMessage(
    id: ManagedProviderId,
    text: string,
    options?: { readonly onSubmissionAccepted?: () => void },
  ): Promise<unknown> {
    const t0 = Date.now();
    const mark = (label: string) => {
      if (process.env.RAYZAN_SEND_TRACE === '1') {
        console.log(
          `[send-trace] ${id} host:${label} +${Date.now() - t0}ms`,
        );
      }
    };
    await this.wakeForWork(id);
    mark('wakeForWork');
    this.#debug?.setSend(id, 'preparing');
    const win = await this.ensureWindow(id);
    mark('ensureWindow');
    const wasLoading = win.webContents.isLoadingMainFrame();
    await this.#waitReady(win);
    mark(`waitReady(wasLoading=${wasLoading})`);
    if (id === 'chatgpt') {
      await this.#ensureChatGptSendHelpers(win);
    }
    await this.#installPageApi(id, win);
    this.#debug?.setSend(id, 'composer_ready');
    mark('pageScriptReady');

    let acceptedNotified = false;
    const notifyAccepted = () => {
      if (acceptedNotified) {
        return;
      }
      acceptedNotified = true;
      this.#debug?.setSend(id, 'accepted');
      options?.onSubmissionAccepted?.();
    };

    const onConsole = (...args: unknown[]) => {
      let textMsg = '';
      const first = args[0];
      if (
        first &&
        typeof first === 'object' &&
        'message' in (first as object)
      ) {
        textMsg = String((first as { message: unknown }).message);
      } else if (typeof args[2] === 'string') {
        textMsg = args[2];
      } else if (typeof args[1] === 'string') {
        textMsg = args[1];
      }
      if (!textMsg.startsWith('[rayzan-send]')) {
        return;
      }
      try {
        const payload = JSON.parse(textMsg.slice('[rayzan-send]'.length)) as {
          phase?: string;
        };
        if (payload.phase === 'submit_triggered') {
          this.#debug?.setSend(id, 'submitting');
        }
        if (payload.phase === 'submission_accepted') {
          notifyAccepted();
        }
      } catch {
        // ignore malformed progress
      }
    };
    win.webContents.on('console-message', onConsole as (...a: unknown[]) => void);

    try {
      this.#debug?.setSend(id, 'submitting');
      const sendResult = await win.webContents.executeJavaScript(
        `window.__rayzanProviderApi.sendPrompt(${JSON.stringify(text)})`,
        true,
      );
      notifyAccepted();
      if (
        process.env.RAYZAN_SEND_TRACE === '1' &&
        sendResult &&
        typeof sendResult === 'object'
      ) {
        console.log(
          `[send-trace] ${id} sendPromptStages`,
          JSON.stringify(
            (sendResult as { stages?: unknown }).stages ?? sendResult,
          ),
        );
      }
      mark('sendPromptReturned');
      return sendResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#debug?.setSend(id, 'failed', message);
      throw error;
    } finally {
      win.webContents.removeListener(
        'console-message',
        onConsole as (...a: unknown[]) => void,
      );
    }
  }

  /**
   * Temporary latency probe (RAYZAN_SEND_TRACE). Does not change production
   * send semantics beyond logging and a short post-send DOM poll.
   */
  async traceSendLatency(
    id: ManagedProviderId,
    text: string,
  ): Promise<Record<string, number | string | boolean>> {
    const t0 = Date.now();
    const out: Record<string, number | string | boolean> = {
      provider: id,
      t0: 0,
    };
    const mark = (label: string, extra?: string) => {
      const ms = Date.now() - t0;
      out[label] = ms;
      console.log(
        `[send-trace] ${id} ${label} +${ms}ms${extra ? ` ${extra}` : ''}`,
      );
    };

    await this.wakeForWork(id);
    mark('wakeForWork');
    const win = await this.ensureWindow(id);
    mark('windowReady', `url=${win.webContents.getURL().slice(0, 80)}`);
    const wasLoading = win.webContents.isLoadingMainFrame();
    out.waitReadyWasLoading = wasLoading;
    await this.#waitReady(win);
    mark('waitReadyDone');

    if (id === 'chatgpt') {
      await this.#ensureChatGptSendHelpers(win);
    }
    await this.#installPageApi(id, win);
    mark('pageScriptInjected');

    const snapStart = Date.now();
    await this.conversationSnapshot(id);
    out.conversationSnapshotMs = Date.now() - snapStart;
    mark('conversationSnapshot', `${out.conversationSnapshotMs}ms`);

    const pageStages = (await win.webContents.executeJavaScript(
      `(async () => {
        const t0 = performance.now();
        const outer = {};
        const mark = (n) => { outer[n] = Math.round(performance.now() - t0); };
        const api = window.__rayzanProviderApi;
        mark('apiPresent');
        const probe = api.probe();
        mark('probeDone');
        outer.hasComposer = probe.hasComposer;
        outer.hasSend = probe.hasSend;
        outer.generatingBefore = probe.generating;
        outer.url = location.href;
        const result = await api.sendPrompt(${JSON.stringify(text)});
        mark('sendPromptReturned');
        outer.resultOk = result && result.ok === true;
        if (result && result.stages) {
          for (const [k, v] of Object.entries(result.stages)) {
            outer['send.' + k] = v;
          }
        }
        for (let i = 0; i < 60; i++) {
          const p = api.probe();
          if (p.generating) {
            mark('generationActive');
            break;
          }
          await new Promise((r) => setTimeout(r, 50));
        }
        if (outer.generationActive === undefined) mark('generationPollTimeout');
        return outer;
      })()`,
      true,
    )) as Record<string, number | string | boolean>;

    for (const [key, value] of Object.entries(pageStages)) {
      out[`page:${key}`] = value;
    }
    mark('complete');
    return out;
  }

  /** Fill-only insert timing (no submit) for composer scaling analysis. */
  async traceFillLatency(
    id: ManagedProviderId,
    text: string,
  ): Promise<Record<string, number | string | boolean>> {
    const t0 = Date.now();
    const out: Record<string, number | string | boolean> = {
      provider: id,
      chars: text.length,
    };
    const win = await this.ensureWindow(id);
    await this.#waitReady(win);
    if (id !== 'chatgpt') {
      throw new Error('traceFillLatency is ChatGPT-only');
    }
    await this.#ensureChatGptSendHelpers(win);
    await this.#installPageApi(id, win);
    const page = (await win.webContents.executeJavaScript(
      `(async () => {
        const send = globalThis.__rayzanChatGptSend;
        const field = send.chatgptComposer();
        if (!field) throw new Error('composer missing');
        const t0 = performance.now();
        send.setRichComposerValue(field, ${JSON.stringify(text)});
        const fillMs = Math.round(performance.now() - t0);
        const got = send.richComposerText(field);
        return {
          fillMs,
          matched: got === ${JSON.stringify(text)}.trim(),
          gotLen: got.length,
        };
      })()`,
      true,
    )) as { fillMs: number; matched: boolean; gotLen: number };
    out.fillMs = page.fillMs;
    out.matched = page.matched;
    out.gotLen = page.gotLen;
    out.hostMs = Date.now() - t0;
    return out;
  }

  async snapshot(id: ManagedProviderId): Promise<ProviderSnapshot> {
    const win = await this.ensureWindow(id);
    await this.#waitReady(win);
    await this.#installPageApi(id, win);
    return (await win.webContents.executeJavaScript(
      `window.__rayzanProviderApi.snapshot()`,
      true,
    )) as ProviderSnapshot;
  }

  async conversationSnapshot(id: ManagedProviderId): Promise<CaptureSnapshot> {
    const snap = await this.snapshot(id);
    const turns = snap.turns ?? [];
    if (turns.length > 0) {
      return liveSnapshotFromTurns(turns);
    }
    return {
      identities: Array.from({ length: snap.count }, (_, i) => `idx:${i}`),
      assistantTurnCount: snap.count,
      lastAssistantText: snap.last || undefined,
      lastIncomplete: snap.generating,
    };
  }

  async observe(id: ManagedProviderId): Promise<CaptureObservation> {
    const snap = await this.snapshot(id);
    const turns =
      snap.turns ??
      (snap.last
        ? [
            {
              identity: `idx:${Math.max(0, snap.count - 1)}`,
              thinkingOnly: false,
              hasFinalAnswer: snap.last.length > 0,
              finalText: snap.last,
            },
          ]
        : []);
    return { turns, generating: snap.generating };
  }

  /**
   * Settled observation at the capture terminal boundary: page-side
   * requestAnimationFrame flush + mutation-quiet check, then read the final
   * assistant turn. Falls back to a plain observe when the provider page does
   * not implement readSettledTurn.
   */
  async settledObservation(id: ManagedProviderId): Promise<CaptureObservation> {
    const win = await this.ensureWindow(id);
    await this.#waitReady(win);
    await this.#installPageApi(id, win);
    const hasSettle = await win.webContents.executeJavaScript(
      `typeof window.__rayzanProviderApi?.readSettledTurn === 'function'`,
      true,
    );
    if (!hasSettle) {
      return this.observe(id);
    }
    const snap = (await win.webContents.executeJavaScript(
      `window.__rayzanProviderApi.readSettledTurn()`,
      true,
    )) as {
      count: number;
      last: string;
      generating: boolean;
      turns?: readonly {
        identity: string;
        thinkingOnly: boolean;
        hasFinalAnswer: boolean;
        finalText: string;
      }[];
    };
    const turns = snap.turns ?? [];
    if (turns.length > 0) {
      return { turns, generating: snap.generating };
    }
    return this.observe(id);
  }

  /**
   * RAYZAN_CAPTURE_TRACE=1 — page-side mutation ordering recorder for the
   * premature-capture diagnosis. Diagnostic only; never installed otherwise.
   */
  static captureTraceScript(): string {
    return `
(() => {
  window.__rayzanCaptureTrace = [];
  const trace = window.__rayzanCaptureTrace;
  const push = (kind, detail) => {
    if (trace.length > 500) return;
    const stop = Boolean(document.querySelector('button[data-testid="stop-button"], #composer-submit-button[data-testid="stop-button"], button[aria-label="Stop streaming"], button[aria-label="Stop generating"], button[aria-label="Stop"]'));
    const turns = document.querySelectorAll('[data-turn="assistant"], [data-message-author-role="assistant"]');
    const last = turns[turns.length - 1];
    const len = last ? (last.innerText || '').length : 0;
    trace.push({ at: Date.now(), perf: Math.round(performance.now()), kind, gen: stop, len, ...(detail ? { detail } : {}) });
  };
  let pending = null;
  const mo = new MutationObserver((mutations) => {
    let assistant = false;
    let control = false;
    for (const m of mutations) {
      const target = m.target instanceof Element ? m.target : m.target.parentElement;
      if (!target) continue;
      if (target.closest('[data-turn="assistant"], [data-message-author-role="assistant"]')) assistant = true;
      if (target.closest('#composer-submit-button, [data-testid="stop-button"], [data-testid="send-button"]') || (m.attributeName === 'aria-label' || m.attributeName === 'data-testid')) control = true;
    }
    const kind = assistant && control ? 'assistant+control' : assistant ? 'assistant' : control ? 'control' : 'other';
    if (pending && pending.kind === kind) { pending.n = (pending.n || 1) + 1; return; }
    if (pending) push(pending.kind, pending.n > 1 ? 'x' + pending.n : undefined);
    pending = { kind, n: 1 };
  });
  mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true });
  setInterval(() => { if (pending) { push(pending.kind, pending.n > 1 ? 'x' + pending.n : undefined); pending = null; } }, 120);
  push('trace-start');
})()`;
  }

  /**
   * Correct phantom LOADING page state against the real webContents loading
   * signal. did-start-navigation fires for prerender/speculative main-frame
   * loads that never commit (ChatGPT does this constantly), leaving the
   * tracker stuck on loading with no dom-ready to clear it. Runs on the debug
   * push cadence; display-only — never part of capture semantics.
   */
  reconcilePageStates(): void {
    const debug = this.#debug;
    if (debug === undefined) {
      return;
    }
    for (const [id, win] of this.#windows) {
      if (win.isDestroyed()) {
        continue;
      }
      try {
        if (!win.webContents.isLoading()) {
          debug.reconcilePageNotLoading(id, win.webContents.getURL());
        }
      } catch {
        // Window may be gone; ignore.
      }
    }
  }

  async readCaptureTrace(id: ManagedProviderId): Promise<void> {
    if (process.env.RAYZAN_CAPTURE_TRACE !== '1' || id !== 'chatgpt') {
      return;
    }
    try {
      const win = await this.ensureWindow(id);
      const raw = await win.webContents.executeJavaScript(
        `JSON.stringify(window.__rayzanCaptureTrace || [])`,
        true,
      );
      const entries = JSON.parse(String(raw)) as {
        at: number;
        perf: number;
        kind: string;
        gen: boolean;
        len: number;
        detail?: string;
      }[];
      console.log(
        `[capture-trace] ${id} ${entries.length} entries (gen=stopVisible, len=lastAssistantInnerText)`,
      );
      for (const entry of entries.slice(-80)) {
        console.log(
          `[capture-trace] ${entry.at} perf=${entry.perf} ${entry.kind}${entry.detail ? ` ${entry.detail}` : ''} gen=${entry.gen} len=${entry.len}`,
        );
      }
    } catch (error) {
      console.log(
        `[capture-trace] read failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async waitForDomChange(id: ManagedProviderId, timeoutMs = 250): Promise<void> {
    const win = await this.ensureWindow(id);
    await this.#waitReady(win);
    await this.#installPageApi(id, win);
    const hasWait = await win.webContents.executeJavaScript(
      `typeof window.__rayzanProviderApi.waitForDomChange === 'function'`,
      true,
    );
    if (hasWait) {
      await win.webContents.executeJavaScript(
        `window.__rayzanProviderApi.waitForDomChange(${timeoutMs})`,
        true,
      );
      return;
    }
    await delay(timeoutMs);
  }

  /**
   * Extension-semantics capture: new turn + generation ended → capture now.
   * Timers are watchdogs only.
   */
  async captureResponse(
    id: ManagedProviderId,
    beforeSend: CaptureSnapshot,
    options?: {
      readonly deliveryId?: string;
      readonly onPhase?: (phase: string) => void;
      readonly onEvaluation?: (evaluation: CaptureEvaluation) => void;
      readonly lastDebug?: { current?: ManagedCaptureDebug };
    },
  ): Promise<string> {
    await this.wakeForWork(id);
    const traceEnabled =
      process.env.RAYZAN_CAPTURE_TRACE === '1' && id === 'chatgpt';
    if (traceEnabled) {
      try {
        const win = await this.ensureWindow(id);
        await win.webContents.executeJavaScript(
          ProviderBrowserHost.captureTraceScript(),
          true,
        );
      } catch {
        // Trace is diagnostic only.
      }
    }
    try {
      const result = await runManagedCapture({
        providerId: id,
        ...(options?.deliveryId ? { deliveryId: options.deliveryId } : {}),
        beforeSend,
        observe: () => this.observe(id),
        waitForDomChange: (ms) => this.waitForDomChange(id, ms),
        settleObserve: () => this.settledObservation(id),
        onPhase: (phase, evaluation) => {
          options?.onEvaluation?.(evaluation);
          options?.onPhase?.(presenceFromCapturePhase(phase));
        },
      });
      if (traceEnabled) {
        await this.readCaptureTrace(id);
      }
      if (options?.lastDebug) {
        options.lastDebug.current = result.debug;
      }
      return result.text;
    } catch (error) {
      if (traceEnabled) {
        await this.readCaptureTrace(id);
      }
      if (
        error instanceof CaptureError &&
        options?.lastDebug &&
        'debug' in error
      ) {
        options.lastDebug.current = (
          error as CaptureError & { debug?: ManagedCaptureDebug }
        ).debug;
      }
      throw error;
    }
  }

  /** @deprecated Prefer captureResponse. Kept for resume paths that only know preCount. */
  async captureStableResponse(
    id: ManagedProviderId,
    preCount: number,
    options?: {
      readonly onObservation?: (state: {
        readonly generating: boolean;
        readonly stabilizing: boolean;
        readonly textLength: number;
      }) => void;
      readonly deliveryId?: string;
    },
  ): Promise<string> {
    const before = await this.conversationSnapshot(id);
    const snapshot: CaptureSnapshot =
      before.assistantTurnCount === preCount
        ? before
        : {
            identities: Array.from({ length: preCount }, (_, i) => `idx:${i}`),
            assistantTurnCount: preCount,
            lastIncomplete: false,
          };
    return this.captureResponse(id, snapshot, {
      ...(options?.deliveryId ? { deliveryId: options.deliveryId } : {}),
      onPhase: (phase) => {
        options?.onObservation?.({
          generating: phase === 'generating',
          stabilizing: phase === 'capturing',
          textLength: 0,
        });
      },
    });
  }

  dispose(): void {
    for (const win of this.#windows.values()) {
      if (!win.isDestroyed()) {
        win.removeAllListeners('close');
        win.destroy();
      }
    }
    this.#windows.clear();
  }

  async #waitReady(win: BrowserWindow): Promise<void> {
    if (win.webContents.isLoadingMainFrame()) {
      await new Promise<void>((resolve) => {
        win.webContents.once('did-finish-load', () => resolve());
        setTimeout(() => resolve(), 8000);
      });
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
