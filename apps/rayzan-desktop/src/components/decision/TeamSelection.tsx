import { useState } from 'react';

import type { AgentView } from '../../api.js';
import { ProviderLogo } from '../providers/ProviderLogo.js';

export function TeamSelection(input: {
  readonly team: readonly AgentView[];
  readonly onChangeCoordinator: (agentId: string) => Promise<void>;
  readonly onSetWatcherParticipation: (
    agentId: string,
    enabled: boolean,
  ) => Promise<void>;
  readonly onBack: () => void;
  readonly onContinue: () => void;
}) {
  const coordinators = input.team.filter((agent) => agent.role === 'coordinator');
  const watchers = input.team.filter((agent) => agent.role === 'watcher');
  const coordinator = coordinators[0];
  const includedWatchers = watchers.filter((agent) => agent.enabled);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(coordinator?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function confirmCoordinator() {
    if (selectedId.length === 0) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await input.onChangeCoordinator(selectedId);
      setPickerOpen(false);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not change Coordinator',
      );
    } finally {
      setBusy(false);
    }
  }

  const canContinue =
    coordinator !== undefined && includedWatchers.length >= 2;

  return (
    <section className="wizard-panel">
      <header className="wizard-panel-head">
        <p className="wizard-step-label">Step 2 of 3</p>
        <h1>AI Team</h1>
        <p className="lede">
          Rayzan will ask independent AI perspectives, then synthesize the
          discussion.
        </p>
      </header>

      <div className="wizard-team">
        <div>
          <h2 className="team-label">Coordinator</h2>
          {coordinator === undefined ? (
            <p className="empty">No coordinator registered.</p>
          ) : (
            <article className="agent-card wizard-team-card">
              <div className="agent-card-top">
                <ProviderLogo
                  name={coordinator.name}
                  provider={coordinator.provider}
                  size={36}
                />
                <div>
                  <p className="agent-role">Coordinator</p>
                  <h3 className="agent-name">{coordinator.name}</h3>
                </div>
              </div>
              <p className="agent-provider">
                Provider: {coordinator.provider ?? coordinator.name}
              </p>
              <div className="agent-card-footer">
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => {
                    setSelectedId(coordinator.id);
                    setError(undefined);
                    setPickerOpen(true);
                  }}
                >
                  Change
                </button>
              </div>
            </article>
          )}
        </div>

        <div>
          <h2 className="team-label">Watchers</h2>
          {watchers.length === 0 ? (
            <p className="empty">No watchers registered.</p>
          ) : (
            <ul className="wizard-watcher-list">
              {watchers.map((agent) => (
                <li key={agent.id}>
                  <label className="wizard-watcher-row">
                    <input
                      type="checkbox"
                      checked={agent.enabled}
                      onChange={(event) => {
                        void input.onSetWatcherParticipation(
                          agent.id,
                          event.target.checked,
                        );
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
                        {agent.provider ?? agent.name}
                        {agent.connection === 'connected'
                          ? ' · Connected'
                          : agent.connection === 'error'
                            ? ' · Error'
                            : ' · Disconnected'}
                      </small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {!canContinue ? (
        <p className="error-text">
          Include at least two Watchers before continuing.
        </p>
      ) : null}

      <div className="wizard-actions">
        <button type="button" className="btn" onClick={input.onBack}>
          Back
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!canContinue}
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
              This changes who leads future debates. Existing debates keep their
              original Coordinator.
            </p>
            <ul className="picker-list">
              {input.team.map((agent) => (
                <li key={agent.id}>
                  <label>
                    <input
                      type="radio"
                      name="wizard-coordinator"
                      checked={selectedId === agent.id}
                      onChange={() => {
                        setSelectedId(agent.id);
                      }}
                    />
                    <span>
                      {agent.name}
                      <small>
                        {roleLabel(agent.role)}
                        {agent.provider ? ` · ${agent.provider}` : ''}
                      </small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {error ? <p className="error-text">{error}</p> : null}
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
                disabled={busy || selectedId.length === 0}
                onClick={() => {
                  void confirmCoordinator();
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
