import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createEvent, EventError } from '@rayzan/events';
import { asDebateId } from '@rayzan/protocol';

import { InMemoryEventStore } from './in-memory-event-store.js';

function sample(id: string, debateId = 'debate-1') {
  return createEvent({
    id,
    type: 'MESSAGE_CREATED',
    debateId,
    timestamp: new Date('2026-09-15T18:02:00.000Z'),
    payload: { messageId: id },
  });
}

describe('InMemoryEventStore', () => {
  it('appends and retrieves an event', () => {
    const store = new InMemoryEventStore();
    const event = sample('event-1');
    store.append(event);

    const found = store.getById('event-1');
    assert.equal(found?.id, event.id);
    assert.equal(found?.type, 'MESSAGE_CREATED');
    assert.deepEqual(found?.payload, { messageId: 'event-1' });
  });

  it('lists debate events in insertion order', () => {
    const store = new InMemoryEventStore();
    store.append(sample('event-a', 'debate-1'));
    store.append(sample('event-b', 'debate-2'));
    store.append(
      createEvent({
        id: 'event-c',
        type: 'RESPONSE_CAPTURED',
        debateId: 'debate-1',
        timestamp: new Date('2026-09-15T18:04:00.000Z'),
      }),
    );

    const debate1 = store.listByDebate(asDebateId('debate-1'));
    assert.deepEqual(
      debate1.map((event) => event.id),
      ['event-a', 'event-c'],
    );
    assert.deepEqual(
      store.listAll().map((event) => event.id),
      ['event-a', 'event-b', 'event-c'],
    );
  });

  it('rejects duplicate event IDs', () => {
    const store = new InMemoryEventStore();
    store.append(sample('event-1'));
    assert.throws(() => store.append(sample('event-1')), EventError);
  });

  it('returns copies, not internal references', () => {
    const store = new InMemoryEventStore();
    store.append(sample('event-1'));

    const listed = store.listAll();
    listed.pop();
    const first = store.getById('event-1');
    assert.ok(first);
    (first.payload as { messageId: string }).messageId = 'mutated';
    first.timestamp.setFullYear(1999);

    const again = store.getById('event-1');
    assert.equal(store.listAll().length, 1);
    assert.deepEqual(again?.payload, { messageId: 'event-1' });
    assert.equal(again?.timestamp.getUTCFullYear(), 2026);
  });
});
