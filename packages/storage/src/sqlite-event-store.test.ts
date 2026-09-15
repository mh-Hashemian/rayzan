import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { createEvent, EventError } from '@rayzan/events';
import { asDebateId } from '@rayzan/protocol';

import { SqliteEventStore } from './sqlite-event-store.js';

function sample(
  id: string,
  debateId = 'debate-1',
  timestamp = new Date('2026-09-15T20:01:00.000Z'),
) {
  return createEvent({
    id,
    type: 'MESSAGE_CREATED',
    debateId,
    timestamp,
    payload: { messageId: id, nested: { ok: true } },
  });
}

function withTempStore(
  run: (store: SqliteEventStore, filePath: string) => void,
): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'rayzan-events-'));
  const filePath = path.join(dir, 'events.sqlite');
  const store = new SqliteEventStore(filePath);
  try {
    run(store, filePath);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('SqliteEventStore', () => {
  it('appends and retrieves an event', () => {
    withTempStore((store) => {
      const event = sample('event-1');
      store.append(event);

      const found = store.getById('event-1');
      assert.equal(found?.id, event.id);
      assert.equal(found?.type, 'MESSAGE_CREATED');
      assert.deepEqual(found?.payload, {
        messageId: 'event-1',
        nested: { ok: true },
      });
    });
  });

  it('rejects duplicate event IDs', () => {
    withTempStore((store) => {
      store.append(sample('event-1'));
      assert.throws(() => store.append(sample('event-1')), EventError);
    });
  });

  it('listAll preserves insertion sequence', () => {
    withTempStore((store) => {
      store.append(sample('event-a'));
      store.append(sample('event-b', 'debate-2'));
      store.append(sample('event-c'));
      assert.deepEqual(
        store.listAll().map((event) => event.id),
        ['event-a', 'event-b', 'event-c'],
      );
    });
  });

  it('listByDebate filters correctly and keeps sequence order', () => {
    withTempStore((store) => {
      store.append(sample('event-a', 'debate-1'));
      store.append(sample('event-b', 'debate-2'));
      store.append(
        createEvent({
          id: 'event-c',
          type: 'RESPONSE_CAPTURED',
          debateId: 'debate-1',
          timestamp: new Date('2026-09-15T20:04:00.000Z'),
        }),
      );

      const debate1 = store.listByDebate(asDebateId('debate-1'));
      assert.deepEqual(
        debate1.map((event) => event.id),
        ['event-a', 'event-c'],
      );
    });
  });

  it('round-trips payload JSON', () => {
    withTempStore((store) => {
      const payload = {
        senderId: 'coordinator',
        recipientIds: ['qwen', 'glm'],
        flags: { isolated: true },
      };
      store.append(
        createEvent({
          id: 'payload-1',
          type: 'MESSAGE_DISPATCHED',
          timestamp: new Date('2026-09-15T20:05:00.000Z'),
          payload,
        }),
      );
      assert.deepEqual(store.getById('payload-1')?.payload, payload);
    });
  });

  it('round-trips the original timestamp', () => {
    withTempStore((store) => {
      const timestamp = new Date('2026-09-15T17:02:03.456Z');
      store.append(sample('ts-1', 'debate-1', timestamp));
      const found = store.getById('ts-1');
      assert.equal(found?.timestamp.toISOString(), timestamp.toISOString());
      assert.equal(found?.timestamp.getTime(), timestamp.getTime());
    });
  });

  it('keeps events after close and reopen', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rayzan-events-'));
    const filePath = path.join(dir, 'events.sqlite');
    try {
      const first = new SqliteEventStore(filePath);
      first.append(sample('event-a'));
      first.append(sample('event-b', 'debate-2'));
      const before = first.listAll().map((event) => ({
        id: event.id,
        type: event.type,
        timestamp: event.timestamp.toISOString(),
        payload: event.payload,
        debateId: event.debateId,
      }));
      first.close();

      const second = new SqliteEventStore(filePath);
      const after = second.listAll();
      assert.deepEqual(
        after.map((event) => ({
          id: event.id,
          type: event.type,
          timestamp: event.timestamp.toISOString(),
          payload: event.payload,
          debateId: event.debateId,
        })),
        before,
      );
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('orders events with identical timestamps by sequence', () => {
    withTempStore((store) => {
      const timestamp = new Date('2026-09-15T20:01:00.000Z');
      store.append(sample('same-ts-a', 'debate-1', timestamp));
      store.append(sample('same-ts-b', 'debate-1', timestamp));
      store.append(sample('same-ts-c', 'debate-1', timestamp));
      assert.deepEqual(
        store.listAll().map((event) => event.id),
        ['same-ts-a', 'same-ts-b', 'same-ts-c'],
      );
      assert.deepEqual(
        store.listByDebate(asDebateId('debate-1')).map((event) => event.id),
        ['same-ts-a', 'same-ts-b', 'same-ts-c'],
      );
    });
  });
});
