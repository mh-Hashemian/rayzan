import { debateTitle, type RuntimeDebateState } from '../../api.js';
import type {
  AgentPhaseStatus,
  AgentProgress,
  DebateBadgeStatus,
  DebateWorkspaceView,
  ProgressDetail,
  ProgressStage,
  StageStatus,
  TimelineItem,
  TranscriptMessage,
} from './types.js';

export function deriveDebateView(
  state: RuntimeDebateState,
  fallbackTitle: string,
): DebateWorkspaceView {
  const debate = state.activeDebate ?? state.debate;
  const title = debate ? debateTitle(debate.topic) : fallbackTitle;
  const subtitle = subtitleFromTopic(debate?.topic, fallbackTitle);
  const watchers = state.agents.filter(
    (agent) => agent.role === 'watcher' && agent.enabled,
  );
  const coordinator = state.agents.find((agent) => agent.role === 'coordinator');
  const hasSynthesis = state.synthesis !== undefined;
  const framingDone = watchers.some((agent) => agent.round1Status !== 'idle');

  const stages = deriveStages({
    sessionStarted: state.sessionStarted || debate !== undefined,
    framingDone,
    hasSynthesis,
    rounds: state.rounds,
    awaitingOperator: state.awaitingOperator,
    synthesisPending: state.synthesisPending,
  });
  const badge = deriveBadge(stages, hasSynthesis, debate?.status);
  const agents = deriveAgents(state, coordinator?.id);
  const details = deriveDetails({
    framingDone,
    rounds: state.rounds,
    watcherCount: watchers.length,
    awaitingOperator: state.awaitingOperator,
    synthesisPending: state.synthesisPending,
  });

  return {
    title,
    subtitle,
    badge,
    stages,
    details,
    nextAction: deriveNextAction({
      hasSynthesis,
      framingDone,
      sessionStarted: state.sessionStarted || debate !== undefined,
      rounds: state.rounds,
      awaitingOperator: state.awaitingOperator,
      synthesisPending: state.synthesisPending,
    }),
    agents,
    timeline: deriveTimeline(state),
    insights: {
      agreement: [],
      disagreement: [],
      risks: [],
    },
    transcript: deriveTranscript(state),
    ...(state.synthesis ? { synthesis: state.synthesis.body } : {}),
    ...(state.checkpoint
      ? {
          checkpoint: {
            roundNumber: state.checkpoint.roundNumber,
            body: state.checkpoint.body,
            recommendation: state.checkpoint.recommendation,
          },
        }
      : {}),
    awaitingOperator: state.awaitingOperator,
    ...(state.lastError ? { lastError: state.lastError } : {}),
    ...(state.canRetryCoordinatorDispatch
      ? { canRetryCoordinatorDispatch: true }
      : {}),
  };
}

function subtitleFromTopic(
  topic: string | undefined,
  fallback: string,
): string {
  if (topic === undefined) {
    return 'Watch independent perspectives form a recommendation.';
  }
  const lines = topic
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const goal = lines.find((line) => line.toLowerCase().startsWith('goal:'));
  if (goal) {
    return goal.replace(/^goal:\s*/i, '');
  }
  if (lines.length > 1 && lines[0] !== fallback) {
    return lines.slice(1).join(' ').slice(0, 160);
  }
  return 'Watch independent perspectives form a recommendation.';
}

function deriveStages(input: {
  readonly sessionStarted: boolean;
  readonly framingDone: boolean;
  readonly hasSynthesis: boolean;
  readonly rounds: RuntimeDebateState['rounds'];
  readonly awaitingOperator: boolean;
  readonly synthesisPending: boolean;
}): ProgressStage[] {
  // A Round 1 record is created before the Coordinator has returned its framing
  // brief.  Do not mark Reframe complete until that brief has reached a Watcher.
  const reframe: StageStatus = input.framingDone
    ? 'completed'
    : input.sessionStarted
      ? 'active'
      : 'waiting';
  const synthesis: StageStatus = input.hasSynthesis
    ? 'completed'
    : input.synthesisPending
      ? 'active'
      : 'waiting';
  const decision: StageStatus = input.hasSynthesis ? 'completed' : 'waiting';

  const dynamicRounds = input.rounds.map((round) => ({
    id: `round-${round.number}`,
    label: `Round ${round.number}`,
    detail: round.number === 1 ? 'Independent perspectives' : 'Shared evidence and challenge',
    status: input.hasSynthesis || round.status === 'completed'
      ? 'completed'
      // Round 1 is created before its Coordinator framing brief is returned.
      // Keep it queued until Reframe has genuinely handed work to the Watchers.
      : round.number === 1 && !input.framingDone
        ? 'waiting'
      : round.status === 'active' || round.status === 'collecting'
        ? 'active'
        : 'waiting' as StageStatus,
  }));
  return [
    {
      id: 'reframe',
      label: 'Reframe',
      detail: 'Clarify the question',
      status: reframe,
    },
    ...(dynamicRounds.length > 0
      ? dynamicRounds
      : [{ id: 'round1', label: 'Round 1', detail: 'Initial perspectives', status: 'waiting' as StageStatus }]),
    ...(input.awaitingOperator && !input.synthesisPending
      ? [{ id: 'operator', label: 'Awaiting Operator', detail: 'Choose the next step', status: 'active' as StageStatus }]
      : []),
    {
      id: 'synthesis',
      label: 'Synthesis',
      detail: 'Integrate insights',
      status: synthesis,
    },
    {
      id: 'decision',
      label: 'Decision',
      detail: 'Final recommendation',
      status: decision,
    },
  ];
}

function deriveBadge(
  stages: readonly ProgressStage[],
  hasSynthesis: boolean,
  debateStatus: string | undefined,
): DebateBadgeStatus {
  if (hasSynthesis || debateStatus === 'completed') {
    return 'Completed';
  }
  const active = stages.find((stage) => stage.status === 'active');
  if (active?.id === 'synthesis') {
    return 'Synthesizing';
  }
  if (active?.id === 'reframe' || !stages.some((s) => s.status !== 'waiting')) {
    return 'Preparing';
  }
  return 'In Progress';
}

function deriveDetails(input: {
  readonly framingDone: boolean;
  readonly rounds: RuntimeDebateState['rounds'];
  readonly watcherCount: number;
  readonly awaitingOperator: boolean;
  readonly synthesisPending: boolean;
}): ProgressDetail[] {
  return [
    {
      label: 'Coordinator framing',
      status: input.framingDone ? 'completed' : 'active',
    },
    ...input.rounds.map((round) => ({
      label: `Round ${round.number}`,
      status: (round.status === 'completed'
        ? 'completed'
        : round.status === 'active' || round.status === 'collecting'
          ? 'active'
          : 'waiting') as StageStatus,
      note: input.watcherCount > 0 ? `${input.watcherCount} Watchers` : undefined,
    })),
    ...(input.awaitingOperator && !input.synthesisPending
      ? [{ label: 'Operator decision', status: 'active' as StageStatus }]
      : []),
  ];
}

function deriveNextAction(input: {
  readonly hasSynthesis: boolean;
  readonly framingDone: boolean;
  readonly sessionStarted: boolean;
  readonly rounds: RuntimeDebateState['rounds'];
  readonly awaitingOperator: boolean;
  readonly synthesisPending: boolean;
}): string | undefined {
  if (input.hasSynthesis) {
    return undefined;
  }
  if (input.synthesisPending) {
    return 'Coordinator synthesis';
  }
  if (input.awaitingOperator) {
    return 'Choose Continue or Finish Decision';
  }
  const active = input.rounds.find(
    (round) => round.status === 'active' || round.status === 'collecting',
  );
  if (active) {
    return `Collect Round ${active.number} Watcher responses`;
  }
  if (input.framingDone) {
    return 'Collect Round 1 Watcher responses';
  }
  if (input.sessionStarted) {
    return 'Coordinator framing';
  }
  return 'Starting debate';
}

function deriveAgents(
  state: RuntimeDebateState,
  coordinatorId: string | undefined,
): AgentProgress[] {
  const agents = state.agents
    .filter((agent) => agent.role === 'coordinator' || agent.enabled)
    .filter((agent) => agent.role !== 'operator')
    .map((agent) => {
      if (agent.role === 'coordinator') {
        return deriveCoordinator(agent, state);
      }
      return deriveWatcher(agent, state, coordinatorId);
    });
  return [
    ...agents.filter((agent) => agent.role === 'coordinator'),
    ...agents.filter((agent) => agent.role !== 'coordinator'),
  ];
}

function deriveCoordinator(
  agent: RuntimeDebateState['agents'][number],
  state: RuntimeDebateState,
): AgentProgress {
  const hasSynthesis = state.synthesis !== undefined;
  const framingDone = state.agents.some(
    (item) => item.role === 'watcher' && item.enabled && item.round1Status !== 'idle',
  );
  const coordinatorWorking =
    agent.phase === 'sending' || agent.phase === 'generating';
  const completedRounds = state.rounds.filter(
    (round) => round.status === 'completed',
  ).length;
  const phasesTotal = Math.max(1, state.rounds.length + 1);
  const phasesDone = hasSynthesis ? phasesTotal : completedRounds;

  let status: AgentPhaseStatus = 'Waiting';
  let summary = 'Waiting to frame the decision';
  if (hasSynthesis) {
    status = 'Completed';
    summary = 'Final synthesis stored';
  } else if (state.awaitingOperator) {
    status = 'Awaiting Operator';
    summary = 'Checkpoint ready for your decision';
  } else if (state.synthesisPending) {
    status = coordinatorWorking ? 'Thinking' : 'Waiting';
    summary = coordinatorWorking
      ? 'Preparing final synthesis'
      : 'Final synthesis queued';
  } else if (coordinatorWorking) {
    status = 'Thinking';
    const activeRound = state.rounds.find(
      (round) => round.status === 'active' || round.status === 'collecting',
    );
    if (activeRound && activeRound.number > 1) {
      summary = `Preparing Round ${activeRound.number} challenges`;
    } else if (!framingDone) {
      summary = 'Framing the Operator question';
    } else {
      summary = 'Working';
    }
  } else if (framingDone) {
    status = 'Waiting';
    const activeRound = state.rounds.find(
      (round) => round.status === 'active' || round.status === 'collecting',
    );
    summary = activeRound
      ? `Waiting for Round ${activeRound.number} Watcher responses`
      : 'Waiting for the next debate step';
  } else if (state.sessionStarted || state.activeDebate || state.debate) {
    status = 'Thinking';
    summary = 'Framing the Operator question';
  }

  return {
    id: agent.id,
    name: agent.name,
    role: 'coordinator',
    provider: agent.provider,
    status,
    summary,
    phasesDone,
    phasesTotal,
    rounds: [],
  };
}

function deriveWatcher(
  agent: RuntimeDebateState['agents'][number],
  state: RuntimeDebateState,
  _coordinatorId: string | undefined,
): AgentProgress {
  const rounds = agent.roundStatuses.map((round) => ({
    number: round.number,
    status: roundLabel(round.status),
  }));
  const phasesTotal = Math.max(1, rounds.length);
  let phasesDone = rounds.filter((round) => round.status === 'Completed').length;
  if (state.synthesis) {
    phasesDone = phasesTotal;
  }

  let status: AgentPhaseStatus = 'Waiting';
  let summary = 'Waiting for Round 1 brief';
  if (state.synthesis) {
    status = 'Completed';
    summary = 'Participation complete';
  } else if (state.awaitingOperator) {
    status = 'Responded';
    summary = 'Round participation complete';
  } else if (state.synthesisPending) {
    status = 'Responded';
    summary = 'Awaiting final Coordinator report';
  } else if (rounds.at(-1)?.status === 'Completed') {
    status = 'Responded';
    summary = `Round ${rounds.at(-1)?.number} response received`;
  } else if (
    isWorkingStatus(agent.roundStatuses.at(-1)?.status ?? 'idle') ||
    isBusyPhase(agent.phase ?? 'idle', agent.roundStatuses.at(-1)?.status ?? 'idle')
  ) {
    status = 'Thinking';
    const current = rounds.at(-1)?.number ?? 1;
    summary = `Working on Round ${current} analysis`;
  }

  return {
    id: agent.id,
    name: agent.name,
    role: 'watcher',
    provider: agent.provider,
    status,
    summary,
    phasesDone,
    phasesTotal,
    rounds,
  };
}

function isWorkingStatus(status: string): boolean {
  return (
    status === 'generating' ||
    status === 'pending' ||
    status === 'sending' ||
    status === 'delivered'
  );
}

function isBusyPhase(phase: string, roundStatus: string): boolean {
  if (roundStatus === 'responded' || roundStatus === 'failed' || roundStatus === 'idle') {
    return false;
  }
  return phase === 'sending' || phase === 'generating' || phase === 'waiting';
}

function roundLabel(status: string): string {
  if (status === 'responded') {
    return 'Completed';
  }
  if (status === 'pending' || status === 'generating' || status === 'sending') {
    return 'In progress';
  }
  if (status === 'failed') {
    return 'Failed';
  }
  return 'Waiting';
}

function deriveTimeline(state: RuntimeDebateState): TimelineItem[] {
  const items: TimelineItem[] = [];
  const debate = state.activeDebate ?? state.debate;
  if (debate) {
    items.push({
      id: 'created',
      title: 'Decision started',
      detail: debateTitle(debate.topic),
      time: formatTime(debate.createdAt),
      status: 'completed',
    });
  }

  if (state.rounds.length > 0) {
    items.push({
      id: 'framed',
      title: 'Coordinator framed the question',
      detail: 'Round 1 brief dispatched to Watchers.',
      time: '',
      status: 'completed',
    });
  }
  for (const round of state.rounds) {
    const completed = round.status === 'completed';
    items.push({
      id: `round-${round.number}`,
      title: `Round ${round.number} ${completed ? 'completed' : 'in progress'}`,
      detail:
        round.number === 1
          ? 'Independent Watcher perspectives are collected.'
          : 'Shared evidence and Coordinator-directed challenges.',
      time: completed ? '' : 'In progress',
      status: completed ? 'completed' : 'active',
    });
  }
  if (state.awaitingOperator) {
    items.push({
      id: 'operator-gate',
      title: 'Awaiting Operator decision',
      detail: 'Choose Continue, Add Guidance + Continue, or Finish Decision.',
      time: 'Your action',
      status: 'active',
    });
  }
  if (state.synthesis) {
    items.push({
      id: 'synth',
      title: 'Coordinator synthesis created',
      detail: 'Final report is ready for the Operator.',
      time: formatTime(state.synthesis.createdAt),
      status: 'completed',
    });
  } else if (state.synthesisPending) {
    items.push({
      id: 'synth-wait',
      title: 'Synthesis started',
      detail: 'Coordinator is preparing the final report.',
      time: 'In progress',
      status: 'active',
    });
  }

  return items;
}

function deriveTranscript(state: RuntimeDebateState): TranscriptMessage[] {
  const names = new Map(
    state.agents.map((agent) => [agent.id, agent.name] as const),
  );
  return (state.messages ?? []).map((message) => ({
    id: message.id,
    from: names.get(message.senderId) ?? message.senderId,
    kind: message.kind,
    body: message.body,
  }));
}

function formatTime(value: string | undefined): string {
  if (value === undefined) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}
