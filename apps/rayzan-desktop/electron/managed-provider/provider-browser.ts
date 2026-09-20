import { BrowserWindow, session } from 'electron';

import {
  chatgptPageScript,
  deepseekPageScript,
  glmPageScript,
  qwenPageScript,
} from './page-scripts.js';
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
}

function meta(id: ManagedProviderId) {
  const found = MANAGED_PROVIDERS.find((item) => item.id === id);
  if (!found) {
    throw new Error(`unknown managed provider: ${id}`);
  }
  return found;
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

  constructor(private readonly appIcon?: string) {
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
  ): void {
    this.#status.set(id, status);
    if (detail !== undefined) {
      this.#detail.set(id, detail);
    } else {
      this.#detail.delete(id);
    }
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
    this.#windows.set(id, win);
    if (!win.webContents.getURL()) {
      await win.loadURL(provider.homeUrl);
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
    const win = await this.ensureWindow(id);
    await win.loadURL(meta(id).homeUrl);
  }

  async probe(id: ManagedProviderId): Promise<ProviderProbe> {
    const win = await this.ensureWindow(id);
    await this.#waitReady(win);
    await win.webContents.executeJavaScript(
      `window.__rayzanProviderApi = (${pageScript(id)}); true`,
      true,
    );
    return (await win.webContents.executeJavaScript(
      `window.__rayzanProviderApi.probe()`,
      true,
    )) as ProviderProbe;
  }

  async refreshConnection(id: ManagedProviderId): Promise<ProviderProbe> {
    try {
      const win = await this.ensureWindow(id);
      await this.#waitReady(win);
      await win.webContents.executeJavaScript(
        `window.__rayzanProviderApi = (${pageScript(id)}); true`,
        true,
      );
      const probe = (await win.webContents.executeJavaScript(
        `window.__rayzanProviderApi.probe()`,
        true,
      )) as ProviderProbe;
      const prior = this.#status.get(id);
      if (probe.loggedIn) {
        this.setStatus(id, 'connected');
      } else if (prior === 'connecting' || prior === 'restoring') {
        // Keep Connecting/Restoring through OAuth / interstitial pages so the
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
        );
      } else {
        this.setStatus(id, 'not_connected');
      }
      return probe;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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
    await win.webContents.executeJavaScript(
      `window.__rayzanProviderApi = (${pageScript(id)}); true`,
      true,
    );
    await win.webContents.executeJavaScript(
      `window.__rayzanProviderApi.createNewChat()`,
      true,
    );
    await this.#waitReady(win);
    await delay(1200);
    return { url: win.webContents.getURL() };
  }

  async sendMessage(id: ManagedProviderId, text: string): Promise<void> {
    await this.wakeForWork(id);
    const win = await this.ensureWindow(id);
    await this.#waitReady(win);
    await win.webContents.executeJavaScript(
      `window.__rayzanProviderApi = (${pageScript(id)}); true`,
      true,
    );
    await win.webContents.executeJavaScript(
      `window.__rayzanProviderApi.sendPrompt(${JSON.stringify(text)})`,
      true,
    );
  }

  async snapshot(id: ManagedProviderId): Promise<ProviderSnapshot> {
    const win = await this.ensureWindow(id);
    await this.#waitReady(win);
    await win.webContents.executeJavaScript(
      `window.__rayzanProviderApi = (${pageScript(id)}); true`,
      true,
    );
    return (await win.webContents.executeJavaScript(
      `window.__rayzanProviderApi.snapshot()`,
      true,
    )) as ProviderSnapshot;
  }

  /** Stop DeepSeek generation and salvage JSON stuck inside think content. */
  async #tryDeepSeekThinkBail(
    id: ManagedProviderId,
    expectJson: boolean,
  ): Promise<string | undefined> {
    const win = await this.ensureWindow(id);
    await win.webContents.executeJavaScript(
      `window.__rayzanProviderApi = (${pageScript(id)}); true`,
      true,
    );
    await win.webContents.executeJavaScript(
      `window.__rayzanProviderApi.stopGeneration?.()`,
      true,
    );
    await delay(1_200);
    const snap = await this.snapshot(id);
    const candidate = snap.last.trim();
    if (!candidate || isJunkCapture(candidate)) {
      return undefined;
    }
    if (expectJson) {
      return looksCompleteJsonObject(candidate)
        ? extractJsonObject(candidate)
        : undefined;
    }
    return candidate.length >= 40 ? candidate : undefined;
  }

  async captureStableResponse(
    id: ManagedProviderId,
    preCount: number,
    options?: {
      readonly timeoutMs?: number;
      readonly stabilityMs?: number;
      /** When true, keep waiting until the captured text parses as JSON. */
      readonly expectJson?: boolean;
      /** Resume capture when the reply may already be on screen. */
      readonly allowExisting?: boolean;
    },
  ): Promise<string> {
    await this.wakeForWork(id);
    const expectJson = options?.expectJson === true;
    const allowExisting = options?.allowExisting === true;
    // DeepSeek R1 thinking on large Round-2 evidence packs often exceeds 3 minutes.
    const timeoutMs =
      options?.timeoutMs ?? (expectJson ? 420_000 : 180_000);
    const stabilityMs = options?.stabilityMs ?? (expectJson ? 3_500 : 2_500);
    const started = Date.now();
    let lastText = '';
    let lastChange = Date.now();
    let lastWake = Date.now();
    let deepSeekBailAttempted = false;
    while (Date.now() - started < timeoutMs) {
      if (Date.now() - lastWake > 15_000) {
        await this.wakeForWork(id);
        lastWake = Date.now();
      }
      const snap = await this.snapshot(id);
      const candidate = snap.last.trim();
      // For JSON jobs, never treat the previous prose reply (e.g. checkpoint)
      // as the in-flight answer — that loops forever waiting for prose to
      // become a command batch.
      const jsonish = !expectJson || looksLikeJsonCandidate(candidate);
      const countOk =
        snap.count > preCount ||
        (allowExisting && jsonish && candidate.length > 0);
      const usable =
        countOk &&
        candidate.length > 0 &&
        !isJunkCapture(candidate) &&
        jsonish;
      if (usable) {
        if (candidate !== lastText) {
          lastText = candidate;
          lastChange = Date.now();
        } else if (
          Date.now() - lastChange >= stabilityMs &&
          !looksIncompleteJson(lastText) &&
          (!expectJson || looksCompleteJsonObject(lastText)) &&
          // GLM thinking-chain stays up while answer tokens stream — never
          // accept mid-think even if text is already long.
          // DeepSeek/Qwen may flicker Stop; allow a long stable reply then.
          (!snap.generating ||
            (id !== 'glm' && !expectJson && lastText.length >= 80))
        ) {
          return expectJson ? extractJsonObject(lastText) ?? lastText : lastText;
        }
      }

      // DeepSeek R1 can sit in think-only mode for many minutes. After a grace
      // period, stop generation and accept think-text if it already looks like
      // the JSON batch we asked for.
      if (
        id === 'deepseek' &&
        expectJson &&
        snap.generating &&
        !deepSeekBailAttempted &&
        Date.now() - started > 90_000
      ) {
        deepSeekBailAttempted = true;
        const thinkBail = await this.#tryDeepSeekThinkBail(id, expectJson);
        if (thinkBail) {
          return thinkBail;
        }
      }
      await delay(400);
    }
    throw new Error(`${meta(id).label} response capture timed out`);
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

function looksIncompleteJson(text: string): boolean {
  const trimmed = text.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) {
    return false;
  }
  try {
    JSON.parse(trimmed);
    return false;
  } catch {
    return true;
  }
}

function looksCompleteJsonObject(text: string): boolean {
  return extractJsonObject(text) !== undefined;
}

/** True when text looks like a coordinator JSON batch (complete or still streaming). */
function looksLikeJsonCandidate(text: string): boolean {
  if (looksCompleteJsonObject(text)) {
    return true;
  }
  const trimmed = text.trim();
  if (/```(?:json)?/i.test(trimmed) && trimmed.includes('{')) {
    return true;
  }
  const start = trimmed.indexOf('{');
  if (start < 0) {
    return false;
  }
  const slice = trimmed.slice(start);
  return /"version"\s*:/.test(slice) || /"commands"\s*:/.test(slice);
}

function extractJsonObject(text: string): string | undefined {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return undefined;
  }
  const slice = candidate.slice(start, end + 1);
  try {
    const parsed: unknown = JSON.parse(slice);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return slice;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function isJunkCapture(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return true;
  }
  // UI chrome only — short one-word replies are valid (smoke-test debates).
  if (/^(ChatGPT|DeepSeek|Assistant|Grok)\s*said:?$/i.test(trimmed)) {
    return true;
  }
  if (/^ChatGPT said:\s*$/i.test(trimmed)) {
    return true;
  }
  return false;
}
