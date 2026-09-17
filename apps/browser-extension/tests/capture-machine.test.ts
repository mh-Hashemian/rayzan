import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseHTML } from 'linkedom';

import {
  CaptureJobRegistry,
  evaluateCapture,
  initialCaptureState,
  runCapture,
  selectTrackedTurn,
  resolveTrackedTurn,
  type AssistantTurn,
  type CaptureSnapshot,
} from '../src/capture/index.js';

function turnFrom(
  html: string,
  options: {
    identity: string;
    thinkingOnly?: boolean;
    hasFinalAnswer?: boolean;
    finalText?: string;
  },
): AssistantTurn {
  const document = parseHTML(`<html><body>${html}</body></html>`).document;
  const element = document.querySelector('div');
  assert.ok(element);
  const text = options.finalText ?? element.textContent?.trim() ?? '';
  return {
    element,
    identity: options.identity,
    thinkingOnly: options.thinkingOnly ?? false,
    hasFinalAnswer: options.hasFinalAnswer ?? text.length > 0,
    finalText: options.hasFinalAnswer === false ? '' : text,
  };
}

describe('capture state machine', () => {
  it('ignores an old assistant turn that already existed', () => {
    const old = turnFrom('<div>old</div>', { identity: 'idx:0' });
    const snapshot: CaptureSnapshot = {
      identities: [old.identity],
      assistantTurnCount: 1,
      lastAssistantText: 'old',
      lastIncomplete: false,
      elements: new Set([old.element]),
    };
    const selected = selectTrackedTurn([old], snapshot);
    assert.equal(selected, undefined);
    const state = initialCaptureState(0);
    const evaluation = evaluateCapture({
      snapshot,
      observation: {
        turns: [old],
        generating: false,
      },
      state,
      now: 1000,
    });
    assert.equal(evaluation.phase, 'waiting-for-new-turn');
  });

  it('stays generating when the stop control is visible before a new turn exists', () => {
    const old = turnFrom('<div>old</div>', { identity: 'idx:0' });
    const snapshot: CaptureSnapshot = {
      identities: [old.identity],
      assistantTurnCount: 1,
      lastAssistantText: 'old',
      lastIncomplete: false,
      elements: new Set([old.element]),
    };
    const evaluation = evaluateCapture({
      snapshot,
      observation: {
        turns: [old],
        generating: true,
      },
      state: initialCaptureState(0),
      now: 1000,
    });
    assert.equal(evaluation.phase, 'generating');
  });

  it('selects a new assistant turn after the snapshot', () => {
    const old = turnFrom('<div>old</div>', { identity: 'idx:0' });
    const next = turnFrom('<div>new</div>', { identity: 'idx:1' });
    const snapshot: CaptureSnapshot = {
      identities: [old.identity],
      assistantTurnCount: 1,
      lastAssistantText: 'old',
      lastIncomplete: false,
      elements: new Set([old.element]),
    };
    const selected = selectTrackedTurn([old, next], snapshot);
    assert.equal(selected?.identity, 'idx:1');
    assert.equal(selected?.finalText, 'new');
  });

  it('selects a new identity even when older turns have been virtualized away', () => {
    const visibleNew = turnFrom('<div>latest</div>', {
      identity: 'data-message-id:new',
    });
    const snapshot: CaptureSnapshot = {
      identities: ['data-message-id:old-a', 'data-message-id:old-b'],
      assistantTurnCount: 2,
      lastAssistantText: 'old-b',
      lastIncomplete: false,
    };
    const selected = selectTrackedTurn([visibleNew], snapshot);
    assert.equal(selected?.identity, 'data-message-id:new');
  });

  it('follows a tracked turn when its identity upgrades from idx to a stable id', () => {
    const old = turnFrom('<div>old</div>', { identity: 'data-message-id:old' });
    const streaming = turnFrom('<div>partial</div>', { identity: 'idx:1' });
    const stable = turnFrom('<div>partial</div>', {
      identity: 'data-message-id:new',
    });
    const snapshot: CaptureSnapshot = {
      identities: [old.identity],
      assistantTurnCount: 1,
      lastAssistantText: 'old',
      lastIncomplete: false,
      elements: new Set([old.element]),
    };
    assert.equal(
      resolveTrackedTurn([old, stable], snapshot, streaming.identity)
        ?.identity,
      'data-message-id:new',
    );
  });

  it('does not submit a thinking-only turn', () => {
    const thinking = turnFrom('<div>scratch</div>', {
      identity: 'idx:0',
      thinkingOnly: true,
      hasFinalAnswer: false,
      finalText: '',
    });
    const snapshot: CaptureSnapshot = {
      identities: [],
      assistantTurnCount: 0,
      lastIncomplete: false,
      elements: new Set(),
    };
    const evaluation = evaluateCapture({
      snapshot,
      observation: { turns: [thinking], generating: false },
      state: initialCaptureState(0),
      now: 500,
    });
    assert.equal(evaluation.phase, 'generating');
    assert.equal(evaluation.text, undefined);
  });

  it('waits while streaming text is still changing', () => {
    const streaming = turnFrom('<div>partial</div>', {
      identity: 'idx:0',
      finalText: 'partial',
    });
    const snapshot: CaptureSnapshot = {
      identities: [],
      assistantTurnCount: 0,
      lastIncomplete: false,
      elements: new Set(),
    };
    const evaluation = evaluateCapture({
      snapshot,
      observation: { turns: [streaming], generating: true },
      state: {
        ...initialCaptureState(0),
        trackedIdentity: 'idx:0',
        lastText: 'par',
        lastChangeAt: 0,
      },
      now: 400,
    });
    assert.equal(evaluation.phase, 'generating');
  });

  it('waits through a final mutation after generation ends', () => {
    const almost = turnFrom('<div>final!</div>', {
      identity: 'idx:0',
      finalText: 'final!',
    });
    const snapshot: CaptureSnapshot = {
      identities: [],
      assistantTurnCount: 0,
      lastIncomplete: false,
      elements: new Set(),
    };
    const evaluation = evaluateCapture({
      snapshot,
      observation: { turns: [almost], generating: false },
      state: {
        ...initialCaptureState(0),
        trackedIdentity: 'idx:0',
        lastText: 'final',
        lastChangeAt: 0,
      },
      now: 500,
      stabilityWindowMs: 2000,
    });
    assert.equal(evaluation.phase, 'stabilizing');
  });

  it('submits exactly once after final text is stable', async () => {
    const old = turnFrom('<div>old</div>', { identity: 'idx:0' });
    const next = turnFrom('<div>stable answer</div>', { identity: 'idx:1' });
    const snapshot: CaptureSnapshot = {
      identities: [old.identity],
      assistantTurnCount: 1,
      lastAssistantText: 'old',
      lastIncomplete: false,
      elements: new Set([old.element]),
    };
    let now = 0;
    const text = await runCapture({
      snapshot,
      observe: () => ({
        turns: [old, next],
        generating: false,
      }),
      now: () => now,
      waitMs: async (ms) => {
        now += ms;
      },
      stabilityWindowMs: 200,
      newTurnTimeoutMs: 5000,
      generationTimeoutMs: 5000,
    });
    assert.equal(text, 'stable answer');
  });

  it('does not create a second active job for the same delivery', () => {
    const registry = new CaptureJobRegistry();
    const job = {
      deliveryId: 'D17',
      agentId: 'qwen',
      provider: 'Qwen',
      phase: 'generating' as const,
      startedAt: 1,
      report: {
        deliveryId: 'D17',
        agentId: 'qwen',
        provider: 'Qwen',
        phase: 'generating' as const,
        promptSubmitted: true,
        preSendTurnCount: 1,
      },
    };
    assert.equal(registry.begin(job), true);
    assert.equal(registry.isActive('D17'), true);
    assert.equal(registry.begin({ ...job, startedAt: 2 }), false);
  });

  it('stays generating when a tracked idx identity remounts while the stop control is visible', () => {
    const remountedOld = turnFrom('<div>old history</div>', {
      identity: 'idx:0',
    });
    const snapshot: CaptureSnapshot = {
      identities: ['idx:0'],
      assistantTurnCount: 1,
      lastAssistantText: 'old history',
      lastIncomplete: false,
    };
    const evaluation = evaluateCapture({
      snapshot,
      observation: { turns: [remountedOld], generating: true },
      state: {
        ...initialCaptureState(0),
        trackedIdentity: 'idx:1',
        lastText: '',
      },
      now: 1000,
    });
    assert.equal(evaluation.phase, 'generating');
    assert.equal(evaluation.failure, undefined);
  });

  it('follows a remounted last turn whose text is new after the tracked identity disappears', () => {
    const remounted = turnFrom('<div>fresh coordinator brief</div>', {
      identity: 'idx:0',
      finalText: 'fresh coordinator brief',
    });
    const snapshot: CaptureSnapshot = {
      identities: ['idx:0'],
      assistantTurnCount: 1,
      lastAssistantText: 'old history',
      lastIncomplete: false,
    };
    const evaluation = evaluateCapture({
      snapshot,
      observation: { turns: [remounted], generating: false },
      state: {
        ...initialCaptureState(0),
        trackedIdentity: 'idx:1',
        lastText: 'fresh coordinator brief',
        lastChangeAt: 0,
      },
      now: 2500,
      stabilityWindowMs: 2000,
    });
    assert.equal(evaluation.phase, 'captured');
    assert.equal(evaluation.text, 'fresh coordinator brief');
  });

  it('fails with tracked-turn-disappeared when the identity is gone and nothing new is generating', () => {
    const old = turnFrom('<div>old history</div>', { identity: 'idx:0' });
    const snapshot: CaptureSnapshot = {
      identities: [old.identity],
      assistantTurnCount: 1,
      lastAssistantText: 'old history',
      lastIncomplete: false,
      elements: new Set([old.element]),
    };
    const evaluation = evaluateCapture({
      snapshot,
      observation: { turns: [old], generating: false },
      state: {
        ...initialCaptureState(0),
        trackedIdentity: 'idx:1',
        lastText: 'partial',
      },
      now: 1000,
    });
    assert.equal(evaluation.phase, 'failed');
    assert.equal(evaluation.failure, 'tracked-turn-disappeared');
  });

  it('fails with new-turn-timeout instead of stealing the last old message', () => {
    const old = turnFrom('<div>old history</div>', { identity: 'idx:0' });
    const snapshot: CaptureSnapshot = {
      identities: [old.identity],
      assistantTurnCount: 1,
      lastAssistantText: 'old history',
      lastIncomplete: false,
      elements: new Set([old.element]),
    };
    const evaluation = evaluateCapture({
      snapshot,
      observation: { turns: [old], generating: false },
      state: initialCaptureState(0),
      now: 91_000,
      newTurnTimeoutMs: 90_000,
    });
    assert.equal(evaluation.phase, 'failed');
    assert.equal(evaluation.failure, 'new-turn-timeout');
  });

  it('holds capture while assistant text looks like incomplete JSON', () => {
    const partial = turnFrom('<div>{</div>', {
      identity: 'idx:1',
      finalText: '{',
    });
    const snapshot: CaptureSnapshot = {
      identities: [],
      assistantTurnCount: 0,
      lastIncomplete: false,
    };
    const early = evaluateCapture({
      snapshot,
      observation: { turns: [partial], generating: false },
      state: {
        ...initialCaptureState(0),
        trackedIdentity: 'idx:1',
        lastText: '{',
        lastChangeAt: 0,
      },
      now: 5_000,
      stabilityWindowMs: 2_000,
    });
    assert.equal(early.phase, 'generating');
    assert.equal(early.failure, undefined);

    const completeText =
      '{"version":1,"commands":[{"type":"dispatch","messageId":"x","debateId":"d","recipients":{"type":"round-watchers"},"kind":"brief","body":"hi","referencedMessageIds":[]}]}';
    const complete = turnFrom('<div>done</div>', {
      identity: 'idx:1',
      finalText: completeText,
    });
    const done = evaluateCapture({
      snapshot,
      observation: { turns: [complete], generating: false },
      state: {
        ...initialCaptureState(0),
        trackedIdentity: 'idx:1',
        lastText: completeText,
        lastChangeAt: 0,
      },
      now: 5_000,
      stabilityWindowMs: 2_000,
    });
    assert.equal(done.phase, 'captured');
    assert.equal(done.text, completeText);
  });
});
