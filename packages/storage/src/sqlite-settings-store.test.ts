import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { createEvent } from '@rayzan/events';

import { SqliteEventStore } from './sqlite-event-store.js';
import { InMemorySettingsStore } from './settings-store.js';
import { SqliteSettingsStore } from './sqlite-settings-store.js';

function withTempStore(
  run: (store: SqliteSettingsStore, filePath: string) => void,
): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'rayzan-settings-'));
  const filePath = path.join(dir, 'settings.sqlite');
  const store = new SqliteSettingsStore(filePath);
  try {
    run(store, filePath);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('SqliteSettingsStore', () => {
  it('stores, replaces and removes a value', () => {
    withTempStore((store) => {
      assert.equal(store.get('coordinator.profile'), undefined);
      store.set('coordinator.profile', 'one');
      assert.equal(store.get('coordinator.profile'), 'one');
      store.set('coordinator.profile', 'two');
      assert.equal(store.get('coordinator.profile'), 'two');
      store.remove('coordinator.profile');
      assert.equal(store.get('coordinator.profile'), undefined);
    });
  });

  it('keeps values across a reopen of the same file', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rayzan-settings-'));
    const filePath = path.join(dir, 'settings.sqlite');
    const first = new SqliteSettingsStore(filePath);
    first.set('coordinator.profile', '# Role\nbe critical\n');
    first.close();
    const second = new SqliteSettingsStore(filePath);
    try {
      assert.equal(second.get('coordinator.profile'), '# Role\nbe critical\n');
    } finally {
      second.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('coexists with the event store on one database file', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rayzan-settings-'));
    const filePath = path.join(dir, 'rayzan.sqlite');
    const events = new SqliteEventStore(filePath);
    const settings = new SqliteSettingsStore(filePath);
    try {
      events.append(
        createEvent({
          id: 'event-1',
          type: 'DEBATE_CREATED',
          debateId: 'debate-1',
          timestamp: new Date('2026-09-26T10:00:00.000Z'),
          payload: { topic: 'ship or not', status: 'active' },
        }),
      );
      settings.set('coordinator.profile', 'be critical');
      assert.equal(settings.get('coordinator.profile'), 'be critical');
      assert.equal(events.listAll().length, 1);
    } finally {
      settings.close();
      events.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('InMemorySettingsStore', () => {
  it('mirrors the SQLite store contract', () => {
    const store = new InMemorySettingsStore();
    store.set('a', '1');
    assert.equal(store.get('a'), '1');
    store.remove('a');
    assert.equal(store.get('a'), undefined);
  });
});
