import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createRound } from './round.js';
import { ProtocolError } from './validate.js';

describe('Round', () => {
  it('represents protocol state, not a provider conversation', () => {
    const round = createRound({
      id: 'round-1',
      debateId: 'debate-1',
      number: 1,
      status: 'collecting',
    });

    assert.equal(round.number, 1);
    assert.equal(round.status, 'collecting');
    assert.deepEqual(Object.keys(round).sort(), [
      'debateId',
      'id',
      'number',
      'status',
    ]);
    assert.equal('messages' in round, false);
    assert.equal('providerThreadId' in round, false);
  });

  it('rejects a non-positive round number', () => {
    assert.throws(
      () => createRound({ id: 'round-0', debateId: 'debate-1', number: 0 }),
      ProtocolError,
    );
  });
});
