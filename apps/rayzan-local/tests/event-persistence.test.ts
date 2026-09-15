import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { SqliteEventStore } from '@rayzan/storage';

import { OPERATOR_ID } from '../src/demo-ids.js';
import { RayzanRuntime } from '../src/runtime.js';

describe('RayzanRuntime event persistence', () => {
  it('reopens the same database and reads the same events', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rayzan-runtime-events-'));
    const filePath = path.join(dir, 'rayzan.sqlite');
    try {
      const storeA = new SqliteEventStore(filePath);
      const runtimeA = new RayzanRuntime(storeA);
      runtimeA.registerAgent('DeepSeek Coordinator', 'coordinator');
      runtimeA.registerAgent('Qwen', 'watcher');
      runtimeA.registerAgent('GLM', 'watcher');
      runtimeA.createRound1('Does event history survive restart?');

      const before = storeA.listAll().map((event) => ({
        id: event.id,
        type: event.type,
        timestamp: event.timestamp.toISOString(),
        payload: event.payload,
        debateId: event.debateId,
        roundId: event.roundId,
        agentId: event.agentId,
      }));
      assert.ok(before.some((event) => event.type === 'DEBATE_CREATED'));
      assert.ok(before.some((event) => event.type === 'ROUND_CREATED'));
      storeA.close();

      const storeB = new SqliteEventStore(filePath);
      const runtimeB = new RayzanRuntime(storeB);
      const after = storeB.listAll();
      const originalIds = before.map((event) => event.id);
      const restored = after.filter((event) => originalIds.includes(event.id));

      assert.deepEqual(
        restored.map((event) => ({
          id: event.id,
          type: event.type,
          timestamp: event.timestamp.toISOString(),
          payload: event.payload,
          debateId: event.debateId,
          roundId: event.roundId,
          agentId: event.agentId,
        })),
        before,
      );
      assert.equal(
        after.filter(
          (event) =>
            event.type === 'AGENT_REGISTERED' && event.agentId === OPERATOR_ID,
        ).length,
        1,
      );

      const snap = runtimeB.snapshot();
      assert.equal(snap.restoredFromHistory, true);
      assert.equal(snap.debate?.topic, 'Does event history survive restart?');
      assert.equal(snap.replay.status, 'RESTORED');
      assert.match(snap.eventLog.join('\n'), /Persisted Debate Events/);
      assert.match(snap.eventLog.join('\n'), /DEBATE_CREATED/);
      assert.match(snap.eventLog.join('\n'), new RegExp(`id: ${before[0]!.id}`));
      assert.equal(after.length, before.length);
      storeB.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
