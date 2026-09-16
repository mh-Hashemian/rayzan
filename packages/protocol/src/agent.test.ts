import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createAgent, withAgentRole } from './agent.js';
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

  it('withAgentRole keeps id and name', () => {
    const watcher = createAgent({
      id: 'deepseek',
      name: 'DeepSeek',
      role: 'watcher',
    });
    const coordinator = withAgentRole(watcher, 'coordinator');
    assert.equal(coordinator.id, watcher.id);
    assert.equal(coordinator.name, watcher.name);
    assert.equal(coordinator.role, 'coordinator');
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
