import { useState } from 'react';

import {
  composeDecisionProblem,
  startLiveDecision,
  type AgentView,
} from '../../api.js';
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
  readonly onDecisionStarted: (launch: {
    readonly question: string;
    readonly coordinatorName: string;
    readonly watcherNames: readonly string[];
  }) => void;
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
          onStart={async () => {
            const coordinator = input.team.find(
              (agent) =>
                agent.role === 'coordinator' && agent.connection === 'connected',
            );
            const watchers = input.team.filter(
              (agent) =>
                agent.role === 'watcher' &&
                agent.enabled &&
                agent.connection === 'connected',
            );
            if (coordinator === undefined) {
              throw new Error(
                'Coordinator is not connected. Connect it in Settings → AI Providers.',
              );
            }
            if (watchers.length === 0) {
              throw new Error(
                'No connected Watchers included. Connect ChatGPT in Settings, or include a connected Watcher.',
              );
            }
            // Runtime includes every enabled Watcher — drop disconnected ones
            // so the debate cannot stall on unavailable participants.
            for (const agent of input.team) {
              if (
                agent.role === 'watcher' &&
                agent.enabled &&
                agent.connection !== 'connected'
              ) {
                await input.onSetWatcherParticipation(agent.id, false);
              }
            }
            const participants = [coordinator, ...watchers];
            const state = await startLiveDecision(
              composeDecisionProblem({
                question: draft.question,
                context: draft.context,
                goal: draft.goal,
              }),
            );
            const debateId = state.debate?.id ?? state.activeDebate?.id;
            if (
              debateId &&
              window.rayzanDesktop?.attachDebateConversations !== undefined
            ) {
              const attach = await window.rayzanDesktop.attachDebateConversations(
                {
                  debateId,
                  agents: participants.map((agent) => ({
                    agentId: agent.id,
                    name: agent.name,
                    provider: agent.provider,
                  })),
                },
              );
              if (attach.error) {
                throw new Error(attach.error);
              }
            }
            input.onDecisionStarted({
              question: draft.question.trim(),
              coordinatorName: coordinator?.name ?? 'Coordinator',
              watcherNames: watchers.map((agent) => agent.name),
            });
          }}
        />
      ) : null}
    </section>
  );
}
