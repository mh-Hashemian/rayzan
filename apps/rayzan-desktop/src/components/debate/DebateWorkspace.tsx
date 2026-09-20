import { useEffect, useState } from 'react';

import {
  fetchRuntimeState,
  continueDebate,
  endDebate,
  finishDebate,
  retryCoordinatorDispatch,
  type RuntimeDebateState,
} from '../../api.js';
import { AgentProgressCard } from './AgentProgressCard.js';
import { DebateProgress } from './DebateProgress.js';
import { DebateTimeline } from './DebateTimeline.js';
import { deriveDebateView } from './derive.js';
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
  /** Prefer staying on this page to show the final report. */
  readonly onViewDecision?: () => void;
  readonly useMock?: boolean;
}) {
  const [state, setState] = useState<RuntimeDebateState | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();
  const [retryBusy, setRetryBusy] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [guidance, setGuidance] = useState('');
  const [gateBusy, setGateBusy] = useState(false);
  const [stopBusy, setStopBusy] = useState(false);
  const [managedAgentIds, setManagedAgentIds] = useState<ReadonlySet<string>>(
    new Set(),
  );

  useEffect(() => {
    if (input.useMock) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const next = await fetchRuntimeState();
        if (!cancelled) {
          setState(next);
          setLoadError(undefined);
          const debateId = next.debate?.id ?? next.activeDebate?.id;
          if (debateId && window.rayzanDesktop?.debateOwnership) {
            const ownership = await window.rayzanDesktop.debateOwnership(
              debateId,
            );
            if (!cancelled) {
              setManagedAgentIds(
                new Set(ownership.map((item) => item.agentId)),
              );
            }
          }
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? error.message
              : 'Could not load debate state',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [input.liveTick, input.useMock]);

  const baseView: DebateWorkspaceView = input.useMock
    ? {
        ...MOCK_DEBATE_VIEW,
        title: input.launch.question || MOCK_DEBATE_VIEW.title,
      }
    : state
      ? deriveDebateView(state, input.launch.question)
      : {
          title: input.launch.question || 'Active decision',
          subtitle: 'Loading live debate state…',
          badge: 'Preparing',
          stages: [
            {
              id: 'reframe',
              label: 'Reframe',
              detail: 'Clarify the question',
              status: 'waiting',
            },
            {
              id: 'round1',
              label: 'Round 1',
              detail: 'Initial perspectives',
              status: 'waiting',
            },
            {
              id: 'challenge',
              label: 'Challenge',
              detail: 'Deepen the analysis',
              status: 'waiting',
            },
            {
              id: 'synthesis',
              label: 'Synthesis',
              detail: 'Integrate insights',
              status: 'waiting',
            },
            {
              id: 'decision',
              label: 'Decision',
              detail: 'Final recommendation',
              status: 'waiting',
            },
          ],
          details: [],
          agents: [],
          timeline: [],
          transcript: [],
          insights: { agreement: [], disagreement: [], risks: [] },
          awaitingOperator: false,
        };

  const view: DebateWorkspaceView = {
    ...baseView,
    agents: baseView.agents.map((agent) =>
      managedAgentIds.has(agent.id)
        ? { ...agent, sessionMode: 'managed' as const }
        : agent,
    ),
  };

  const complete = view.badge === 'Completed' && view.synthesis !== undefined;
  const showingFinal = complete || (showReport && view.synthesis !== undefined);

  async function retryDispatch() {
    setRetryBusy(true);
    try {
      const next = await retryCoordinatorDispatch();
      setState(next);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Retry failed');
    } finally {
      setRetryBusy(false);
    }
  }

  async function actAtGate(action: 'continue' | 'finish') {
    setGateBusy(true);
    try {
      const next =
        action === 'finish'
          ? await finishDebate()
          : await continueDebate(guidance.trim() || undefined);
      setState(next);
      if (action === 'continue') {
        setGuidance('');
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not update debate');
    } finally {
      setGateBusy(false);
    }
  }

  async function stopDecision() {
    const debateId = state?.debate?.id ?? state?.activeDebate?.id;
    if (debateId === undefined) {
      input.onBackHome();
      return;
    }
    if (
      !window.confirm(
        'Stop this Decision? Progress is kept in history, and you can start a new one.',
      )
    ) {
      return;
    }
    setStopBusy(true);
    setLoadError(undefined);
    try {
      await endDebate();
      await window.rayzanDesktop?.stopDebateProviders?.(debateId);
      input.onBackHome();
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : 'Could not stop this Decision',
      );
    } finally {
      setStopBusy(false);
    }
  }

  const canStop =
    !input.useMock &&
    !complete &&
    (state?.debate !== undefined || state?.activeDebate !== undefined);

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
          {canStop ? (
            <button
              type="button"
              className="btn danger"
              disabled={stopBusy || gateBusy}
              onClick={() => {
                void stopDecision();
              }}
            >
              {stopBusy ? 'Stopping…' : 'Stop Decision'}
            </button>
          ) : null}
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (view.synthesis) {
                setShowReport(true);
              }
              input.onViewDecision?.();
            }}
          >
            View Decision Details
          </button>
        </div>
      </header>

      {loadError ? (
        <div className="error-panel">
          <p>{loadError}</p>
        </div>
      ) : null}

      {!view.synthesis &&
      (view.lastError || view.canRetryCoordinatorDispatch) ? (
        <div className="error-panel">
          <p>Rayzan could not continue this decision.</p>
          {view.lastError ? (
            <p className="review-copy">{view.lastError}</p>
          ) : (
            <p className="review-copy">
              Coordinator framing completed, but Watcher prompts were not
              queued.
            </p>
          )}
          {view.canRetryCoordinatorDispatch ? (
            <button
              type="button"
              className="btn"
              disabled={retryBusy}
              onClick={() => {
                void retryDispatch();
              }}
            >
              {retryBusy ? 'Retrying…' : 'Retry Watcher dispatch'}
            </button>
          ) : null}
        </div>
      ) : null}

      {showingFinal ? (
        <section className="obs-final card-panel" id="final-report">
          <p className="obs-eyebrow">Decision Complete</p>
          <h2>Final Coordinator Report</h2>
          <pre className="obs-report">{view.synthesis}</pre>
          <div className="wizard-actions">
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                setShowReport(true);
                document
                  .getElementById('final-report')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              View Report
            </button>
            <button type="button" className="btn" disabled>
              Export
            </button>
            {!complete ? (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setShowReport(false);
                }}
              >
                Back to live view
              </button>
            ) : null}
          </div>
        </section>
      ) : (
        <>
          <DebateProgress
            stages={view.stages}
            details={view.details}
            nextAction={view.nextAction}
          />

          {view.awaitingOperator && view.checkpoint ? (
            <section className="operator-gate card-panel" aria-label="Operator decision gate">
              <p className="obs-eyebrow">Round {view.checkpoint.roundNumber} Complete</p>
              <h2>Awaiting Operator</h2>
              <p className="gate-recommendation">
                Coordinator recommends: <strong>{view.checkpoint.recommendation.toUpperCase()}</strong>
              </p>
              <pre className="obs-report">{view.checkpoint.body}</pre>
              <label className="gate-guidance">
                Guidance for next round (optional)
                <textarea
                  value={guidance}
                  disabled={gateBusy}
                  onChange={(event) => setGuidance(event.target.value)}
                  placeholder="Assume we only have one DevOps engineer…"
                />
              </label>
              <div className="wizard-actions">
                <button type="button" className="btn" disabled={gateBusy} onClick={() => void actAtGate('finish')}>
                  Finish Decision
                </button>
                <button type="button" className="btn primary" disabled={gateBusy} onClick={() => void actAtGate('continue')}>
                  {guidance.trim() ? 'Add Guidance + Continue' : 'Continue'}
                </button>
              </div>
            </section>
          ) : null}

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
