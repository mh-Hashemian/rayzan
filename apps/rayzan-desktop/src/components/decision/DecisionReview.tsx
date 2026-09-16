import { useState } from 'react';

import type { AgentView } from '../../api.js';
import type { DecisionDraft } from './types.js';

/** Runtime requires at least two included Watchers for the live path. */
export const REQUIRED_WATCHERS = 2;

export function DecisionReview(input: {
  readonly draft: DecisionDraft;
  readonly team: readonly AgentView[];
  readonly onBack: () => void;
  readonly onStart: () => Promise<void>;
}) {
  const coordinator = input.team.find((agent) => agent.role === 'coordinator');
  const watchers = input.team.filter(
    (agent) => agent.role === 'watcher' && agent.enabled,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const questionOk = input.draft.question.trim().length > 0;
  const coordinatorOk = coordinator !== undefined;
  const watchersOk = watchers.length >= REQUIRED_WATCHERS;
  const canStart = questionOk && coordinatorOk && watchersOk && !busy;

  async function start() {
    if (!canStart) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await input.onStart();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="wizard-panel">
      <header className="wizard-panel-head">
        <p className="wizard-step-label">Step 3 of 3</p>
        <h1>Review</h1>
        <p className="lede">
          Confirm the decision and AI team before any models are contacted.
        </p>
      </header>

      <div className="review-card">
        <h2>Decision</h2>
        <p className="review-question">{input.draft.question.trim()}</p>
        {input.draft.context.trim().length > 0 ? (
          <>
            <h3>Context</h3>
            <p className="review-copy">{input.draft.context.trim()}</p>
          </>
        ) : null}
        <h3>Goal</h3>
        <p className="review-copy">{input.draft.goal}</p>
      </div>

      <div className="review-card">
        <h2>AI Team</h2>
        <h3>Coordinator</h3>
        <p className="review-copy">{coordinator?.name ?? 'None selected'}</p>
        <h3>Watchers</h3>
        {watchers.length === 0 ? (
          <p className="review-copy">None included</p>
        ) : (
          <ul className="review-list">
            {watchers.map((agent) => (
              <li key={agent.id}>{agent.name}</li>
            ))}
          </ul>
        )}
        {!watchersOk ? (
          <p className="wizard-inline-note">
            Include at least {REQUIRED_WATCHERS} Watchers to start.
          </p>
        ) : null}
      </div>

      <div className="review-card">
        <h2>Process</h2>
        <ol className="review-process">
          <li>
            <strong>Round 1</strong>
            <span>Independent analysis</span>
          </li>
          <li>
            <strong>Round 2</strong>
            <span>Critique and refinement</span>
          </li>
          <li>
            <strong>Final</strong>
            <span>Coordinator synthesis</span>
          </li>
        </ol>
      </div>

      {error !== undefined ? (
        <div className="error-panel">
          <p>Rayzan could not start this decision.</p>
          <p className="review-copy">{error}</p>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              void start();
            }}
          >
            Retry
          </button>
        </div>
      ) : null}

      <div className="wizard-actions">
        <button type="button" className="btn" onClick={input.onBack} disabled={busy}>
          Back
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!canStart}
          onClick={() => {
            void start();
          }}
        >
          {busy ? 'Starting…' : 'Start Decision'}
        </button>
      </div>
    </section>
  );
}
