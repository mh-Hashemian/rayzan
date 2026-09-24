/**
 * Shared capture contract for extension + managed Electron browser.
 *
 * Completion = new assistant turn for this prompt + provider generation ended.
 * Timers are watchdogs only — never happy-path completion heuristics.
 */

export type CapturePhase =
  | 'idle'
  | 'snapshot'
  | 'prompt-submitted'
  | 'waiting-for-new-turn'
  | 'generating'
  | 'reading-final-response'
  | 'captured'
  | 'failed';

export type CaptureFailureReason =
  | 'new-turn-timeout'
  | 'generation-timeout'
  | 'tracked-turn-disappeared'
  | 'empty-response'
  | 'thinking-only'
  | 'bridge-submit-failed'
  | 'snapshot-missing'
  | 'send-failed'
  | 'dom-unsupported';

/** Serializable turn — Element is optional (extension may attach DOM nodes). */
export interface CaptureTurn {
  readonly identity: string;
  readonly thinkingOnly: boolean;
  readonly hasFinalAnswer: boolean;
  readonly finalText: string;
  readonly connected?: boolean;
  readonly element?: unknown;
}

export interface CaptureSnapshot {
  readonly identities: readonly string[];
  readonly assistantTurnCount: number;
  readonly lastAssistantText?: string;
  readonly lastIncomplete: boolean;
}

export interface CaptureObservation {
  readonly turns: readonly CaptureTurn[];
  readonly generating: boolean;
}

export interface CaptureReport {
  readonly deliveryId: string;
  readonly agentId: string;
  readonly provider: string;
  readonly phase: CapturePhase;
  readonly promptSubmitted: boolean;
  readonly preSendTurnCount: number;
  readonly currentTurnCount?: number;
  readonly trackedIdentity?: string;
  readonly trackedConnected?: boolean;
  readonly generating?: boolean;
  readonly textLength?: number;
  readonly posted?: boolean;
  readonly reason?: CaptureFailureReason | string;
  readonly generationStartedAt?: number;
  readonly generationEndedAt?: number;
  readonly capturedAt?: number;
}

/** Watchdog only — not a completion heuristic. */
export const NEW_TURN_WATCHDOG_MS = 90_000;
/** Watchdog only — not a completion heuristic. */
export const GENERATION_WATCHDOG_MS = 180_000;

/** @deprecated Use NEW_TURN_WATCHDOG_MS. */
export const NEW_TURN_TIMEOUT_MS = NEW_TURN_WATCHDOG_MS;
/** @deprecated Use GENERATION_WATCHDOG_MS. */
export const GENERATION_TIMEOUT_MS = GENERATION_WATCHDOG_MS;
/** @deprecated Stability timers are not used for completion. */
export const STABILITY_WINDOW_MS = 0;
