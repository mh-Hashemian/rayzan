import {
  GENERATION_WATCHDOG_MS,
  NEW_TURN_WATCHDOG_MS,
  type CaptureFailureReason,
  type CaptureObservation,
  type CapturePhase,
  type CaptureSnapshot,
  type CaptureTurn,
} from './types.js';
import { resolveTrackedTurn } from './turns.js';

export interface CaptureMachineState {
  readonly phase: CapturePhase;
  readonly trackedIdentity?: string;
  readonly lastText: string;
  readonly lastChangeAt: number;
  readonly startedAt: number;
  readonly sawGenerating?: boolean;
  readonly generationStartedAt?: number;
  readonly generationEndedAt?: number;
}

export interface CaptureEvaluation {
  readonly phase: CapturePhase;
  readonly failure?: CaptureFailureReason;
  readonly tracked?: CaptureTurn;
  readonly text?: string;
  readonly lastText: string;
  readonly lastChangeAt: number;
  readonly trackedConnected: boolean;
  readonly sawGenerating?: boolean;
  readonly generationStartedAt?: number;
  readonly generationEndedAt?: number;
}

export function initialCaptureState(now: number): CaptureMachineState {
  return {
    phase: 'waiting-for-new-turn',
    lastText: '',
    lastChangeAt: now,
    startedAt: now,
    sawGenerating: false,
  };
}

/**
 * Evaluate one observation.
 *
 * Happy path: new turn + generation ended + readable text → captured.
 * Timers are watchdogs only (new-turn / generation timeouts).
 */
export function evaluateCapture(input: {
  readonly snapshot: CaptureSnapshot;
  readonly observation: CaptureObservation;
  readonly state: CaptureMachineState;
  readonly now: number;
  readonly newTurnTimeoutMs?: number;
  readonly generationTimeoutMs?: number;
  /** Ignored — retained for API compatibility. Not used for completion. */
  readonly stabilityWindowMs?: number;
}): CaptureEvaluation {
  const newTurnTimeoutMs = input.newTurnTimeoutMs ?? NEW_TURN_WATCHDOG_MS;
  const generationTimeoutMs =
    input.generationTimeoutMs ?? GENERATION_WATCHDOG_MS;

  let tracked = resolveTrackedTurn(
    input.observation.turns,
    input.snapshot,
    input.state.trackedIdentity,
  );

  const sawGenerating =
    input.state.sawGenerating === true || input.observation.generating;
  const generationStartedAt =
    input.state.generationStartedAt ??
    (input.observation.generating && !input.state.sawGenerating
      ? input.now
      : input.state.generationStartedAt);
  let generationEndedAt = input.state.generationEndedAt;
  if (
    input.state.sawGenerating &&
    !input.observation.generating &&
    generationEndedAt === undefined
  ) {
    generationEndedAt = input.now;
  }

  if (tracked === undefined && input.state.trackedIdentity) {
    const last = input.observation.turns.at(-1);
    const lastIsUnknown =
      last !== undefined &&
      !input.snapshot.identities.includes(last.identity);
    const lastTextChanged =
      last !== undefined &&
      last.finalText !== (input.snapshot.lastAssistantText ?? '');
    if (last !== undefined && (lastIsUnknown || lastTextChanged)) {
      tracked = last;
    } else if (input.observation.generating) {
      if (input.now - input.state.startedAt >= generationTimeoutMs) {
        return fail(input, 'generation-timeout', false, undefined, {
          sawGenerating,
          generationStartedAt,
          generationEndedAt,
        });
      }
      return {
        phase: 'generating',
        lastText: input.state.lastText,
        lastChangeAt: input.state.lastChangeAt,
        trackedConnected: false,
        sawGenerating,
        generationStartedAt,
        generationEndedAt,
      };
    } else {
      return fail(input, 'tracked-turn-disappeared', false, undefined, {
        sawGenerating,
        generationStartedAt,
        generationEndedAt,
      });
    }
  }

  if (tracked === undefined) {
    if (input.observation.generating) {
      if (input.now - input.state.startedAt >= generationTimeoutMs) {
        return fail(input, 'generation-timeout', false, undefined, {
          sawGenerating,
          generationStartedAt,
          generationEndedAt,
        });
      }
      return {
        phase: 'generating',
        lastText: input.state.lastText,
        lastChangeAt: input.state.lastChangeAt,
        trackedConnected: false,
        sawGenerating,
        generationStartedAt,
        generationEndedAt,
      };
    }
    if (input.now - input.state.startedAt >= newTurnTimeoutMs) {
      return fail(input, 'new-turn-timeout', false, undefined, {
        sawGenerating,
        generationStartedAt,
        generationEndedAt,
      });
    }
    return {
      phase: 'waiting-for-new-turn',
      lastText: input.state.lastText,
      lastChangeAt: input.state.lastChangeAt,
      trackedConnected: false,
      sawGenerating,
      generationStartedAt,
      generationEndedAt,
    };
  }

  const connected = tracked.connected !== false;

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
        connected,
        tracked,
        { sawGenerating, generationStartedAt, generationEndedAt },
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
      trackedConnected: connected,
      sawGenerating,
      generationStartedAt,
      generationEndedAt,
    };
  }

  const text = tracked.finalText;
  if (text.length === 0) {
    return fail(input, 'empty-response', connected, tracked, {
      sawGenerating,
      generationStartedAt,
      generationEndedAt,
    });
  }

  // Terminal signal just observed (provider generation control gone). The
  // provider may still commit final DOM content after this signal, so the
  // turn text is only confirmed by a later observation. This is event-driven:
  // the confirming read happens across the next real observation gap, never
  // after a fixed timer. The stage decision uses the machine state's prior
  // knowledge — not the value computed for this very observation.
  if (input.state.generationEndedAt === undefined) {
    return {
      phase: 'reading-final-response',
      tracked,
      lastText: text,
      lastChangeAt:
        text === input.state.lastText ? input.state.lastChangeAt : input.now,
      trackedConnected: connected,
      sawGenerating,
      generationStartedAt,
      generationEndedAt: input.now,
    };
  }

  // Final content landed after the terminal signal — take the new text and
  // require one more confirming read before completing.
  if (text !== input.state.lastText) {
    return {
      phase: 'reading-final-response',
      tracked,
      lastText: text,
      lastChangeAt: input.now,
      trackedConnected: connected,
      sawGenerating,
      generationStartedAt,
      generationEndedAt: input.state.generationEndedAt,
    };
  }

  // Provider generation ended + new turn readable + text confirmed across the
  // terminal boundary → capture. JSON validity is protocol validation AFTER
  // RESPONSE_CAPTURED.
  return {
    phase: 'captured',
    tracked,
    text,
    lastText: text,
    lastChangeAt:
      text === input.state.lastText ? input.state.lastChangeAt : input.now,
    trackedConnected: connected,
    sawGenerating,
    generationStartedAt,
    generationEndedAt: input.state.generationEndedAt,
  };
}

function fail(
  input: { state: CaptureMachineState },
  reason: CaptureFailureReason,
  trackedConnected: boolean,
  tracked: CaptureTurn | undefined,
  extras: {
    sawGenerating?: boolean;
    generationStartedAt?: number;
    generationEndedAt?: number;
  },
): CaptureEvaluation {
  return {
    phase: 'failed',
    failure: reason,
    tracked,
    lastText: input.state.lastText,
    lastChangeAt: input.state.lastChangeAt,
    trackedConnected,
    ...extras,
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
