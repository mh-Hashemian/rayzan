import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { AgentConnection, AgentView } from '../src/api.js';
import { DecisionReview } from '../src/components/decision/DecisionReview.js';
import {
  DISCONNECTED_MESSAGE,
  NO_COORDINATOR_MESSAGE,
  NO_WATCHER_MESSAGE,
  deriveTeamDraft,
  draftedCoordinator,
  draftedWatchers,
  selectCoordinator,
  syncTeamDraft,
  teamCandidates,
  toggleWatcher,
  validateTeamDraft,
} from '../src/components/decision/team.js';
import type { DecisionDraft } from '../src/components/decision/types.js';

const DECISION: DecisionDraft = {
  question: 'Should we ship the installer this week?',
  context: 'Tester handoff is ready.',
  goal: 'Compare options',
};

function agent(input: {
  id: string;
  name: string;
  role: string;
  provider: string;
  connection?: AgentConnection;
  enabled?: boolean;
}): AgentView {
  return {
    id: input.id,
    name: input.name,
    role: input.role,
    provider: input.provider,
    connection: input.connection ?? 'connected',
    enabled: input.enabled ?? true,
  };
}

/** The desktop's seeded team: DeepSeek leads, three Watchers available. */
const TEAM: readonly AgentView[] = [
  agent({ id: 'deepseek', name: 'DeepSeek', role: 'coordinator', provider: 'DeepSeek' }),
  agent({ id: 'chatgpt', name: 'ChatGPT', role: 'watcher', provider: 'OpenAI' }),
  agent({
    id: 'qwen',
    name: 'Qwen',
    role: 'watcher',
    provider: 'Alibaba Cloud',
    connection: 'disconnected',
    enabled: false,
  }),
  agent({ id: 'glm', name: 'GLM', role: 'watcher', provider: 'Zhipu AI', enabled: false }),
  agent({ id: 'grok', name: 'Grok', role: 'watcher', provider: 'xAI' }),
];

/** Same team after a previous decision promoted ChatGPT to Coordinator. */
const CHATGPT_LEAD: readonly AgentView[] = TEAM.map((member) => {
  if (member.id === 'chatgpt') {
    return { ...member, role: 'coordinator' };
  }
  if (member.id === 'deepseek') {
    return { ...member, role: 'watcher', enabled: false };
  }
  return member;
});

function withConnection(
  team: readonly AgentView[],
  id: string,
  connection: AgentConnection,
): readonly AgentView[] {
  return team.map((member) =>
    member.id === id ? { ...member, connection } : member,
  );
}

function message(team: readonly AgentView[], draft: ReturnType<typeof deriveTeamDraft>): string {
  const readiness = validateTeamDraft(draft, team);
  return readiness.canStart ? '' : readiness.message;
}

function noop(): void {}

describe('New Decision team draft', () => {
  it('preselects the Coordinator and included Watchers the runtime already has', () => {
    const draft = deriveTeamDraft(TEAM);
    assert.equal(draft.coordinatorId, 'deepseek');
    assert.deepEqual(draft.watcherIds, ['chatgpt', 'grok']);
    assert.equal(validateTeamDraft(draft, TEAM).canStart, true);
  });

  it('changes the Coordinator from ChatGPT to DeepSeek for the Review step', () => {
    const seeded = deriveTeamDraft(CHATGPT_LEAD);
    assert.equal(seeded.coordinatorId, 'chatgpt');

    const draft = selectCoordinator(seeded, 'deepseek');
    assert.equal(draftedCoordinator(draft, CHATGPT_LEAD)?.name, 'DeepSeek');
    assert.deepEqual(
      draftedWatchers(draft, CHATGPT_LEAD).map((member) => member.name),
      ['Grok'],
    );
    assert.equal(validateTeamDraft(draft, CHATGPT_LEAD).canStart, true);
  });

  it('removes a Watcher from the selection when it is promoted to Coordinator', () => {
    const seeded = deriveTeamDraft(TEAM);
    assert.ok(seeded.watcherIds.includes('chatgpt'));

    const draft = selectCoordinator(seeded, 'chatgpt');
    assert.equal(draft.coordinatorId, 'chatgpt');
    assert.ok(!draft.watcherIds.includes('chatgpt'));
    assert.deepEqual(
      draftedWatchers(draft, TEAM).map((member) => member.id),
      ['grok'],
    );
  });

  it('keeps the demoted Coordinator available as a Watcher but unselected', () => {
    const seeded = deriveTeamDraft(CHATGPT_LEAD);
    const draft = selectCoordinator(seeded, 'deepseek');
    const watcherCandidates = teamCandidates(CHATGPT_LEAD).filter(
      (member) => member.id !== draft.coordinatorId,
    );
    assert.ok(watcherCandidates.some((member) => member.id === 'chatgpt'));
    assert.ok(!draft.watcherIds.includes('chatgpt'));

    const withOldLead = toggleWatcher(draft, 'chatgpt', true);
    assert.deepEqual(
      draftedWatchers(withOldLead, CHATGPT_LEAD).map((member) => member.id),
      ['grok', 'chatgpt'],
    );
  });

  it('never lets the Coordinator also be a selected Watcher', () => {
    const draft = deriveTeamDraft(TEAM);
    assert.deepEqual(toggleWatcher(draft, 'deepseek', true), draft);
    assert.ok(!selectCoordinator(draft, 'grok').watcherIds.includes('grok'));
  });

  it('leaves globally enabled but offline Watchers out of the seeded draft', () => {
    const offlineWatcher = withConnection(TEAM, 'grok', 'disconnected');
    const draft = deriveTeamDraft(offlineWatcher);
    assert.deepEqual(draft.watcherIds, ['chatgpt']);
    assert.equal(validateTeamDraft(draft, offlineWatcher).canStart, true);
  });

  it('blocks Start with no Watcher selected', () => {
    const draft = selectCoordinator(deriveTeamDraft(TEAM), 'deepseek');
    const solo = { coordinatorId: draft.coordinatorId, watcherIds: [] };
    assert.equal(message(TEAM, solo), NO_WATCHER_MESSAGE);
    assert.equal(
      NO_WATCHER_MESSAGE,
      'Choose at least one connected Watcher to continue.',
    );
  });

  it('allows Start with exactly one connected Watcher', () => {
    const draft = {
      coordinatorId: 'deepseek',
      watcherIds: ['chatgpt'],
    };
    assert.equal(validateTeamDraft(draft, TEAM).canStart, true);
  });

  it('blocks Start when no Coordinator is selected', () => {
    const draft = { coordinatorId: '', watcherIds: ['chatgpt'] };
    assert.equal(message(TEAM, draft), NO_COORDINATOR_MESSAGE);
    assert.equal(
      NO_COORDINATOR_MESSAGE,
      'Choose a connected Coordinator to continue.',
    );
  });

  it('blocks Start when the selected Coordinator disconnects', () => {
    const draft = deriveTeamDraft(TEAM);
    const offline = withConnection(TEAM, 'deepseek', 'disconnected');
    assert.equal(message(offline, draft), DISCONNECTED_MESSAGE);
    assert.equal(
      DISCONNECTED_MESSAGE,
      'Connect the selected Coordinator and Watchers before starting.',
    );
  });

  it('blocks Start when the only selected Watcher disconnects', () => {
    const draft = { coordinatorId: 'deepseek', watcherIds: ['chatgpt'] };
    const offline = withConnection(TEAM, 'chatgpt', 'disconnected');
    assert.equal(message(offline, draft), DISCONNECTED_MESSAGE);
  });

  it('re-enables Start when a provider reconnects while the wizard is open', () => {
    const draft = { coordinatorId: 'deepseek', watcherIds: ['chatgpt'] };
    const offline = withConnection(TEAM, 'chatgpt', 'disconnected');
    assert.equal(validateTeamDraft(syncTeamDraft(draft, offline), offline).canStart, false);

    const backOnline = withConnection(TEAM, 'chatgpt', 'connected');
    const synced = syncTeamDraft(draft, backOnline);
    assert.deepEqual(synced, draft);
    assert.equal(validateTeamDraft(synced, backOnline).canStart, true);
  });

  it('keeps a seeded Watcher selected when it disconnects mid-wizard', () => {
    const seeded = deriveTeamDraft(TEAM);
    const offline = withConnection(TEAM, 'grok', 'disconnected');
    const synced = syncTeamDraft(seeded, offline);
    assert.deepEqual(synced.watcherIds, ['chatgpt', 'grok']);
    assert.equal(message(offline, synced), DISCONNECTED_MESSAGE);
  });

  it('drops selections the runtime no longer reports and recovers a Coordinator', () => {
    const draft = { coordinatorId: 'deepseek', watcherIds: ['chatgpt', 'ghost'] };
    const pruned = syncTeamDraft(draft, TEAM);
    assert.deepEqual(pruned.watcherIds, ['chatgpt']);

    const withoutLead = TEAM.filter((member) => member.id !== 'deepseek');
    const recovered = syncTeamDraft(draft, withoutLead);
    assert.equal(recovered.coordinatorId, '');
    assert.equal(message(withoutLead, recovered), NO_COORDINATOR_MESSAGE);
  });
});

describe('New Decision team rendering', () => {
  it('shows the drafted team and gates Start in Review', () => {
    const ready = renderToStaticMarkup(
      React.createElement(DecisionReview, {
        draft: DECISION,
        team: TEAM,
        teamDraft: { coordinatorId: 'chatgpt', watcherIds: ['grok'] },
        onBack: noop,
        onStart: async () => {},
      }),
    );
    assert.match(ready, /<h3>Coordinator<\/h3><p class="review-copy">ChatGPT<\/p>/);
    assert.match(ready, /<li>Grok<\/li>/);
    assert.ok(!/disabled=""[^>]*>Start Decision/.test(ready));

    const blocked = renderToStaticMarkup(
      React.createElement(DecisionReview, {
        draft: DECISION,
        team: withConnection(TEAM, 'grok', 'disconnected'),
        teamDraft: { coordinatorId: 'chatgpt', watcherIds: ['grok'] },
        onBack: noop,
        onStart: async () => {},
      }),
    );
    assert.match(
      blocked,
      /Connect the selected Coordinator and Watchers before starting\./,
    );
    assert.match(blocked, /disabled=""[^>]*>Start Decision/);

    const noWatchers = renderToStaticMarkup(
      React.createElement(DecisionReview, {
        draft: DECISION,
        team: TEAM,
        teamDraft: { coordinatorId: 'deepseek', watcherIds: [] },
        onBack: () => {},
        onStart: async () => {},
      }),
    );
    assert.match(
      noWatchers,
      /Choose at least one connected Watcher to continue\./,
    );
    assert.match(noWatchers, /<p class="review-copy">None included<\/p>/);
    assert.match(noWatchers, /disabled=""[^>]*>Start Decision/);
  });
});
