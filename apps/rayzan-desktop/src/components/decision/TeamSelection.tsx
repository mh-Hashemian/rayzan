import { useState } from 'react';

import type { AgentView } from '../../api.js';
import { ProviderLogo } from '../providers/ProviderLogo.js';
import {
  isConnected,
  teamCandidates,
  validateTeamDraft,
  type TeamDraft,
} from './team.js';

export function TeamSelection(input: {
  readonly team: readonly AgentView[];
  readonly draft: TeamDraft;
  readonly onSelectCoordinator: (agentId: string) => void;
  readonly onToggleWatcher: (agentId: string, selected: boolean) => void;
  readonly onBack: () => void;
  readonly onContinue: () => void;
}) {
  const candidates = teamCandidates(input.team);
  const coordinator = candidates.find(
    (agent) => agent.id === input.draft.coordinatorId,
  );
  const watchers = candidates.filter(
    (agent) => agent.id !== input.draft.coordinatorId,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(input.draft.coordinatorId);
  const readiness = validateTeamDraft(input.draft, input.team);

  return (
    <section className="wizard-panel">
      <header className="wizard-panel-head">
        <p className="wizard-step-label">Step 2 of 3</p>
        <h1>AI Team</h1>
        <p className="lede">
          Only connected providers can join a Decision. Connect others in
          Settings first.
        </p>
      </header>

      <div className="wizard-team">
        <div className="wizard-team-col">
          <h2 className="team-label">Coordinator</h2>
          {coordinator === undefined ? (
            <p className="empty">
              No Coordinator selected. Choose one below to continue.
            </p>
          ) : (
            <article className="wizard-coord-row">
              <ProviderLogo
                name={coordinator.name}
                provider={coordinator.provider}
                size={28}
              />
              <span className="wizard-coord-copy">
                {coordinator.name}
                <small>
                  Provider: {coordinator.provider ?? coordinator.name} ·{' '}
                  {isConnected(coordinator) ? 'Connected' : 'Not connected'}
                </small>
              </span>
            </article>
          )}
          <button
            type="button"
            className="text-btn wizard-coord-change"
            onClick={() => {
              setSelectedId(input.draft.coordinatorId);
              setPickerOpen(true);
            }}
          >
            Change Coordinator
          </button>
        </div>

        <div className="wizard-team-col">
          <h2 className="team-label">Watchers</h2>
          {watchers.length === 0 ? (
            <p className="empty">
              Every provider is leading this Decision. Change the Coordinator
              to add Watchers.
            </p>
          ) : (
            <ul className="wizard-watcher-list">
              {watchers.map((agent) => {
                const selected = input.draft.watcherIds.includes(agent.id);
                const connected = isConnected(agent);
                return (
                  <li key={agent.id}>
                    <label className="wizard-watcher-row">
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={!connected && !selected}
                        onChange={(event) => {
                          input.onToggleWatcher(agent.id, event.target.checked);
                        }}
                      />
                      <ProviderLogo
                        name={agent.name}
                        provider={agent.provider}
                        size={28}
                      />
                      <span>
                        {agent.name}
                        <small>
                          {agent.provider ?? agent.name} ·{' '}
                          {connected ? 'Connected' : 'Not connected'}
                        </small>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {!readiness.canStart ? (
        <p className="wizard-inline-note">{readiness.message}</p>
      ) : (
        <p className="wizard-inline-note">
          {coordinator?.name} leads this Decision with{' '}
          {input.draft.watcherIds.length} Watcher
          {input.draft.watcherIds.length === 1 ? '' : 's'}.
        </p>
      )}

      <div className="wizard-actions">
        <button type="button" className="btn" onClick={input.onBack}>
          Back
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!readiness.canStart}
          onClick={input.onContinue}
        >
          Continue to Review
        </button>
      </div>

      {pickerOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal"
            role="dialog"
            aria-labelledby="wizard-coordinator-title"
          >
            <h2 id="wizard-coordinator-title">Change Coordinator</h2>
            <p className="lede">
              Only connected providers can lead this Decision. The current
              Coordinator stays available as a Watcher.
            </p>
            <ul className="picker-list">
              {candidates.map((agent) => {
                const connected = isConnected(agent);
                return (
                  <li key={agent.id}>
                    <label>
                      <input
                        type="radio"
                        name="wizard-coordinator"
                        checked={selectedId === agent.id}
                        disabled={!connected}
                        onChange={() => {
                          setSelectedId(agent.id);
                        }}
                      />
                      <span>
                        {agent.name}
                        <small>
                          {roleLabel(agent.role)}
                          {agent.provider ? ` · ${agent.provider}` : ''}
                          {connected ? '' : ' · Not connected'}
                        </small>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setPickerOpen(false);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={selectedId.length === 0}
                onClick={() => {
                  input.onSelectCoordinator(selectedId);
                  setPickerOpen(false);
                }}
              >
                Use as Coordinator
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function roleLabel(role: string): string {
  if (role.length === 0) {
    return role;
  }
  return role[0]!.toUpperCase() + role.slice(1);
}
