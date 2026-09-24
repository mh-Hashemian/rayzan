import {
  CaptureError,
  evaluateCapture,
  initialCaptureState,
  type CaptureEvaluation,
  type CaptureMachineState,
  type CaptureObservation,
  type CaptureSnapshot,
  GENERATION_WATCHDOG_MS,
  NEW_TURN_WATCHDOG_MS,
} from '@rayzan/capture';

import type { ManagedProviderId } from './types.js';

export interface CaptureTextFingerprint {
  readonly length: number;
  readonly tail: string;
  readonly hash: string;
}

export interface ManagedCaptureSettledRead {
  readonly changedAfterTerminalRead: boolean;
  readonly readAt: number;
  readonly finalText: CaptureTextFingerprint;
}

export interface ManagedCaptureDebug {
  readonly deliveryId?: string;
  readonly provider: ManagedProviderId;
  readonly beforeSend: CaptureSnapshot;
  readonly newTurnIdentity?: string;
  readonly generationStartedAt?: number;
  readonly generationEndedAt?: number;
  readonly capturedAt?: number;
  readonly finalLength?: number;
  /** DOM text observed at the exact moment the terminal signal first appeared. */
  readonly textAtGenerationEnd?: CaptureTextFingerprint;
  readonly capturedTextTail?: string;
  readonly capturedTextHash?: string;
  readonly settledRead?: ManagedCaptureSettledRead;
  readonly transitions: readonly {
    readonly phase: string;
    readonly at: number;
  }[];
  readonly failure?: string;
}

export interface ManagedCaptureResult {
  readonly text: string;
  readonly debug: ManagedCaptureDebug;
}

export function fingerprintText(text: string): CaptureTextFingerprint {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return {
    length: text.length,
    tail: text.slice(-120),
    hash: (hash >>> 0).toString(16).padStart(8, '0'),
  };
}

/**
 * Extension-semantics capture for managed Electron provider windows.
 * Completion = new turn + generation ended + final text confirmed across the
 * terminal boundary (settled page read when the provider supports it).
 * Timers are watchdogs only.
 */
export async function runManagedCapture(input: {
  readonly providerId: ManagedProviderId;
  readonly deliveryId?: string;
  readonly beforeSend: CaptureSnapshot;
  readonly observe: () => Promise<CaptureObservation>;
  readonly waitForDomChange: (timeoutMs: number) => Promise<void>;
  /**
   * Page-scheduling settled re-read (rAF/production-commit flush). Used once
   * per captured proposal to confirm the final DOM text after the terminal
   * signal. Providers without page support fall back to the confirming-read
   * rule in evaluateCapture alone.
   */
  readonly settleObserve?: () => Promise<CaptureObservation>;
  readonly onPhase?: (
    phase: CaptureEvaluation['phase'],
    evaluation: CaptureEvaluation,
  ) => void;
  readonly newTurnWatchdogMs?: number;
  readonly generationWatchdogMs?: number;
}): Promise<ManagedCaptureResult> {
  const started = Date.now();
  const transitions: { phase: string; at: number }[] = [];
  let state: CaptureMachineState = initialCaptureState(started);
  let lastPhase = state.phase;
  let textAtGenerationEnd: CaptureTextFingerprint | undefined;
  let settledRead: ManagedCaptureSettledRead | undefined;
  transitions.push({ phase: state.phase, at: started });

  const record = (
    evaluation: CaptureEvaluation,
    stateBefore: CaptureMachineState,
  ): void => {
    if (evaluation.phase !== lastPhase) {
      transitions.push({ phase: evaluation.phase, at: Date.now() });
      lastPhase = evaluation.phase;
    }
    if (
      stateBefore.generationEndedAt === undefined &&
      evaluation.generationEndedAt !== undefined &&
      textAtGenerationEnd === undefined
    ) {
      textAtGenerationEnd = fingerprintText(
        evaluation.text ?? evaluation.lastText ?? '',
      );
    }
    input.onPhase?.(evaluation.phase, evaluation);
  };

  record(
    {
      phase: state.phase,
      lastText: '',
      lastChangeAt: state.lastChangeAt,
      trackedConnected: false,
    },
    state,
  );

  try {
    for (;;) {
      const observation = await input.observe();
      const evaluation = evaluateCapture({
        snapshot: input.beforeSend,
        observation,
        state,
        now: Date.now(),
        newTurnTimeoutMs: input.newTurnWatchdogMs ?? NEW_TURN_WATCHDOG_MS,
        generationTimeoutMs:
          input.generationWatchdogMs ?? GENERATION_WATCHDOG_MS,
      });
      const stateBefore = state;
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
      record(evaluation, stateBefore);

      if (evaluation.phase === 'captured') {
        if (!evaluation.text || evaluation.text.length === 0) {
          throw new CaptureError('empty-response');
        }
        // Confirm the captured text against a settled page read: the final
        // DOM commit may land after the terminal signal. If the settled read
        // differs, keep observing — the machine will re-propose capture once
        // the newer text is confirmed.
        if (input.settleObserve !== undefined) {
          const settled = await input.settleObserve();
          const settledEvaluation = evaluateCapture({
            snapshot: input.beforeSend,
            observation: settled,
            state: {
              ...state,
              // Force the confirming-read stage: compare against the text we
              // were about to capture.
              lastText: evaluation.text,
            },
            now: Date.now(),
            newTurnTimeoutMs: input.newTurnWatchdogMs ?? NEW_TURN_WATCHDOG_MS,
            generationTimeoutMs:
              input.generationWatchdogMs ?? GENERATION_WATCHDOG_MS,
          });
          settledRead = {
            changedAfterTerminalRead:
              settledEvaluation.text !== undefined &&
              settledEvaluation.text !== evaluation.text,
            readAt: Date.now(),
            finalText: fingerprintText(
              settledEvaluation.text ??
                settled.turns.at(-1)?.finalText ??
                evaluation.text,
            ),
          };
          record(settledEvaluation, state);          if (
            settledEvaluation.phase === 'captured' &&
            settledEvaluation.text !== undefined &&
            settledEvaluation.text !== evaluation.text
          ) {
            // Newer final text confirmed — loop continues with it.
            state = {
              phase: settledEvaluation.phase,
              trackedIdentity: settledEvaluation.tracked?.identity,
              lastText: settledEvaluation.lastText,
              lastChangeAt: settledEvaluation.lastChangeAt,
              startedAt: state.startedAt,
              sawGenerating: settledEvaluation.sawGenerating,
              generationStartedAt: settledEvaluation.generationStartedAt,
              generationEndedAt: settledEvaluation.generationEndedAt,
            };
            continue;
          }
          if (
            settledEvaluation.phase !== 'captured' &&
            settledEvaluation.phase !== 'failed'
          ) {
            // Settled read is not a terminal confirm (e.g. generating again)
            // — adopt its state and keep observing.
            state = {
              phase: settledEvaluation.phase,
              trackedIdentity: settledEvaluation.tracked?.identity,
              lastText: settledEvaluation.lastText,
              lastChangeAt: settledEvaluation.lastChangeAt,
              startedAt: state.startedAt,
              sawGenerating: settledEvaluation.sawGenerating,
              generationStartedAt: settledEvaluation.generationStartedAt,
              generationEndedAt: settledEvaluation.generationEndedAt,
            };
            continue;
          }
        }
        return {
          text: evaluation.text,
          debug: {
            ...(input.deliveryId ? { deliveryId: input.deliveryId } : {}),
            provider: input.providerId,
            beforeSend: input.beforeSend,
            newTurnIdentity: evaluation.tracked?.identity,
            generationStartedAt: evaluation.generationStartedAt,
            generationEndedAt: evaluation.generationEndedAt,
            capturedAt: Date.now(),
            finalLength: evaluation.text.length,
            ...(textAtGenerationEnd !== undefined
              ? { textAtGenerationEnd }
              : {}),
            capturedTextTail: evaluation.text.slice(-120),
            capturedTextHash: fingerprintText(evaluation.text).hash,
            ...(settledRead !== undefined ? { settledRead } : {}),
            transitions,
          },
        };
      }
      if (evaluation.phase === 'failed') {
        throw new CaptureError(
          evaluation.failure ?? 'generation-timeout',
          evaluation.failure,
        );
      }
      await input.waitForDomChange(250);
    }
  } catch (error) {
    const failure =
      error instanceof CaptureError
        ? error.reason
        : error instanceof Error
          ? error.message
          : String(error);
    const debug: ManagedCaptureDebug = {
      ...(input.deliveryId ? { deliveryId: input.deliveryId } : {}),
      provider: input.providerId,
      beforeSend: input.beforeSend,
      newTurnIdentity: state.trackedIdentity,
      generationStartedAt: state.generationStartedAt,
      generationEndedAt: state.generationEndedAt,
      transitions,
      ...(textAtGenerationEnd !== undefined ? { textAtGenerationEnd } : {}),
      ...(settledRead !== undefined ? { settledRead } : {}),
      failure,
    };
    if (error instanceof CaptureError) {
      (error as CaptureError & { debug?: ManagedCaptureDebug }).debug = debug;
      throw error;
    }
    const wrapped = new CaptureError('generation-timeout', failure);
    (wrapped as CaptureError & { debug?: ManagedCaptureDebug }).debug = debug;
    throw wrapped;
  }
}

export function presenceFromCapturePhase(
  phase: CaptureEvaluation['phase'],
): 'sending' | 'generating' | 'capturing' | 'captured' | 'attention' {
  switch (phase) {
    case 'snapshot':
    case 'prompt-submitted':
      return 'sending';
    case 'waiting-for-new-turn':
    case 'generating':
      return 'generating';
    case 'reading-final-response':
      return 'capturing';
    case 'captured':
      return 'captured';
    case 'failed':
      return 'attention';
    default:
      return 'generating';
  }
}
