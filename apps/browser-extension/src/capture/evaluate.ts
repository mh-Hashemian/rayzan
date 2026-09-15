import {
  GENERATION_TIMEOUT_MS,
  NEW_TURN_TIMEOUT_MS,
  STABILITY_WINDOW_MS,
  type CaptureObservation,
  type CapturePhase,
  type CaptureSnapshot,
  type CaptureFailureReason,
  type AssistantTurn,
} from './types.js';
import { resolveTrackedTurn } from './turns.js';

export interface CaptureMachineState {
  readonly phase: CapturePhase;
  readonly trackedIdentity?: string;
  readonly lastText: string;
  readonly lastChangeAt: number;
  readonly startedAt: number;
}

export interface CaptureEvaluation {
  readonly phase: CapturePhase;
  readonly failure?: CaptureFailureReason;
  readonly tracked?: AssistantTurn;
  readonly text?: string;
  readonly lastText: string;
  readonly lastChangeAt: number;
  readonly trackedConnected: boolean;
}

export function initialCaptureState(now: number): CaptureMachineState {
  return {
    phase: 'waiting-for-new-turn',
    lastText: '',
    lastChangeAt: now,
    startedAt: now,
  };
}

export function evaluateCapture(input: {
  readonly snapshot: CaptureSnapshot;
  readonly observation: CaptureObservation;
  readonly state: CaptureMachineState;
  readonly now: number;
  readonly newTurnTimeoutMs?: number;
  readonly generationTimeoutMs?: number;
  readonly stabilityWindowMs?: number;
}): CaptureEvaluation {
  const newTurnTimeoutMs = input.newTurnTimeoutMs ?? NEW_TURN_TIMEOUT_MS;
  const generationTimeoutMs =
    input.generationTimeoutMs ?? GENERATION_TIMEOUT_MS;
  const stabilityWindowMs = input.stabilityWindowMs ?? STABILITY_WINDOW_MS;
  const tracked = resolveTrackedTurn(
    input.observation.turns,
    input.snapshot,
    input.state.trackedIdentity,
  );

  if (input.state.trackedIdentity && tracked === undefined) {
    return fail(input, 'tracked-turn-disappeared', false);
  }

  if (tracked === undefined) {
    if (input.now - input.state.startedAt >= newTurnTimeoutMs) {
      return fail(input, 'new-turn-timeout', false);
    }
    return {
      phase: 'waiting-for-new-turn',
      lastText: input.state.lastText,
      lastChangeAt: input.state.lastChangeAt,
      trackedConnected: false,
    };
  }

  if (
    tracked.thinkingOnly ||
    !tracked.hasFinalAnswer ||
    input.observation.generating
  ) {
    if (input.now - input.state.startedAt >= generationTimeoutMs) {
      return fail(
        input,
        tracked.thinkingOnly && !tracked.hasFinalAnswer
          ? 'thinking-only'
          : 'generation-timeout',
        true,
        tracked,
      );
    }
    return {
      phase: 'generating',
      tracked,
      lastText: tracked.finalText,
      lastChangeAt:
        tracked.finalText === input.state.lastText
          ? input.state.lastChangeAt
          : input.now,
      trackedConnected: tracked.element.isConnected,
    };
  }

  const text = tracked.finalText;
  if (text.length === 0) {
    return fail(input, 'empty-response', true, tracked);
  }
  const lastChangeAt =
    text === input.state.lastText ? input.state.lastChangeAt : input.now;
  if (input.now - lastChangeAt < stabilityWindowMs) {
    return {
      phase: 'stabilizing',
      tracked,
      text,
      lastText: text,
      lastChangeAt,
      trackedConnected: tracked.element.isConnected,
    };
  }
  return {
    phase: 'captured',
    tracked,
    text,
    lastText: text,
    lastChangeAt,
    trackedConnected: tracked.element.isConnected,
  };
}

function fail(
  input: {
    state: CaptureMachineState;
  },
  reason: CaptureFailureReason,
  trackedConnected: boolean,
  tracked?: AssistantTurn,
): CaptureEvaluation {
  return {
    phase: 'failed',
    failure: reason,
    tracked,
    lastText: input.state.lastText,
    lastChangeAt: input.state.lastChangeAt,
    trackedConnected,
  };
}

export class CaptureError extends Error {
  readonly reason: CaptureFailureReason;

  constructor(reason: CaptureFailureReason, message?: string) {
    super(message ?? reason);
    this.name = 'CaptureError';
    this.reason = reason;
  }
}
