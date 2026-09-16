import type { AgentView, DebateView, RayzanDesktopStatus } from '../api.js';
import type { ProductPage } from '../navigation.js';
import { AgentCard } from './AgentCard.js';
import { DebateCard } from './DebateCard.js';

export function HomeView(input: {
  readonly ready: boolean;
  readonly error?: string;
  readonly status?: RayzanDesktopStatus;
  readonly agents: readonly AgentView[];
  readonly debates: readonly DebateView[];
  readonly onNavigate: (page: ProductPage) => void;
  readonly onRetry: () => void;
}) {
  const coordinators = input.agents.filter((agent) => agent.role === 'coordinator');
  const watchers = input.agents.filter((agent) => agent.role === 'watcher');
  const recent = input.debates.slice(0, 5);

  return (
    <section className="page home">
      <header className="hero">
        <div>
          <h1>Welcome to Rayzan</h1>
          <p className="lede">
            Orchestrate multiple AI perspectives. Make better decisions.
          </p>
        </div>
      </header>

      {input.error ? (
        <div className="error-panel">
          <p>{input.error}</p>
          <button type="button" className="btn" onClick={input.onRetry}>
            Retry
          </button>
        </div>
      ) : null}

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
            <p>Coordinator first. Watchers second. Provider is secondary to role.</p>
          </div>
        </header>

        {input.agents.length === 0 ? (
          <p className="empty">
            {input.ready
              ? 'No agents restored yet. Register a Coordinator and Watchers from Settings → Debug workspace.'
              : 'Runtime is not ready, so the team cannot be loaded.'}
          </p>
        ) : (
          <div className="team">
            <div>
              <h3 className="team-label">Coordinator</h3>
              <div className="card-grid">
                {coordinators.length === 0 ? (
                  <p className="empty">No coordinator registered.</p>
                ) : (
                  coordinators.map((agent) => (
                    <AgentCard key={agent.id} agent={agent} />
                  ))
                )}
              </div>
            </div>
            <div>
              <h3 className="team-label">Watchers</h3>
              <div className="card-grid">
                {watchers.length === 0 ? (
                  <p className="empty">No watchers registered.</p>
                ) : (
                  watchers.map((agent) => (
                    <AgentCard key={agent.id} agent={agent} />
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {input.status?.activeDebate ? (
        <section className="block">
          <h2>Current decision</h2>
          <DebateCard debate={input.status.activeDebate} />
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
            {recent.map((debate) => (
              <DebateCard key={debate.id} debate={debate} />
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
