import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createEvent } from './event.js';
import { EventError } from './error.js';
import { EVENT_TYPES } from './types.js';

describe('Event model', () => {
  it('creates a generic event without provider fields', () => {
    const timestamp = new Date('2026-09-15T18:01:00.000Z');
    const event = createEvent({
      id: 'event-1',
      type: 'DEBATE_CREATED',
      debateId: 'debate-1',
      timestamp,
      payload: { topic: 'Storage choice' },
    });

    assert.equal(event.id, 'event-1');
    assert.equal(event.type, 'DEBATE_CREATED');
    assert.equal(event.debateId, 'debate-1');
    assert.deepEqual(event.payload, { topic: 'Storage choice' });
    assert.equal(event.timestamp.toISOString(), timestamp.toISOString());
    assert.equal('provider' in event, false);
    assert.ok(EVENT_TYPES.includes(event.type));
  });

  it('rejects an empty id and an invalid type', () => {
    assert.throws(
      () =>
        createEvent({
          id: '   ',
          type: 'DEBATE_CREATED',
          timestamp: new Date(),
        }),
      EventError,
    );
    assert.throws(
      () =>
        createEvent({
          id: 'event-1',
          type: 'SENTIMENT_DETECTED' as never,
          timestamp: new Date(),
        }),
      EventError,
    );
    assert.throws(
      () =>
        createEvent({
          id: 'event-1',
          type: 'DEBATE_CREATED',
          timestamp: new Date('invalid'),
        }),
      EventError,
    );
  });
});
