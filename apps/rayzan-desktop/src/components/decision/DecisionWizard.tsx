import { useState } from 'react';

import type { AgentView } from '../../api.js';
import { DecisionQuestion } from './DecisionQuestion.js';
import { DecisionReview } from './DecisionReview.js';
import { TeamSelection } from './TeamSelection.js';
import type { DecisionDraft, WizardStep } from './types.js';

const EMPTY_DRAFT: DecisionDraft = {
  question: '',
  context: '',
  goal: 'Compare options',
};

export function DecisionWizard(input: {
  readonly team: readonly AgentView[];
  readonly onBackHome: () => void;
  readonly onChangeCoordinator: (agentId: string) => Promise<void>;
  readonly onSetWatcherParticipation: (
    agentId: string,
    enabled: boolean,
  ) => Promise<void>;
}) {
  const [step, setStep] = useState<WizardStep>('question');
  const [draft, setDraft] = useState<DecisionDraft>(EMPTY_DRAFT);

  return (
    <section className="page wizard">
      <button type="button" className="back-link" onClick={input.onBackHome}>
        ← Back to Home
      </button>

      <nav className="wizard-progress" aria-label="Decision wizard steps">
        <span className={step === 'question' ? 'active' : ''}>Define</span>
        <span className={step === 'team' ? 'active' : ''}>AI Team</span>
        <span className={step === 'review' ? 'active' : ''}>Review</span>
      </nav>

      {step === 'question' ? (
        <DecisionQuestion
          draft={draft}
          onChange={setDraft}
          onContinue={() => {
            setStep('team');
          }}
        />
      ) : null}

      {step === 'team' ? (
        <TeamSelection
          team={input.team}
          onChangeCoordinator={input.onChangeCoordinator}
          onSetWatcherParticipation={input.onSetWatcherParticipation}
          onBack={() => {
            setStep('question');
          }}
          onContinue={() => {
            setStep('review');
          }}
        />
      ) : null}

      {step === 'review' ? (
        <DecisionReview
          draft={draft}
          team={input.team}
          onBack={() => {
            setStep('team');
          }}
        />
      ) : null}
    </section>
  );
}
