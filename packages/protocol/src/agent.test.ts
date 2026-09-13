import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createAgent } from './agent.js';
import { ProtocolError } from './validate.js';

describe('Agent', () => {
  it('lets multiple Watchers share the watcher role with distinct identities', () => {
    const deepSeek = createAgent({
      id: 'watcher-deepseek',
      name: 'DeepSeek',
      role: 'watcher',
    });
    const qwen = createAgent({
      id: 'watcher-qwen',
      name: 'Qwen',
      role: 'watcher',
    });

    assert.equal(deepSeek.role, 'watcher');
    assert.equal(qwen.role, 'watcher');
    assert.notEqual(deepSeek.id, qwen.id);
    assert.notEqual(deepSeek.name, qwen.name);
    assert.deepEqual(Object.keys(deepSeek).sort(), ['id', 'name', 'role']);
  });

  it('rejects empty ids and names', () => {
    assert.throws(
      () => createAgent({ id: '  ', name: 'DeepSeek', role: 'watcher' }),
      ProtocolError,
    );
    assert.throws(
      () => createAgent({ id: 'watcher-1', name: '', role: 'watcher' }),
      ProtocolError,
    );
  });
});
