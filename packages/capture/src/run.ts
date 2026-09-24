import {
  evaluateCapture,
  initialCaptureState,
  CaptureError,
  type CaptureEvaluation,
  type CaptureMachineState,
} from './evaluate.js';
import type { CaptureObservation, CaptureSnapshot } from './types.js';
import { GENERATION_WATCHDOG_MS, NEW_TURN_WATCHDOG_MS } from './types.js';

export async function runCapture(input: {
  readonly snapshot: CaptureSnapshot;
  readonly observe: () => CaptureObservation | Promise<CaptureObservation>;
  /** Prefer mutation-driven wake; short delay is only a fallback tick. */
  readonly waitForChange?: (timeoutMs: number) => Promise<void>;
  readonly onPhase?: (evaluation: CaptureEvaluation) => void;
  readonly now?: () => number;
  readonly waitMs?: (ms: number) => Promise<void>;
  readonly newTurnTimeoutMs?: number;
  readonly generationTimeoutMs?: number;
}): Promise<string> {
  const now = input.now ?? Date.now;
  const waitMs =
    input.waitMs ??
    ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let state: CaptureMachineState = initialCaptureState(now());
  let lastPhase = state.phase;
  input.onPhase?.({
    phase: state.phase,
    lastText: '',
    lastChangeAt: state.lastChangeAt,
    trackedConnected: false,
  });

  for (;;) {
    const observation = await input.observe();
    const evaluation = evaluateCapture({
      snapshot: input.snapshot,
      observation,
      state,
      now: now(),
      newTurnTimeoutMs: input.newTurnTimeoutMs ?? NEW_TURN_WATCHDOG_MS,
      generationTimeoutMs:
        input.generationTimeoutMs ?? GENERATION_WATCHDOG_MS,
    });
    state = {
      phase: evaluation.phase,
      trackedIdentity: evaluation.tracked?.identity,
      lastText: evaluation.lastText,
      lastChangeAt: evaluation.lastChangeAt,
      startedAt: state.startedAt,
      sawGenerating: evaluation.sawGenerating,
      generationStartedAt: evaluation.generationStartedAt,
      generationEndedAt: evaluation.generationEndedAt,
    };
    if (evaluation.phase !== lastPhase) {
      input.onPhase?.(evaluation);
      lastPhase = evaluation.phase;
    } else {
      input.onPhase?.(evaluation);
    }
    if (evaluation.phase === 'captured') {
      if (!evaluation.text || evaluation.text.length === 0) {
        throw new CaptureError('empty-response');
      }
      return evaluation.text;
    }
    if (evaluation.phase === 'failed') {
      throw new CaptureError(
        evaluation.failure ?? 'generation-timeout',
        evaluation.failure,
      );
    }
    if (input.waitForChange) {
      await input.waitForChange(250);
    } else {
      await waitMs(80);
    }
  }
}
