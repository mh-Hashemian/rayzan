import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createAgent } from '../agent.js';
import { ProtocolError } from '../validate.js';
import { InMemoryAgentRegistry } from './agent-registry.js';

describe('InMemoryAgentRegistry', () => {
  it('registers and retrieves an Agent by ID', () => {
    const registry = new InMemoryAgentRegistry();
    const qwen = createAgent({
      id: 'watcher-qwen',
      name: 'Qwen',
      role: 'watcher',
    });

    registry.register(qwen);

    assert.equal(registry.getById(qwen.id), qwen);
    assert.deepEqual(registry.listByRole('watcher'), [qwen]);
  });

  it('rejects a duplicate Agent ID', () => {
    const registry = new InMemoryAgentRegistry();
    const agent = createAgent({
      id: 'watcher-qwen',
      name: 'Qwen',
      role: 'watcher',
    });

    registry.register(agent);

    assert.throws(
      () =>
        registry.register(
          createAgent({
            id: 'watcher-qwen',
            name: 'Qwen Duplicate',
            role: 'watcher',
          }),
        ),
      ProtocolError,
    );
  });
});
