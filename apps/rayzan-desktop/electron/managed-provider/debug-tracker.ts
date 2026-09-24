import type { ManagedProviderId, ProviderConnectionStatus } from './types.js';

export interface DebugTransition {
  readonly at: number;
  readonly label: string;
  readonly detail?: string;
}

export interface ProviderDebugSnapshot {
  readonly providerId: string;
  readonly session?: {
    readonly state:
      | 'connected'
      | 'restoring'
      | 'connecting'
      | 'logged_out'
      | 'error'
      | 'not_connected'
      | 'unknown';
    readonly detail?: string;
    readonly loggedIn?: boolean;
  };
  readonly page?: {
    readonly state: 'ready' | 'loading' | 'navigating' | 'hidden' | 'error' | 'none';
    readonly url?: string;
    readonly visible?: boolean;
  };
  readonly conversation?: {
    readonly state: 'ready' | 'none' | 'unknown';
    readonly conversationId?: string;
  };
  readonly send?: { readonly state: string; readonly error?: string };
  readonly generation?: { readonly state: 'idle' | 'active' | 'ended' | 'unknown' };
  readonly probe?: {
    readonly hasComposer?: boolean;
    readonly hasSend?: boolean;
    readonly generating?: boolean;
    readonly url?: string;
    readonly title?: string;
  };
  readonly lastError?: string;
  readonly lastChangedAt?: number;
  readonly transitions?: readonly DebugTransition[];
}

interface ProviderDebugState {
  sessionState?: {
    state: DebugSessionState;
    detail?: string;
    loggedIn?: boolean;
  };
  captureActive?: boolean;
  pageState: 'ready' | 'loading' | 'navigating' | 'hidden' | 'error' | 'none';
  pageUrl?: string;
  pageVisible?: boolean;
  conversation?: ProviderDebugSnapshot['conversation'];
  send?: ProviderDebugSnapshot['send'];
  generation?: ProviderDebugSnapshot['generation'];
  probe?: ProviderDebugSnapshot['probe'];
  lastError?: string;
  lastChangedAt: number;
  transitions: DebugTransition[];
}

const TRANSITION_LIMIT = 40;

type DebugSessionState =
  | 'connected'
  | 'restoring'
  | 'connecting'
  | 'logged_out'
  | 'error'
  | 'not_connected'
  | 'unknown';

/**
 * Ephemeral, in-memory debug observability for managed provider windows.
 * Never persisted, never emitted as events, never guessed from timers —
 * every state here was reported by the browser layer.
 */
export class ProviderDebugTracker {
  readonly #states = new Map<ManagedProviderId, ProviderDebugState>();

  #state(id: ManagedProviderId): ProviderDebugState {
    let state = this.#states.get(id);
    if (state === undefined) {
      state = {
        pageState: 'none',
        lastChangedAt: Date.now(),
        transitions: [],
      };
      this.#states.set(id, state);
    }
    return state;
  }

  #record(state: ProviderDebugState, label: string, detail?: string): void {
    state.transitions.push({
      at: Date.now(),
      label,
      ...(detail !== undefined ? { detail } : {}),
    });
    if (state.transitions.length > TRANSITION_LIMIT) {
      state.transitions.splice(0, state.transitions.length - TRANSITION_LIMIT);
    }
  }

  /**
   * A successful progression supersedes any earlier failure on the same
   * interaction — Last error must describe the current interaction, not a
   * previous attempt.
   */
  #clearError(state: ProviderDebugState): void {
    if (state.lastError !== undefined) {
      state.lastError = undefined;
    }
  }

  observeSession(
    id: ManagedProviderId,
    status: ProviderConnectionStatus,
    detail?: string,
    probe?: { readonly loggedIn?: boolean; readonly needsLogin?: boolean },
  ): void {
    const state = this.#state(id);
    const previous = state.sessionState?.state;
    let next: DebugSessionState;
    switch (status) {
      case 'connected':
        next = 'connected';
        break;
      case 'restoring':
        next = 'restoring';
        break;
      case 'connecting':
        next = 'connecting';
        break;
      case 'needs_attention':
        next = probe?.needsLogin === true ? 'logged_out' : 'error';
        break;
      case 'not_connected':
        next = detail !== undefined ? 'logged_out' : 'not_connected';
        break;
      default:
        next = 'unknown';
        break;
    }
    const nextState = {
      state: next,
      ...(detail !== undefined ? { detail } : {}),
      ...(probe?.loggedIn !== undefined ? { loggedIn: probe.loggedIn } : {}),
    };
    if (previous === next && state.sessionState?.detail === detail) {
      state.sessionState = nextState;
      return;
    }
    state.sessionState = nextState;
    state.lastChangedAt = Date.now();
    if (next === 'connected') {
      this.#clearError(state);
    }
    if (detail !== undefined && (next === 'error' || next === 'logged_out')) {
      state.lastError = detail;
    }
    this.#record(
      state,
      next === 'connected'
        ? 'session-connected'
        : next === 'restoring' || next === 'connecting'
          ? 'session-restoring'
          : next === 'logged_out'
            ? 'session-logged-out'
            : next === 'error'
              ? 'session-error'
              : `session-${next}`,
      detail,
    );
  }

  observePage(
    id: ManagedProviderId,
    patch: {
      readonly state?: ProviderDebugState['pageState'];
      readonly url?: string;
      readonly visible?: boolean;
      readonly detail?: string;
    },
  ): void {
    const state = this.#state(id);
    const previousState = state.pageState;
    const previousVisible = state.pageVisible;
    if (patch.state !== undefined) {
      state.pageState = patch.state;
    }
    if (patch.url !== undefined) {
      state.pageUrl = patch.url;
    }
    if (patch.visible !== undefined) {
      state.pageVisible = patch.visible;
    }
    if (
      patch.state === undefined &&
      patch.visible === undefined &&
      patch.url === undefined
    ) {
      return;
    }
    const changed =
      (patch.state !== undefined && previousState !== state.pageState) ||
      (patch.visible !== undefined && previousVisible !== state.pageVisible);
    if (!changed) {
      if (patch.url !== undefined) {
        state.pageUrl = patch.url;
      }
      return;
    }
    state.lastChangedAt = Date.now();
    if (patch.visible !== undefined && previousVisible !== state.pageVisible) {
      this.#record(
        state,
        state.pageVisible ? 'page-shown' : 'page-hidden',
        patch.detail,
      );
    }
    if (patch.state !== undefined && previousState !== state.pageState) {
      const labels: Record<ProviderDebugState['pageState'], string> = {
        ready: 'page-ready',
        loading: 'page-loading',
        navigating: 'page-navigating',
        hidden: 'page-hidden',
        error: 'page-error',
        none: 'page-none',
      };
      this.#record(state, labels[state.pageState] ?? 'page-unknown', patch.detail);
      if (state.pageState === 'error' && patch.detail !== undefined) {
        state.lastError = patch.detail;
      }
    }
  }

  observeProbe(
    id: ManagedProviderId,
    probe: {
      readonly loggedIn?: boolean;
      readonly hasComposer?: boolean;
      readonly hasSend?: boolean;
      readonly generating?: boolean;
      readonly url?: string;
      readonly title?: string;
    },
  ): void {
    const state = this.#state(id);
    state.probe = {
      ...(probe.hasComposer !== undefined ? { hasComposer: probe.hasComposer } : {}),
      ...(probe.hasSend !== undefined ? { hasSend: probe.hasSend } : {}),
      ...(probe.generating !== undefined ? { generating: probe.generating } : {}),
      ...(probe.url !== undefined ? { url: probe.url } : {}),
      ...(probe.title !== undefined ? { title: probe.title } : {}),
    };
    if (probe.url !== undefined) {
      state.pageUrl = probe.url;
    }
    // Outside an active capture run the probe is the honest generation source
    // (provider Stop button visible). During capture the capture machine owns
    // generation state and probe updates must not clobber it.
    if (!state.captureActive && probe.generating !== undefined) {
      this.setGeneration(id, probe.generating ? 'active' : 'idle');
    }
  }

  /** Capture machine owns generation state while a capture run is active. */
  setCaptureActive(id: ManagedProviderId, active: boolean): void {
    const state = this.#state(id);
    state.captureActive = active;
  }

  setSend(
    id: ManagedProviderId,
    sendState: 'idle' | 'preparing' | 'composer_ready' | 'submitting' | 'accepted' | 'failed',
    error?: string,
  ): void {
    const state = this.#state(id);
    const previous = state.send?.state;
    const next = { state: sendState, ...(error !== undefined ? { error } : {}) };
    if (previous === sendState && state.send?.error === error) {
      return;
    }
    state.send = next;
    state.lastChangedAt = Date.now();
    if (sendState === 'failed' && error !== undefined) {
      state.lastError = error;
    }
    if (sendState === 'accepted') {
      // Submit accepted supersedes earlier send/capture errors.
      this.#clearError(state);
    }
    const labels: Record<string, string> = {
      preparing: 'send-started',
      composer_ready: 'composer-ready',
      submitting: 'submitting',
      accepted: 'submit-accepted',
      failed: 'send-failed',
      idle: 'send-idle',
    };
    this.#record(state, labels[sendState] ?? `send-${sendState}`, error);
  }

  setGeneration(
    id: ManagedProviderId,
    generationState: 'idle' | 'active' | 'ended' | 'unknown',
    detail?: string,
  ): void {
    const state = this.#state(id);
    const previous = state.generation?.state;
    if (previous === generationState) {
      return;
    }
    state.generation = { state: generationState };
    state.lastChangedAt = Date.now();
    const labels: Record<string, string> = {
      active: 'generation-active',
      ended: 'generation-ended',
      idle: 'generation-idle',
      unknown: 'generation-unknown',
    };
    this.#record(state, labels[generationState] ?? `generation-${generationState}`, detail);
  }

  setConversation(
    id: ManagedProviderId,
    conversationState: 'ready' | 'none' | 'unknown',
    conversationId?: string,
  ): void {
    const state = this.#state(id);
    const previous = state.conversation;
    if (previous?.state === conversationState && previous.conversationId === conversationId) {
      return;
    }
    state.conversation = {
      state: conversationState,
      ...(conversationId !== undefined ? { conversationId } : {}),
    };
    state.lastChangedAt = Date.now();
    this.#record(
      state,
      conversationState === 'ready' ? 'conversation-ready' : `conversation-${conversationState}`,
      conversationId,
    );
  }

  transition(id: ManagedProviderId, label: string, detail?: string): void {
    const state = this.#state(id);
    this.#record(state, label, detail);
    state.lastChangedAt = Date.now();
    if (label === 'capture-captured') {
      this.#clearError(state);
    }
  }

  noteError(id: ManagedProviderId, message: string): void {
    const state = this.#state(id);
    if (state.lastError === message) {
      return;
    }
    state.lastError = message;
    state.lastChangedAt = Date.now();
  }

  resetSend(id: ManagedProviderId): void {
    const state = this.#state(id);
    if (state.send !== undefined) {
      state.send = { state: 'idle' };
      state.lastChangedAt = Date.now();
    }
  }

  /**
   * Display-only correction: the tracker said loading but the webContents
   * reports nothing loading (phantom navigation). Set ready — real page
   * activity will re-enter loading through the normal navigation events.
   */
  reconcilePageNotLoading(id: ManagedProviderId, url?: string): void {
    const state = this.#state(id);
    if (state.pageState !== 'loading' && state.pageState !== 'navigating') {
      return;
    }
    state.pageState = 'ready';
    state.lastChangedAt = Date.now();
    if (url !== undefined) {
      state.pageUrl = url;
    }
    this.#record(state, 'page-ready', 'reconciled: webContents idle');
  }

  snapshot(id: ManagedProviderId): ProviderDebugSnapshot {
    const state = this.#state(id);
    return {
      providerId: id,
      ...(state.sessionState !== undefined ? { session: state.sessionState } : {}),
      page: {
        state: state.pageState,
        ...(state.pageUrl !== undefined ? { url: state.pageUrl } : {}),
        ...(state.pageVisible !== undefined ? { visible: state.pageVisible } : {}),
      },
      ...(state.conversation !== undefined ? { conversation: state.conversation } : {}),
      ...(state.send !== undefined ? { send: state.send } : {}),
      ...(state.generation !== undefined ? { generation: state.generation } : {}),
      ...(state.probe !== undefined ? { probe: state.probe } : {}),
      ...(state.lastError !== undefined ? { lastError: state.lastError } : {}),
      lastChangedAt: state.lastChangedAt,
      transitions: [...state.transitions],
    };
  }
}
