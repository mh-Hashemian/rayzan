import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDebate } from './debate.js';
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

  it('rejects an empty topic', () => {
    assert.throws(
      () => createDebate({ id: 'debate-1', topic: '   ' }),
      ProtocolError,
    );
  });
});
