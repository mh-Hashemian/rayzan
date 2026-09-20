import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { ConversationStore } from '../electron/managed-provider/conversation-store.js';
import { providerIdFromAgent } from '../electron/managed-provider/types.js';

describe('managed provider conversation ownership', () => {
  it('maps agent names to managed providers', () => {
    assert.equal(
      providerIdFromAgent({ id: 'deepseek', name: 'DeepSeek', provider: 'DeepSeek' }),
      'deepseek',
    );
    assert.equal(
      providerIdFromAgent({ id: 'chatgpt', name: 'ChatGPT', provider: 'OpenAI' }),
      'chatgpt',
    );
    assert.equal(
      providerIdFromAgent({ id: 'qwen', name: 'Qwen', provider: 'Alibaba Cloud' }),
      'qwen',
    );
    assert.equal(
      providerIdFromAgent({ id: 'glm', name: 'GLM', provider: 'Zhipu AI' }),
      'glm',
    );
    assert.equal(
      providerIdFromAgent({ id: 'grok', name: 'Grok', provider: 'xAI' }),
      undefined,
    );
  });

  it('persists fresh ownership per debate and does not share across debates', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rayzan-managed-'));
    try {
      const store = new ConversationStore(dir);
      const first = store.upsert({
        debateId: 'debate-1',
        agentId: 'chatgpt',
        providerId: 'chatgpt',
        conversation: {
          id: 'conv-a',
          providerId: 'chatgpt',
          url: 'https://chatgpt.com/c/a',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      });
      const second = store.upsert({
        debateId: 'debate-2',
        agentId: 'chatgpt',
        providerId: 'chatgpt',
        conversation: {
          id: 'conv-b',
          providerId: 'chatgpt',
          url: 'https://chatgpt.com/c/b',
          createdAt: '2026-01-02T00:00:00.000Z',
        },
      });
      assert.notEqual(first.conversation.id, second.conversation.id);
      assert.equal(store.forDebate('debate-1').length, 1);
      assert.equal(store.forDebate('debate-2')[0]?.conversation.id, 'conv-b');

      const reloaded = new ConversationStore(dir);
      assert.equal(
        reloaded.forAgentDebate('debate-1', 'chatgpt')?.conversation.id,
        'conv-a',
      );
      assert.equal(
        reloaded.forAgentDebate('debate-2', 'chatgpt')?.conversation.id,
        'conv-b',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps separate conversations for different agents in the same debate', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rayzan-managed-agents-'));
    try {
      const store = new ConversationStore(dir);
      store.upsert({
        debateId: 'debate-9',
        agentId: 'deepseek',
        providerId: 'deepseek',
        conversation: {
          id: 'conv-ds',
          providerId: 'deepseek',
          url: 'https://chat.deepseek.com/a',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      });
      store.upsert({
        debateId: 'debate-9',
        agentId: 'chatgpt',
        providerId: 'chatgpt',
        conversation: {
          id: 'conv-cg',
          providerId: 'chatgpt',
          url: 'https://chatgpt.com/c/x',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      });
      const rows = store.forDebate('debate-9');
      assert.equal(rows.length, 2);
      assert.notEqual(rows[0]?.conversation.id, rows[1]?.conversation.id);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
