import { useState } from 'react';

import type { AgentView } from '../../api.js';
import { ProviderLogo } from '../providers/ProviderLogo.js';

function isAvailable(agent: AgentView): boolean {
  return agent.connection === 'connected';
}

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
  const available = input.team.filter(isAvailable);
  const coordinators = available.filter((agent) => agent.role === 'coordinator');
  const watchers = available.filter((agent) => agent.role === 'watcher');
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
    coordinator !== undefined &&
    includedWatchers.length >= 1;

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
              No connected Coordinator. Connect DeepSeek (or another Coordinator)
              in Settings.
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
                  Provider: {coordinator.provider ?? coordinator.name} · Connected
                </small>
              </span>
              {coordinators.length > 1 ? (
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
              ) : null}
            </article>
          )}
        </div>

        <div className="wizard-team-col">
          <h2 className="team-label">Watchers</h2>
          {watchers.length === 0 ? (
            <p className="empty">
              No connected Watchers. Connect ChatGPT in Settings.
            </p>
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
                        {agent.provider ?? agent.name} · Connected
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
          {coordinator === undefined
            ? 'Connect a Coordinator before continuing.'
            : 'Include at least one connected Watcher before continuing.'}
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
              Only connected providers can lead a Decision.
            </p>
            <ul className="picker-list">
              {coordinators.map((agent) => (
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
