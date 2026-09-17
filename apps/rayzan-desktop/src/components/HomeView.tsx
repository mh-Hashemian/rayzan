import { useState } from 'react';

import type { DebateView, RayzanDesktopStatus } from '../api.js';
import type { ProductPage } from '../navigation.js';
import { AgentCard } from './AgentCard.js';
import { DebateCard } from './DebateCard.js';
import rayzanLogo from '../assets/branding/rayzan-logo-tagline-navy.png';

export function HomeView(input: {
  readonly status: RayzanDesktopStatus;
  readonly onNavigate: (page: ProductPage) => void;
  readonly onChangeCoordinator: (agentId: string) => Promise<void>;
  readonly onSetWatcherParticipation: (
    agentId: string,
    enabled: boolean,
  ) => Promise<void>;
}) {
  const agents = input.status.team;
  const coordinators = agents.filter((agent) => agent.role === 'coordinator');
  const watchers = agents.filter((agent) => agent.role === 'watcher');
  const recent = input.status.debateHistory.slice(0, 5);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(
    coordinators[0]?.id ?? '',
  );
  const [busy, setBusy] = useState(false);
  const [pickerError, setPickerError] = useState<string | undefined>();

  async function confirmCoordinator() {
    if (selectedId.length === 0) {
      return;
    }
    setBusy(true);
    setPickerError(undefined);
    try {
      await input.onChangeCoordinator(selectedId);
      setPickerOpen(false);
    } catch (error) {
      setPickerError(
        error instanceof Error ? error.message : 'Could not change Coordinator',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page home">
      <header className="hero">
        <div>
          <h1>Welcome to Rayzan</h1>
          <p className="lede">
            Orchestrate multiple AI perspectives. Make better decisions.
          </p>
        </div>
        <img
          className="hero-logo"
          src={rayzanLogo}
          alt="Rayzan — From many perspectives."
          draggable={false}
        />
      </header>

      <div className="cta-row">
        <button
          type="button"
          className="cta primary"
          onClick={() => {
            input.onNavigate('new-decision');
          }}
        >
          <span className="cta-kicker">Primary</span>
          <strong>Start New Decision</strong>
          <span>Bring multiple AI perspectives to an important question.</span>
        </button>
        <button
          type="button"
          className="cta"
          onClick={() => {
            input.onNavigate('debates');
          }}
        >
          <span className="cta-kicker">History</span>
          <strong>View Recent Debates</strong>
          <span>Return to past decisions and their reasoning.</span>
        </button>
      </div>

      <section className="block">
        <header className="block-head">
          <div>
            <h2>Your AI Team</h2>
            <p>Include or exclude Watchers for the next debate.</p>
          </div>
        </header>

        {agents.length === 0 ? (
          <p className="empty">
            No agents restored yet. Register a Coordinator and Watchers from
            Settings → Debug workspace.
          </p>
        ) : (
          <div className="team">
            <div className="team-cards">
              {coordinators.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onChangeCoordinator={() => {
                    setSelectedId(agent.id);
                    setPickerError(undefined);
                    setPickerOpen(true);
                  }}
                />
              ))}
              {watchers.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onToggleParticipation={(enabled) => {
                    void input.onSetWatcherParticipation(agent.id, enabled);
                  }}
                />
              ))}
            </div>
            {coordinators.length === 0 ? (
              <p className="empty">No coordinator registered.</p>
            ) : null}
            {watchers.length === 0 ? (
              <p className="empty">No watchers registered.</p>
            ) : null}
          </div>
        )}
      </section>

      {input.status.activeDebate ? (
        <section className="block">
          <h2>Current decision</h2>
          <DebateCard
            debate={input.status.activeDebate}
            onOpen={() => {
              input.onNavigate('active-decision');
            }}
          />
        </section>
      ) : null}

      <section className="block">
        <header className="block-head">
          <h2>Recent debates</h2>
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              input.onNavigate('debates');
            }}
          >
            View all
          </button>
        </header>
        {recent.length === 0 ? (
          <p className="empty">No debates yet.</p>
        ) : (
          <div className="debate-list">
            {recent.map((debate: DebateView) => (
              <DebateCard key={debate.id} debate={debate} />
            ))}
          </div>
        )}
      </section>

      {pickerOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal"
            role="dialog"
            aria-labelledby="coordinator-picker-title"
          >
            <h2 id="coordinator-picker-title">Change Coordinator</h2>
            <p className="lede">
              This changes who leads future debates. Existing debates keep
              their original Coordinator.
            </p>
            <ul className="picker-list">
              {agents.map((agent) => (
                <li key={agent.id}>
                  <label>
                    <input
                      type="radio"
                      name="coordinator"
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
            {pickerError ? <p className="error-text">{pickerError}</p> : null}
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
