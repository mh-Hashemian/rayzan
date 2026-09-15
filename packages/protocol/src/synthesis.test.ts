import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ProtocolError } from './validate.js';
import { createDebateSynthesis } from './synthesis.js';
import { InMemorySynthesisStore } from './stores/synthesis-store.js';

describe('DebateSynthesis', () => {
  it('stores a report without embedding the message history', () => {
    const synthesis = createDebateSynthesis({
      debateId: 'debate-1',
      coordinatorId: 'coordinator-1',
      body: 'Final recommendation: use SQLite.',
      createdAt: '2026-09-15T12:00:00.000Z',
    });

    assert.deepEqual(Object.keys(synthesis).sort(), [
      'body',
      'coordinatorId',
      'createdAt',
      'debateId',
    ]);
    assert.equal('messages' in synthesis, false);

    const store = new InMemorySynthesisStore();
    store.store(synthesis);
    assert.equal(store.getByDebateId(synthesis.debateId), synthesis);
    assert.throws(() => store.store(synthesis), ProtocolError);
  });

  it('rejects an empty body', () => {
    assert.throws(
      () =>
        createDebateSynthesis({
          debateId: 'debate-1',
          coordinatorId: 'coordinator-1',
          body: '   ',
          createdAt: '2026-09-15T12:00:00.000Z',
        }),
      ProtocolError,
    );
  });
});
