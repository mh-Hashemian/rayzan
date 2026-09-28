import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluateCapture,
  initialCaptureState,
  runCapture,
  selectTrackedTurn,
  type CaptureSnapshot,
  type CaptureTurn,
} from './index.js';

function turn(
  identity: string,
  finalText: string,
  options?: { thinkingOnly?: boolean; hasFinalAnswer?: boolean },
): CaptureTurn {
  const hasFinalAnswer =
    options?.hasFinalAnswer ?? (finalText.length > 0 && !options?.thinkingOnly);
  return {
    identity,
    finalText: hasFinalAnswer ? finalText : '',
    hasFinalAnswer,
    thinkingOnly: options?.thinkingOnly ?? false,
  };
}

describe('@rayzan/capture evaluate', () => {
  it('ignores pre-send assistant turns', () => {
    const old = turn('idx:0', 'old');
    const snapshot: CaptureSnapshot = {
      identities: [old.identity],
      assistantTurnCount: 1,
      lastAssistantText: 'old',
      lastIncomplete: false,
    };
    assert.equal(selectTrackedTurn([old], snapshot), undefined);
    const evaluation = evaluateCapture({
      snapshot,
      observation: { turns: [old], generating: false },
      state: initialCaptureState(0),
      now: 1000,
    });
    assert.equal(evaluation.phase, 'waiting-for-new-turn');
  });

  it('does not treat a fast unobserved-generation read as terminal (text-before-stop race)', () => {
    // DeepSeek paints the first streaming chunk before mounting its stop
    // control; fast polls must not confirm it as a terminal read.
    const streaming = turn('idx:0', '{"version": 1,');
    const snapshot: CaptureSnapshot = {
      identities: [],
      assistantTurnCount: 0,
      lastIncomplete: false,
    };
    const evaluation = evaluateCapture({
      snapshot,
      observation: { turns: [streaming], generating: false },
      state: {
        ...initialCaptureState(0),
        trackedIdentity: 'idx:0',
        lastText: '{"version": 1,',
        lastChangeAt: 400,
      },
      now: 500,
    });
    assert.equal(evaluation.phase, 'generating');
    assert.equal(evaluation.text, undefined);
  });

  it('treats a long-quiet unobserved-generation read as the terminal boundary', () => {
    // Generation ended between polls (stop signal never seen). After the
    // quiet window the read becomes the terminal boundary, then the normal
    // confirming read must still happen before capture.
    const done = turn('idx:0', 'stable answer');
    const snapshot: CaptureSnapshot = {
      identities: [],
      assistantTurnCount: 0,
      lastIncomplete: false,
    };
    const boundary = evaluateCapture({
      snapshot,
      observation: { turns: [done], generating: false },
      state: {
        ...initialCaptureState(0),
        trackedIdentity: 'idx:0',
        lastText: 'stable answer',
        lastChangeAt: 100,
      },
      now: 2_000,
    });
    assert.equal(boundary.phase, 'reading-final-response');
    assert.equal(boundary.generationEndedAt, 2_000);

    const confirmed = evaluateCapture({
      snapshot,
      observation: { turns: [done], generating: false },
      state: {
        phase: 'reading-final-response',
        trackedIdentity: 'idx:0',
        lastText: 'stable answer',
        lastChangeAt: 100,
        startedAt: 0,
        sawGenerating: false,
        generationEndedAt: 2_000,
      },
      now: 2_100,
    });
    assert.equal(confirmed.phase, 'captured');
    assert.equal(confirmed.text, 'stable answer');
  });

  it('confirms the turn across the terminal boundary before capturing', () => {
    const old = turn('idx:0', 'old');
    const next = turn('idx:1', '{"version":1,"commands":[]}');
    const snapshot: CaptureSnapshot = {
      identities: [old.identity],
      assistantTurnCount: 1,
      lastAssistantText: 'old',
      lastIncomplete: false,
    };
    // First observation where the terminal signal appears: not captured yet.
    const first = evaluateCapture({
      snapshot,
      observation: { turns: [old, next], generating: false },
      state: {
        ...initialCaptureState(0),
        trackedIdentity: 'idx:1',
        sawGenerating: true,
        generationStartedAt: 100,
      },
      now: 200,
    });
    assert.equal(first.phase, 'reading-final-response');
    assert.equal(first.generationEndedAt, 200);

    // Confirming observation with the same text: captured.
    const second = evaluateCapture({
      snapshot,
      observation: { turns: [old, next], generating: false },
      state: {
        phase: 'reading-final-response',
        trackedIdentity: 'idx:1',
        lastText: next.finalText,
        lastChangeAt: 200,
        startedAt: 0,
        sawGenerating: true,
        generationStartedAt: 100,
        generationEndedAt: 200,
      },
      now: 300,
    });
    assert.equal(second.phase, 'captured');
    assert.equal(second.text, next.finalText);
    assert.equal(second.generationEndedAt, 200);
  });

  it('takes text that lands after the terminal signal and confirms it', () => {
    const old = turn('idx:0', 'old');
    const truncated = '{"version":1,"comm';
    const complete = '{"version":1,"commands":[{"type":"dispatch"}]}';
    const snapshot: CaptureSnapshot = {
      identities: [old.identity],
      assistantTurnCount: 1,
      lastAssistantText: 'old',
      lastIncomplete: false,
    };
    const turnsAt = (text: string): CaptureTurn[] => [old, turn('idx:1', text)];

    // Terminal observed while the DOM still shows truncated text.
    const terminal = evaluateCapture({
      snapshot,
      observation: { turns: turnsAt(truncated), generating: false },
      state: {
        ...initialCaptureState(0),
        trackedIdentity: 'idx:1',
        sawGenerating: true,
        generationStartedAt: 100,
      },
      now: 200,
    });
    assert.equal(terminal.phase, 'reading-final-response');
    assert.equal(terminal.lastText, truncated);

    // Final content commits after the terminal signal: not captured yet.
    const committed = evaluateCapture({
      snapshot,
      observation: { turns: turnsAt(complete), generating: false },
      state: {
        phase: 'reading-final-response',
        trackedIdentity: 'idx:1',
        lastText: truncated,
        lastChangeAt: 200,
        startedAt: 0,
        sawGenerating: true,
        generationStartedAt: 100,
        generationEndedAt: 200,
      },
      now: 300,
    });
    assert.equal(committed.phase, 'reading-final-response');
    assert.equal(committed.lastText, complete);

    // Confirming observation: captured with the final text.
    const captured = evaluateCapture({
      snapshot,
      observation: { turns: turnsAt(complete), generating: false },
      state: {
        phase: 'reading-final-response',
        trackedIdentity: 'idx:1',
        lastText: complete,
        lastChangeAt: 300,
        startedAt: 0,
        sawGenerating: true,
        generationStartedAt: 100,
        generationEndedAt: 200,
      },
      now: 400,
    });
    assert.equal(captured.phase, 'captured');
    assert.equal(captured.text, complete);
  });

  it('does not use stability timers for completion', async () => {
    const old = turn('idx:0', 'old');
    const next = turn('idx:1', 'done');
    const snapshot: CaptureSnapshot = {
      identities: [old.identity],
      assistantTurnCount: 1,
      lastAssistantText: 'old',
      lastIncomplete: false,
    };
    let generating = true;
    const text = await runCapture({
      snapshot,
      observe: () => ({
        turns: [old, next],
        generating,
      }),
      waitMs: async () => {
        generating = false;
      },
      now: (() => {
        let t = 0;
        return () => {
          t += 10;
          return t;
        };
      })(),
    });
    assert.equal(text, 'done');
  });

  it('captures the full response when the DOM commits after the terminal signal', async () => {
    const old = turn('idx:0', 'old');
    const snapshot: CaptureSnapshot = {
      identities: [old.identity],
      assistantTurnCount: 1,
      lastAssistantText: 'old',
      lastIncomplete: false,
    };
    const truncated = '{"version":1,"comm';
    const complete =
      '{"version":1,"commands":[{"type":"dispatch","body":"x"}]}';
    const observations: { text: string; generating: boolean }[] = [
      { text: truncated, generating: true },
      { text: truncated, generating: false },
      { text: complete, generating: false },
      { text: complete, generating: false },
    ];
    let index = 0;
    const text = await runCapture({
      snapshot,
      observe: () => {
        const item = observations[Math.min(index, observations.length - 1)]!;
        index += 1;
        return {
          turns: [old, turn('idx:1', item.text)],
          generating: item.generating,
        };
      },
      waitMs: async () => {},
    });
    assert.equal(text, complete);
  });

  it('times out as watchdog when no new turn appears', () => {
    const old = turn('idx:0', 'old');
    const snapshot: CaptureSnapshot = {
      identities: [old.identity],
      assistantTurnCount: 1,
      lastAssistantText: 'old',
      lastIncomplete: false,
    };
    const evaluation = evaluateCapture({
      snapshot,
      observation: { turns: [old], generating: false },
      state: initialCaptureState(0),
      now: 100_000,
      newTurnTimeoutMs: 90_000,
    });
    assert.equal(evaluation.phase, 'failed');
    assert.equal(evaluation.failure, 'new-turn-timeout');
  });
});
