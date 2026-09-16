import { useEffect, useState } from 'react';

import {
  debateTitle,
  fetchRuntimeState,
  type RuntimeDebateState,
} from '../api.js';

export interface ActiveDecisionLaunch {
  readonly question: string;
  readonly coordinatorName: string;
  readonly watcherNames: readonly string[];
}

type StageId =
  | 'preparing'
  | 'framing'
  | 'round1'
  | 'round2'
  | 'synthesis';

const STAGES: readonly { readonly id: StageId; readonly label: string }[] = [
  { id: 'preparing', label: 'Preparing' },
  { id: 'framing', label: 'Coordinator framing' },
  { id: 'round1', label: 'Round 1' },
  { id: 'round2', label: 'Round 2' },
  { id: 'synthesis', label: 'Synthesis' },
];

export function DebateWorkspace(input: {
  readonly launch: ActiveDecisionLaunch;
  readonly liveTick: number;
  readonly onViewDecision: () => void;
  readonly onBackHome: () => void;
}) {
  const [state, setState] = useState<RuntimeDebateState | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await fetchRuntimeState();
        if (!cancelled) {
          setState(next);
          setLoadError(undefined);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : 'Could not load debate state',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [input.liveTick]);

  const debate = state?.activeDebate ?? state?.debate;
  const topic = debate?.topic ?? input.launch.question;
  const watchers = (state?.agents ?? []).filter(
    (agent) => agent.role === 'watcher' && agent.enabled,
  );
  const watcherNames =
    watchers.length > 0
      ? watchers.map((agent) => agent.name)
      : input.launch.watcherNames;
  const coordinator =
    state?.agents.find((agent) => agent.role === 'coordinator')?.name ??
    input.launch.coordinatorName;

  const activeStage = deriveStage(state);
  const statusLine = deriveStatusLine(state, watcherNames);
  const reportReady = state?.synthesis !== undefined;

  return (
    <section className="page active-decision">
      <button type="button" className="back-link" onClick={input.onBackHome}>
        ← Back to Home
      </button>

      <header className="wizard-panel-head">
        <h1>Active Decision</h1>
      </header>

      <div className="review-card">
        <h2>Question</h2>
        <p className="review-question">{debateTitle(topic)}</p>

        <h3>Status</h3>
        <p className="review-copy">{statusLine}</p>

        <h3>Coordinator</h3>
        <p className="review-copy">{coordinator}</p>

        <h3>Watchers</h3>
        <ul className="review-list">
          {watcherNames.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </div>

      <div className="review-card">
        <h2>Live stages</h2>
        <ul className="stage-list">
          {STAGES.map((stage) => {
            const done = stageIndex(activeStage) > stageIndex(stage.id);
            const current = activeStage === stage.id;
            return (
              <li
                key={stage.id}
                className={
                  done ? 'stage done' : current ? 'stage current' : 'stage'
                }
              >
                <span className="stage-mark" aria-hidden="true">
                  {done ? '●' : current ? '◉' : '○'}
                </span>
                <span>{stage.label}</span>
                {stage.id === 'round1' && state?.round1 ? (
                  <ul className="stage-agents">
                    {watcherNames.map((name) => {
                      const agent = watchers.find((item) => item.name === name);
                      const ok = agent?.round1Status === 'responded';
                      return (
                        <li key={name}>
                          {name}
                          {ok ? ' ✓' : ''}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                {stage.id === 'round2' && state?.round2 ? (
                  <ul className="stage-agents">
                    {watcherNames.map((name) => {
                      const agent = watchers.find((item) => item.name === name);
                      const ok = agent?.round2Status === 'responded';
                      return (
                        <li key={name}>
                          {name}
                          {ok ? ' ✓' : ''}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      {loadError !== undefined ? (
        <div className="error-panel">
          <p>{loadError}</p>
        </div>
      ) : null}

      {state?.lastError !== undefined ? (
        <div className="error-panel">
          <p>{state.lastError}</p>
        </div>
      ) : null}

      {reportReady ? (
        <div className="wizard-actions">
          <button
            type="button"
            className="btn primary"
            onClick={input.onViewDecision}
          >
            View Decision
          </button>
        </div>
      ) : null}
    </section>
  );
}

function deriveStage(state: RuntimeDebateState | undefined): StageId {
  if (state?.synthesis !== undefined) {
    return 'synthesis';
  }
  if (state?.round2 !== undefined) {
    return 'round2';
  }
  if (state?.round1 !== undefined && state.round1.status === 'completed') {
    return 'round2';
  }
  const watchers = (state?.agents ?? []).filter(
    (agent) => agent.role === 'watcher' && agent.enabled,
  );
  const round1Started = watchers.some(
    (agent) => agent.round1Status !== 'idle',
  );
  if (round1Started) {
    return 'round1';
  }
  if (state?.sessionStarted || state?.activeDebate !== undefined) {
    return 'framing';
  }
  return 'preparing';
}

function deriveStatusLine(
  state: RuntimeDebateState | undefined,
  watcherNames: readonly string[],
): string {
  if (state?.synthesis !== undefined) {
    return 'Final Report Ready';
  }
  if (state?.round2 !== undefined) {
    const watchers = (state.agents ?? []).filter(
      (agent) => agent.role === 'watcher' && agent.enabled,
    );
    const marks = watcherNames
      .map((name) => {
        const agent = watchers.find((item) => item.name === name);
        return `${name}${agent?.round2Status === 'responded' ? ' ✓' : ''}`;
      })
      .join('\n');
    return `Round 2:\n${marks}`;
  }
  if (state?.round1 !== undefined) {
    const watchers = (state.agents ?? []).filter(
      (agent) => agent.role === 'watcher' && agent.enabled,
    );
    const anyResponse = watchers.some(
      (agent) => agent.round1Status === 'responded',
    );
    if (anyResponse || state.round1.status === 'completed') {
      const marks = watcherNames
        .map((name) => {
          const agent = watchers.find((item) => item.name === name);
          return `${name}${agent?.round1Status === 'responded' ? ' ✓' : ''}`;
        })
        .join('\n');
      return `Round 1:\n${marks}`;
    }
  }
  if (state?.sessionStarted || state?.activeDebate !== undefined) {
    return 'Coordinator framing…';
  }
  return 'Starting...';
}

function stageIndex(id: StageId): number {
  return STAGES.findIndex((stage) => stage.id === id);
}
