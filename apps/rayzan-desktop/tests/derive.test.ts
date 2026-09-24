import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { deriveDebateView } from '../src/components/debate/derive.js';
import type { RuntimeDebateState } from '../src/api.js';

function baseState(): RuntimeDebateState {
  return {
    sessionStarted: true,
    rounds: [],
    awaitingOperator: false,
    synthesisPending: false,
    agents: [
      {
        id: 'deepseek',
        name: 'DeepSeek',
        role: 'coordinator',
        provider: 'DeepSeek',
        round1Status: 'idle',
        round2Status: 'idle',
        roundStatuses: [],
        enabled: true,
      },
      {
        id: 'chatgpt',
        name: 'ChatGPT',
        role: 'watcher',
        provider: 'OpenAI',
        round1Status: 'idle',
        round2Status: 'idle',
        roundStatuses: [],
        enabled: true,
      },
    ],
  };
}

describe('debate view failure-state derivation', () => {
  it('shows Attention — never Thinking — for a failed delivery with idle generation', () => {
    const state = baseState();
    const coordinator = state.agents[0]!;
    state.agents[0] = {
      ...coordinator,
      phase: 'error',
      error: 'send failed: __filename is not defined',
    };

    const view = deriveDebateView(state, 'Test decision');
    const coordinatorCard = view.agents.find((agent) => agent.role === 'coordinator');
    assert.ok(coordinatorCard);
    assert.equal(coordinatorCard.status, 'Attention');
    assert.equal(coordinatorCard.summary, 'send failed: __filename is not defined');
  });

  it('shows Attention for a watcher error phase with a fallback summary', () => {
    const state = baseState();
    const watcher = state.agents[1]!;
    state.agents[1] = { ...watcher, phase: 'error' };

    const view = deriveDebateView(state, 'Test decision');
    const watcherCard = view.agents.find((agent) => agent.role === 'watcher');
    assert.ok(watcherCard);
    assert.equal(watcherCard.status, 'Attention');
    assert.match(watcherCard.summary, /Delivery failed/);
  });

  it('keeps Thinking for a genuinely generating agent', () => {
    const state = baseState();
    const coordinator = state.agents[0]!;
    state.agents[0] = { ...coordinator, phase: 'generating' };

    const view = deriveDebateView(state, 'Test decision');
    const coordinatorCard = view.agents.find((agent) => agent.role === 'coordinator');
    assert.ok(coordinatorCard);
    assert.equal(coordinatorCard.status, 'Thinking');
  });

  it('shows Attention for the attention phase as before', () => {
    const state = baseState();
    const watcher = state.agents[1]!;
    state.agents[1] = {
      ...watcher,
      phase: 'attention',
      error: 'generation-timeout — capture failed',
    };

    const view = deriveDebateView(state, 'Test decision');
    const watcherCard = view.agents.find((agent) => agent.role === 'watcher');
    assert.ok(watcherCard);
    assert.equal(watcherCard.status, 'Attention');
    assert.equal(watcherCard.summary, 'generation-timeout — capture failed');
  });
});
