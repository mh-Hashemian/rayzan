import { useState } from 'react';

import {
  composeDecisionProblem,
  startLiveDecision,
  type AgentView,
  type RayzanDesktopStatus,
} from '../../api.js';
import { DecisionQuestion } from './DecisionQuestion.js';
import { DecisionReview } from './DecisionReview.js';
import { TeamSelection } from './TeamSelection.js';
import {
  deriveTeamDraft,
  selectCoordinator,
  syncTeamDraft,
  toggleWatcher,
  validateTeamDraft,
  type TeamDraft,
} from './team.js';
import type { DecisionDraft, WizardStep } from './types.js';

const EMPTY_DRAFT: DecisionDraft = {
  question: '',
  context: '',
  goal: 'Compare options',
};

export function DecisionWizard(input: {
  readonly team: readonly AgentView[];
  readonly onBackHome: () => void;
  readonly onChangeCoordinator: (
    agentId: string,
  ) => Promise<RayzanDesktopStatus>;
  readonly onSetWatcherParticipation: (
    agentId: string,
    enabled: boolean,
  ) => Promise<RayzanDesktopStatus>;
  readonly onDecisionStarted: (launch: {
    readonly question: string;
    readonly coordinatorName: string;
    readonly watcherNames: readonly string[];
  }) => void;
}) {
  const [step, setStep] = useState<WizardStep>('question');
  const [draft, setDraft] = useState<DecisionDraft>(EMPTY_DRAFT);
  // Seeded once when the wizard opens, then only re-synced against live status.
  // Re-deriving on every refresh would silently drop a Watcher that disconnects
  // mid-wizard instead of telling the Operator to reconnect it.
  const [teamDraft, setTeamDraft] = useState<TeamDraft>(() =>
    deriveTeamDraft(input.team),
  );
  const liveTeamDraft = syncTeamDraft(teamDraft, input.team);

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
          draft={liveTeamDraft}
          onSelectCoordinator={(agentId) => {
            setTeamDraft(selectCoordinator(liveTeamDraft, agentId));
          }}
          onToggleWatcher={(agentId, selected) => {
            setTeamDraft(toggleWatcher(liveTeamDraft, agentId, selected));
          }}
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
          teamDraft={liveTeamDraft}
          onBack={() => {
            setStep('team');
          }}
          onStart={async () => {
            const readiness = validateTeamDraft(liveTeamDraft, input.team);
            if (!readiness.canStart) {
              throw new Error(readiness.message);
            }
            const liveTeam = await reconcileTeam(
              liveTeamDraft,
              input.team,
              input.onChangeCoordinator,
              input.onSetWatcherParticipation,
            );
            const coordinator = liveTeam.find(
              (agent) => agent.id === liveTeamDraft.coordinatorId,
            );
            const watchers = liveTeamDraft.watcherIds.flatMap((id) => {
              const agent = liveTeam.find((candidate) => candidate.id === id);
              return agent === undefined ? [] : [agent];
            });
            if (coordinator === undefined) {
              throw new Error(
                'The selected Coordinator is no longer available. Go back and choose a connected Coordinator.',
              );
            }
            if (watchers.length === 0) {
              throw new Error(
                'No Watchers are selected. Go back and include at least one connected Watcher.',
              );
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
              coordinatorName: coordinator.name,
              watcherNames: watchers.map((agent) => agent.name),
            });
          }}
        />
      ) : null}
    </section>
  );
}

/**
 * Push only the differences between the wizard draft and the runtime's global
 * team, immediately before the debate is created, so the debate is started with
 * exactly the team the Review step showed.
 */
async function reconcileTeam(
  teamDraft: TeamDraft,
  team: readonly AgentView[],
  onChangeCoordinator: (agentId: string) => Promise<RayzanDesktopStatus>,
  onSetWatcherParticipation: (
    agentId: string,
    enabled: boolean,
  ) => Promise<RayzanDesktopStatus>,
): Promise<readonly AgentView[]> {
  let liveTeam = team;
  const currentCoordinator = liveTeam.find(
    (agent) => agent.role === 'coordinator',
  );
  if (currentCoordinator?.id !== teamDraft.coordinatorId) {
    liveTeam = (await onChangeCoordinator(teamDraft.coordinatorId)).team;
  }
  for (const agent of liveTeam) {
    if (agent.role !== 'watcher') {
      continue;
    }
    const wanted = teamDraft.watcherIds.includes(agent.id);
    if (agent.enabled !== wanted) {
      liveTeam = (await onSetWatcherParticipation(agent.id, wanted)).team;
    }
  }
  return liveTeam;
}
