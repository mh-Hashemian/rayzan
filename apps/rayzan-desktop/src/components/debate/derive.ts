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
  const round1Done = state.round1?.status === 'completed';
  const round2Exists = state.round2 !== undefined;
  const round2Done = state.round2?.status === 'completed';
  const hasSynthesis = state.synthesis !== undefined;
  const framingDone = watchers.some((agent) => agent.round1Status !== 'idle');
  const round1Responded = watchers.filter(
    (agent) => agent.round1Status === 'responded',
  ).length;
  const round2Responded = watchers.filter(
    (agent) => agent.round2Status === 'responded',
  ).length;

  const stages = deriveStages({
    sessionStarted: state.sessionStarted || debate !== undefined,
    framingDone,
    round1Done,
    round2Exists,
    round2Done,
    hasSynthesis,
  });
  const badge = deriveBadge(stages, hasSynthesis, debate?.status);
  const agents = deriveAgents(state, coordinator?.id);
  const details = deriveDetails({
    framingDone,
    round1Done,
    round1Responded,
    round2Exists,
    round2Done,
    round2Responded,
    watcherCount: watchers.length,
    hasSynthesis,
  });

  return {
    title,
    subtitle,
    badge,
    stages,
    details,
    nextAction: deriveNextAction({
      hasSynthesis,
      round2Done,
      round2Exists,
      round1Done,
      framingDone,
      sessionStarted: state.sessionStarted || debate !== undefined,
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
  readonly round1Done: boolean;
  readonly round2Exists: boolean;
  readonly round2Done: boolean;
  readonly hasSynthesis: boolean;
}): ProgressStage[] {
  // Exactly one stage is active at a time (earliest incomplete work).
  let reframe: StageStatus = 'waiting';
  let round1: StageStatus = 'waiting';
  let challenge: StageStatus = 'waiting';
  let synthesis: StageStatus = 'waiting';
  let decision: StageStatus = 'waiting';

  if (input.hasSynthesis) {
    reframe = 'completed';
    round1 = 'completed';
    challenge = 'completed';
    synthesis = 'completed';
    decision = 'completed';
  } else if (input.round2Done) {
    reframe = 'completed';
    round1 = 'completed';
    challenge = 'completed';
    synthesis = 'active';
  } else if (input.round2Exists || input.round1Done) {
    reframe = 'completed';
    round1 = 'completed';
    challenge = 'active';
  } else if (input.framingDone) {
    reframe = 'completed';
    round1 = 'active';
  } else if (input.sessionStarted) {
    reframe = 'active';
  }

  return [
    {
      id: 'reframe',
      label: 'Reframe',
      detail: 'Clarify the question',
      status: reframe,
    },
    {
      id: 'round1',
      label: 'Round 1',
      detail: 'Initial perspectives',
      status: round1,
    },
    {
      id: 'challenge',
      label: 'Challenge',
      detail: 'Deepen the analysis',
      status: challenge,
    },
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
  readonly round1Done: boolean;
  readonly round1Responded: number;
  readonly round2Exists: boolean;
  readonly round2Done: boolean;
  readonly round2Responded: number;
  readonly watcherCount: number;
  readonly hasSynthesis: boolean;
}): ProgressDetail[] {
  const framing: StageStatus =
    input.framingDone || input.round1Done
      ? 'completed'
      : 'active';
  const round1: StageStatus = input.round1Done
    ? 'completed'
    : input.framingDone
      ? 'active'
      : 'waiting';
  const round2: StageStatus = input.round2Done
    ? 'completed'
    : input.round2Exists || input.round1Done
      ? 'active'
      : 'waiting';
  const watcherResponses: StageStatus =
    input.round2Done ||
    (input.round2Exists &&
      input.round2Responded >= input.watcherCount &&
      input.watcherCount > 0)
      ? 'completed'
      : input.round2Exists
        ? 'active'
        : 'waiting';

  return [
    {
      label: 'Coordinator framing',
      status: framing,
    },
    {
      label: 'Round 1 analysis',
      status: round1,
      note:
        input.watcherCount > 0
          ? `${input.round1Responded} of ${input.watcherCount} received`
          : undefined,
    },
    {
      label: 'Round 2 challenge',
      status: round2,
    },
    {
      label: 'Watcher responses',
      status: watcherResponses,
      note:
        input.round2Exists && input.watcherCount > 0
          ? `${input.round2Responded} of ${input.watcherCount} received`
          : undefined,
    },
  ];
}

function deriveNextAction(input: {
  readonly hasSynthesis: boolean;
  readonly round2Done: boolean;
  readonly round2Exists: boolean;
  readonly round1Done: boolean;
  readonly framingDone: boolean;
  readonly sessionStarted: boolean;
}): string | undefined {
  if (input.hasSynthesis) {
    return undefined;
  }
  if (input.round2Done) {
    return 'Coordinator synthesis';
  }
  if (input.round2Exists) {
    return 'Collect Round 2 Watcher responses';
  }
  if (input.round1Done) {
    return 'Coordinator Round 2 plan';
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
  const round2Done = state.round2?.status === 'completed';
  const round1Done = state.round1?.status === 'completed';
  const framingDone = state.agents.some(
    (item) => item.role === 'watcher' && item.enabled && item.round1Status !== 'idle',
  );
  const coordinatorWorking =
    agent.phase === 'sending' || agent.phase === 'generating';

  let phasesDone = 0;
  if (state.sessionStarted || state.activeDebate || state.debate) {
    phasesDone = 1;
  }
  if (framingDone) {
    phasesDone = 2;
  }
  if (round1Done) {
    phasesDone = 3;
  }
  if (round2Done) {
    phasesDone = 4;
  }
  if (hasSynthesis) {
    phasesDone = 5;
  }

  let status: AgentPhaseStatus = 'Waiting';
  let summary = 'Waiting to frame the decision';
  if (hasSynthesis) {
    status = 'Completed';
    summary = 'Final synthesis stored';
  } else if (coordinatorWorking) {
    // Only show loading when the Coordinator itself is generating.
    status = 'Thinking';
    if (round2Done) {
      summary = 'Preparing final synthesis';
    } else if (round1Done && !state.round2) {
      summary = 'Reviewing Round 1 evidence';
    } else if (!framingDone) {
      summary = 'Framing the Operator question';
    } else {
      summary = 'Working';
    }
  } else if (round2Done) {
    status = 'Thinking';
    summary = 'Preparing final synthesis';
  } else if (state.round2) {
    status = 'Waiting';
    summary = 'Waiting for Round 2 Watcher responses';
  } else if (round1Done) {
    status = 'Thinking';
    summary = 'Reviewing Round 1 evidence';
  } else if (framingDone) {
    status = 'Waiting';
    summary = 'Waiting for Round 1 Watcher responses';
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
    phasesTotal: 5,
  };
}

function deriveWatcher(
  agent: RuntimeDebateState['agents'][number],
  state: RuntimeDebateState,
  _coordinatorId: string | undefined,
): AgentProgress {
  const round1Label = roundLabel(agent.round1Status);
  const round2Label = roundLabel(agent.round2Status);
  let phasesDone = 0;
  if (agent.round1Status === 'responded') {
    phasesDone = 2;
  } else if (agent.round1Status !== 'idle') {
    phasesDone = 1;
  }
  if (agent.round2Status === 'responded') {
    phasesDone = 4;
  } else if (agent.round2Status !== 'idle') {
    phasesDone = 3;
  }
  if (state.synthesis) {
    phasesDone = 5;
  }

  let status: AgentPhaseStatus = 'Waiting';
  let summary = 'Waiting for Round 1 brief';
  if (state.synthesis) {
    status = 'Completed';
    summary = 'Participation complete';
  } else if (agent.round2Status === 'responded') {
    status = 'Responded';
    summary = 'Round 2 response received';
  } else if (
    isWorkingStatus(agent.round2Status) ||
    isBusyPhase(agent.phase ?? 'idle', agent.round2Status)
  ) {
    status = 'Thinking';
    summary = 'Working on Round 2 challenge';
  } else if (agent.round1Status === 'responded') {
    status = 'Responded';
    summary = state.round2
      ? 'Waiting for Round 2 challenge'
      : 'Round 1 complete · Awaiting challenges';
  } else if (
    isWorkingStatus(agent.round1Status) ||
    isBusyPhase(agent.phase ?? 'idle', agent.round1Status)
  ) {
    status = 'Thinking';
    summary = 'Working on Round 1 analysis';
  }

  return {
    id: agent.id,
    name: agent.name,
    role: 'watcher',
    provider: agent.provider,
    status,
    summary,
    phasesDone,
    phasesTotal: 5,
    round1: round1Label,
    round2: round2Label,
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

  const watchers = state.agents.filter(
    (agent) => agent.role === 'watcher' && agent.enabled,
  );
  if (watchers.some((agent) => agent.round1Status !== 'idle')) {
    items.push({
      id: 'framed',
      title: 'Coordinator framed the question',
      detail: 'Round 1 brief dispatched to Watchers.',
      time: '',
      status: 'completed',
    });
  }
  for (const watcher of watchers) {
    if (watcher.round1Status === 'responded') {
      items.push({
        id: `r1-${watcher.id}`,
        title: `${watcher.name} submitted Round 1 analysis`,
        detail: 'Independent perspective captured.',
        time: '',
        status: 'completed',
      });
    }
  }
  if (state.round1?.status === 'completed') {
    items.push({
      id: 'r1-done',
      title: 'Round 1 completed',
      detail: 'All included Watcher responses collected.',
      time: '',
      status: 'completed',
    });
  }
  if (state.round2) {
    items.push({
      id: 'r2-start',
      title: 'Coordinator sent Round 2 challenges',
      detail: 'Personalized challenges queued for Watchers.',
      time: '',
      status: 'completed',
    });
  }
  for (const watcher of watchers) {
    if (watcher.round2Status === 'responded') {
      items.push({
        id: `r2-${watcher.id}`,
        title: `${watcher.name} Round 2 response captured`,
        detail: 'Challenge reply stored.',
        time: '',
        status: 'completed',
      });
    }
  }
  if (state.synthesis) {
    items.push({
      id: 'synth',
      title: 'Coordinator synthesis created',
      detail: 'Final report is ready for the Operator.',
      time: formatTime(state.synthesis.createdAt),
      status: 'completed',
    });
  } else if (state.round2?.status === 'completed') {
    items.push({
      id: 'synth-wait',
      title: 'Synthesis started',
      detail: 'Coordinator is preparing the final report.',
      time: 'In progress',
      status: 'active',
    });
  } else if (state.round1?.status === 'completed' && !state.round2) {
    items.push({
      id: 'r2-wait',
      title: 'Coordinator reviewing Round 1',
      detail: 'Preparing personalized Round 2 challenges.',
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
