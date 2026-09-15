import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validateCausalReference } from './causality.js';
import { createEvent, type Event } from './event.js';
import { EventError } from './error.js';

function event(
  id: string,
  extra: {
    type?: Event['type'];
    debateId?: string;
    causationEventId?: string;
    correlationId?: string;
    timestamp?: Date;
    payload?: unknown;
  } = {},
): Event {
  return createEvent({
    id,
    type: extra.type ?? 'MESSAGE_CREATED',
    timestamp: extra.timestamp ?? new Date('2026-09-15T18:01:00.000Z'),
    ...(extra.debateId !== undefined ? { debateId: extra.debateId } : {}),
    ...(extra.causationEventId !== undefined
      ? { causationEventId: extra.causationEventId }
      : {}),
    ...(extra.correlationId !== undefined
      ? { correlationId: extra.correlationId }
      : {}),
    payload: extra.payload,
  });
}

describe('causal references', () => {
  it('accepts an event with no causation', () => {
    validateCausalReference(event('e-1'), () => undefined);
  });

  it('requires the cause to exist as an earlier event', () => {
    const next = event('e-2', { causationEventId: 'missing' });
    assert.throws(
      () => validateCausalReference(next, () => undefined),
      EventError,
    );
  });

  it('rejects a cause from a different debate', () => {
    const cause = event('e-1', { debateId: 'debate-a' });
    const next = event('e-2', {
      debateId: 'debate-b',
      causationEventId: 'e-1',
    });
    assert.throws(
      () => validateCausalReference(next, (id) => (id === 'e-1' ? cause : undefined)),
      /different debate|belongs to debate/,
    );
  });

  it('rejects self-causation', () => {
    const next = event('e-1', { causationEventId: 'e-1' });
    assert.throws(() => validateCausalReference(next, () => next), EventError);
  });

  it('does not consult timestamps when accepting a cause', () => {
    const laterCause = event('e-1', {
      timestamp: new Date('2026-09-16T00:00:00.000Z'),
      debateId: 'debate-1',
    });
    const earlierClock = event('e-2', {
      timestamp: new Date('2026-09-14T00:00:00.000Z'),
      debateId: 'debate-1',
      causationEventId: 'e-1',
    });
    validateCausalReference(earlierClock, (id) =>
      id === 'e-1' ? laterCause : undefined,
    );
  });
});
