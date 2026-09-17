export type StageStatus = 'completed' | 'active' | 'waiting';

export type DebateBadgeStatus =
  | 'Preparing'
  | 'In Progress'
  | 'Synthesizing'
  | 'Completed';

export interface CoordinatorCheckpointView {
  readonly roundNumber: number;
  readonly body: string;
  readonly recommendation: 'finish' | 'continue';
}

export type AgentPhaseStatus =
  | 'Active'
  | 'Thinking'
  | 'Responded'
  | 'Waiting'
  | 'Awaiting Operator'
  | 'Completed';

export interface AgentRoundProgress {
  readonly number: number;
  readonly status: string;
}

export interface ProgressStage {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly status: StageStatus;
}

export interface ProgressDetail {
  readonly label: string;
  readonly status: StageStatus | 'info';
  readonly note?: string;
}

export interface AgentProgress {
  readonly id: string;
  readonly name: string;
  readonly role: 'coordinator' | 'watcher';
  readonly provider?: string;
  readonly status: AgentPhaseStatus;
  readonly summary: string;
  readonly phasesDone: number;
  readonly phasesTotal: number;
  readonly rounds: readonly AgentRoundProgress[];
}

export interface TimelineItem {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly time: string;
  readonly status: StageStatus;
}

export interface InsightsView {
  readonly emerging?: string;
  readonly agreement: readonly string[];
  readonly disagreement: readonly string[];
  readonly risks: readonly string[];
}

export interface TranscriptMessage {
  readonly id: string;
  readonly from: string;
  readonly kind: string;
  readonly body: string;
}

export interface DebateWorkspaceView {
  readonly title: string;
  readonly subtitle: string;
  readonly badge: DebateBadgeStatus;
  readonly stages: readonly ProgressStage[];
  readonly details: readonly ProgressDetail[];
  readonly nextAction?: string;
  readonly agents: readonly AgentProgress[];
  readonly timeline: readonly TimelineItem[];
  readonly insights: InsightsView;
  readonly transcript: readonly TranscriptMessage[];
  readonly synthesis?: string;
  readonly checkpoint?: CoordinatorCheckpointView;
  readonly awaitingOperator: boolean;
  readonly lastError?: string;
  readonly canRetryCoordinatorDispatch?: boolean;
}
