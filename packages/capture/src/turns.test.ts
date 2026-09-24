import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { selectTrackedTurn, type CaptureSnapshot, type CaptureTurn } from './index.js';

describe('@rayzan/capture turns', () => {
  it('selects only post-snapshot identities', () => {
    const old: CaptureTurn = {
      identity: 'idx:0',
      finalText: 'old',
      hasFinalAnswer: true,
      thinkingOnly: false,
    };
    const next: CaptureTurn = {
      identity: 'idx:1',
      finalText: 'new',
      hasFinalAnswer: true,
      thinkingOnly: false,
    };
    const snapshot: CaptureSnapshot = {
      identities: [old.identity],
      assistantTurnCount: 1,
      lastAssistantText: 'old',
      lastIncomplete: false,
    };
    assert.equal(selectTrackedTurn([old, next], snapshot)?.identity, 'idx:1');
    assert.equal(selectTrackedTurn([old], snapshot), undefined);
  });
});
