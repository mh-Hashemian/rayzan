import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { SqliteEventStore } from '@rayzan/storage';

import { RayzanRuntime } from '../src/runtime.js';

describe('RayzanRuntime crash recovery for external actions', () => {
  it('reopens SQLite after REQUESTED and classifies IN_DOUBT without resend', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rayzan-crash-'));
    const filePath = path.join(dir, 'rayzan.sqlite');
    try {
      const storeA = new SqliteEventStore(filePath);
      const runtimeA = new RayzanRuntime(storeA);
      runtimeA.registerAgent('DeepSeek Coordinator', 'coordinator');
      const qwen = runtimeA.registerAgent('Qwen', 'watcher');
      runtimeA.registerAgent('GLM', 'watcher');
      runtimeA.createRound1('Interrupted prompt dispatch');
      runtimeA.sendTestMessage(qwen.id, 'Do not resend this prompt.');
      const before = storeA.listAll();
      assert.equal(
        before.some((event) => event.type === 'PROMPT_DISPATCH_REQUESTED'),
        true,
      );
      const eventCount = before.length;
      storeA.close();

      const storeB = new SqliteEventStore(filePath);
      const runtimeB = new RayzanRuntime(storeB);
      const after = runtimeB.snapshot();
      assert.equal(storeB.listAll().length, eventCount);
      assert.equal(after.replay.unresolvedExternalActions >= 1, true);
      assert.equal(
        after.replay.externalActions.some(
          (action) =>
            action.action === 'prompt-dispatch' && action.state === 'IN_DOUBT',
        ),
        true,
      );
      assert.equal(runtimeB.nextPendingForAgent(qwen.id), undefined);
      assert.match(after.externalActionRecovery.join('\n'), /IN_DOUBT/);
      storeB.close();
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows can keep a short lock on the WAL file after close.
      }
    }
  });
});
