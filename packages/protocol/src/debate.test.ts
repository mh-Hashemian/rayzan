import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDebate, withDebateStatus } from './debate.js';
import { ProtocolError } from './validate.js';

describe('Debate', () => {
  it('tracks identity and status without embedding message history', () => {
    const debate = createDebate({
      id: 'debate-1',
      topic: 'Transport fallback policy',
    });

    assert.equal(debate.status, 'pending');
    assert.deepEqual(Object.keys(debate).sort(), ['id', 'status', 'topic']);
    assert.equal('messages' in debate, false);
    assert.equal('history' in debate, false);
  });

  it('accepts archived as a retained historical status', () => {
    const debate = createDebate({
      id: 'debate-1',
      topic: 'Transport fallback policy',
      status: 'archived',
      createdAt: '2026-09-15T18:00:00.000Z',
    });
    assert.equal(debate.status, 'archived');
    assert.equal(debate.createdAt, '2026-09-15T18:00:00.000Z');
  });

  it('keeps identity when moving an open debate to archived', () => {
    const open = createDebate({
      id: 'debate-1',
      topic: 'Transport fallback policy',
      status: 'active',
      createdAt: '2026-09-15T18:00:00.000Z',
    });
    const archived = withDebateStatus(open, 'archived');
    assert.equal(archived.id, open.id);
    assert.equal(archived.topic, open.topic);
    assert.equal(archived.status, 'archived');
    assert.equal(archived.createdAt, open.createdAt);
  });

  it('rejects an empty topic', () => {
    assert.throws(
      () => createDebate({ id: 'debate-1', topic: '   ' }),
      ProtocolError,
    );
  });
});
