import { DECISION_GOALS, type DecisionDraft, type DecisionGoal } from './types.js';

export function DecisionQuestion(input: {
  readonly draft: DecisionDraft;
  readonly onChange: (next: DecisionDraft) => void;
  readonly onContinue: () => void;
}) {
  const questionOk = input.draft.question.trim().length > 0;

  return (
    <section className="wizard-panel">
      <header className="wizard-panel-head">
        <p className="wizard-step-label">Step 1 of 3</p>
        <h1>New Decision</h1>
        <p className="lede">What decision do you need help with?</p>
      </header>

      <label className="field">
        <span className="field-label">Decision question</span>
        <textarea
          className="field-input field-input-lg"
          rows={4}
          required
          placeholder="Should Rayzan use SQLite or PostgreSQL for persistent storage?"
          value={input.draft.question}
          onChange={(event) => {
            input.onChange({ ...input.draft, question: event.target.value });
          }}
        />
      </label>

      <label className="field">
        <span className="field-label">
          Context <span className="field-optional">optional</span>
        </span>
        <textarea
          className="field-input"
          rows={5}
          placeholder="Constraints, current stack, timelines, or other background the team should know."
          value={input.draft.context}
          onChange={(event) => {
            input.onChange({ ...input.draft, context: event.target.value });
          }}
        />
      </label>

      <label className="field">
        <span className="field-label">Decision goal</span>
        <select
          className="field-input"
          value={input.draft.goal}
          onChange={(event) => {
            input.onChange({
              ...input.draft,
              goal: event.target.value as DecisionGoal,
            });
          }}
        >
          {DECISION_GOALS.map((goal) => (
            <option key={goal} value={goal}>
              {goal}
            </option>
          ))}
        </select>
      </label>

      <div className="wizard-actions">
        <button
          type="button"
          className="btn primary"
          disabled={!questionOk}
          onClick={input.onContinue}
        >
          Continue to AI Team
        </button>
      </div>
    </section>
  );
}
