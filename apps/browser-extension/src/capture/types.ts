export type CapturePhase =
  | 'idle'
  | 'snapshot'
  | 'prompt-submitted'
  | 'waiting-for-new-turn'
  | 'generating'
  | 'stabilizing'
  | 'captured'
  | 'failed';

export type CaptureFailureReason =
  | 'new-turn-timeout'
  | 'generation-timeout'
  | 'tracked-turn-disappeared'
  | 'empty-response'
  | 'thinking-only'
  | 'bridge-submit-failed'
  | 'snapshot-missing';

export interface AssistantTurn {
  readonly element: Element;
  readonly identity: string;
  readonly thinkingOnly: boolean;
  readonly hasFinalAnswer: boolean;
  readonly finalText: string;
}

export interface CaptureSnapshot {
  readonly identities: readonly string[];
  readonly assistantTurnCount: number;
  readonly lastAssistantText?: string;
  readonly lastIncomplete: boolean;
  readonly elements?: ReadonlySet<Element>;
}

export interface CaptureObservation {
  readonly turns: readonly AssistantTurn[];
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
}

export interface CaptureJob {
  readonly deliveryId: string;
  readonly agentId: string;
  readonly provider: string;
  phase: CapturePhase;
  trackedIdentity?: string;
  readonly startedAt: number;
  report: CaptureReport;
}

export const NEW_TURN_TIMEOUT_MS = 90_000;
export const GENERATION_TIMEOUT_MS = 180_000;
export const STABILITY_WINDOW_MS = 2_000;
