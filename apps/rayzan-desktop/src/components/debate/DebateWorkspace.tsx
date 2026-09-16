import { AgentProgressCard } from './AgentProgressCard.js';
import { DebateProgress } from './DebateProgress.js';
import { DebateTimeline } from './DebateTimeline.js';
import { InsightsPanel } from './InsightsPanel.js';
import { MOCK_DEBATE_VIEW } from './mock.js';
import { TranscriptPanel } from './TranscriptPanel.js';
import type { DebateWorkspaceView } from './types.js';

export interface ActiveDecisionLaunch {
  readonly question: string;
  readonly coordinatorName: string;
  readonly watcherNames: readonly string[];
}

export function DebateWorkspace(input: {
  readonly launch: ActiveDecisionLaunch;
  readonly liveTick: number;
  readonly onBackHome: () => void;
  readonly onViewDecision: () => void;
  /** Checkpoint 1 uses mock layout; later checkpoints pass live view. */
  readonly view?: DebateWorkspaceView;
  readonly onRetryDispatch?: () => Promise<void>;
}) {
  const view = input.view ?? withLaunch(MOCK_DEBATE_VIEW, input.launch);
  const complete = view.badge === 'Completed' && view.synthesis !== undefined;

  return (
    <section className="page obs-workspace">
      <button type="button" className="back-link" onClick={input.onBackHome}>
        ← Back to Home
      </button>

      <header className="obs-header">
        <div className="obs-header-copy">
          <p className="obs-eyebrow">Decision workspace</p>
          <div className="obs-title-row">
            <h1>{view.title}</h1>
            <span className={`obs-badge ${badgeClass(view.badge)}`}>
              · {view.badge}
            </span>
          </div>
          <p className="lede">{view.subtitle}</p>
        </div>
        <div className="obs-header-actions">
          <button
            type="button"
            className="btn"
            onClick={input.onViewDecision}
          >
            View Decision Details
          </button>
          <button type="button" className="icon-btn" aria-label="More">
            ···
          </button>
        </div>
      </header>

      {view.lastError || view.canRetryCoordinatorDispatch ? (
        <div className="error-panel">
          <p>Rayzan could not continue this decision.</p>
          {view.lastError ? <p className="review-copy">{view.lastError}</p> : null}
          {view.canRetryCoordinatorDispatch && input.onRetryDispatch ? (
            <button
              type="button"
              className="btn"
              onClick={() => {
                void input.onRetryDispatch?.();
              }}
            >
              Retry Watcher dispatch
            </button>
          ) : null}
        </div>
      ) : null}

      {complete ? (
        <section className="obs-final card-panel">
          <p className="obs-eyebrow">Decision Complete</p>
          <h2>Final Coordinator Report</h2>
          <pre className="obs-report">{view.synthesis}</pre>
          <div className="wizard-actions">
            <button
              type="button"
              className="btn primary"
              onClick={input.onViewDecision}
            >
              View Report
            </button>
            <button type="button" className="btn" disabled>
              Export
            </button>
          </div>
        </section>
      ) : (
        <>
          <DebateProgress
            stages={view.stages}
            details={view.details}
            nextAction={view.nextAction}
          />

          <section className="obs-team">
            <header className="obs-section-head">
              <h2>AI Team Progress</h2>
            </header>
            <div className="obs-team-grid">
              {view.agents.map((agent) => (
                <AgentProgressCard key={agent.id} agent={agent} />
              ))}
            </div>
          </section>

          <div className="obs-main-grid">
            <DebateTimeline items={view.timeline} />
            <InsightsPanel insights={view.insights} />
          </div>

          <TranscriptPanel messages={view.transcript} />
        </>
      )}
    </section>
  );
}

function withLaunch(
  mock: DebateWorkspaceView,
  launch: ActiveDecisionLaunch,
): DebateWorkspaceView {
  return {
    ...mock,
    title: launch.question || mock.title,
  };
}

function badgeClass(badge: DebateWorkspaceView['badge']): string {
  if (badge === 'Completed') {
    return 'ok';
  }
  if (badge === 'Synthesizing') {
    return 'synth';
  }
  if (badge === 'Preparing') {
    return 'prep';
  }
  return 'live';
}
