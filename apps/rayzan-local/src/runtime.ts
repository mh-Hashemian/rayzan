import {
  recordEvent,
  type Event,
  type EventStore,
  type EventType,
} from '@rayzan/events';
import {
  asAgentId,
  asDebateId,
  asMessageId,
  asRoundId,
  createAgent,
  withAgentRole,
  createDebate,
  createDebateSynthesis,
  createCoordinatorCheckpoint,
  createRound,
  isOpenDebateStatus,
  withDebateStatus,
  createMessageEnvelope,
  InMemoryAgentRegistry,
  InMemoryDebateStore,
  InMemoryExposureLedgerStore,
  InMemoryMessageStore,
  InMemoryRoundStore,
  InMemorySynthesisStore,
  InMemoryCheckpointStore,
  type Agent,
  type AgentId,
  type AgentRole,
  type Debate,
  type Round,
  type CoordinatorCheckpoint,
} from '@rayzan/protocol';
import { InMemoryEventStore } from '@rayzan/storage';
import {
  asDeliveryId,
  BrowserTransport,
  type OutboundDelivery,
} from '@rayzan/transport';
import {
  CoordinatorCommandExecutor,
  createCoordinatorExecutionContext,
  createDispatchPlan,
  DispatchPlanner,
  emptyReplayResult,
  EventReplayer,
  Orchestrator,
  parseCoordinatorCommandBatch,
  RoundWorkflow,
  type CoordinatorCommandBatch,
  type DispatchIntent,
  type ReplayResult,
  type ReplayTarget,
} from '@rayzan/orchestrator';

import {
  coordinatorRound1Prompt,
  coordinatorRoundPrompt,
  coordinatorRound2Prompt,
  coordinatorCheckpointPrompt,
  coordinatorActionPrompt,
  coordinatorSynthesisPrompt,
  unwrapCoordinatorJson,
  looksLikeTruncatedCoordinatorJson,
} from './coordinator-prompt.js';
import { OPERATOR_ID } from './demo-ids.js';
import { DEFAULT_TEAM } from './default-team.js';
import {
  composeForwardWatcherBody,
  composeRoundWatcherBody,
  mergeReferencedMessageIds,
  round1EvidencePacket,
  watcherChallengesFromBatch,
  type AttributedWatcherResponse,
  type WatcherChallenge,
} from './round2-policy.js';
import {
  buildEvidenceCatalog,
  formatEvidenceCatalog,
  resolveEvidenceRefs,
} from './evidence-catalog.js';

export type AgentPhase =
  | 'idle'
  | 'waiting'
  | 'sending'
  | 'generating'
  | 'capturing'
  | 'captured'
  | 'attention'
  | 'error';

export interface PendingBrowserJob {
  readonly deliveryId: string;
  readonly messageId: string;
  readonly recipientId: string;
  readonly senderId: string;
  readonly body: string;
  readonly kind: string;
  readonly capture: boolean;
}

export interface BrowserCaptureState {
  readonly deliveryId?: string;
  readonly phase: string;
  readonly reason?: string;
  readonly promptSubmitted?: boolean;
  readonly preSendTurnCount?: number;
  readonly currentTurnCount?: number;
  readonly trackedIdentity?: string;
  readonly trackedConnected?: boolean;
  readonly textLength?: number;
  readonly posted?: boolean;
  /** Debug-only capture-boundary timestamps/flags (milliseconds / booleans). */
  readonly generationEndedAt?: number;
  readonly capturedAt?: number;
  readonly domChangedAfterTerminal?: boolean;
  readonly domChangedAfterCapture?: boolean;
}

export interface AgentPresence {
  readonly agentId: string;
  readonly provider?: string;
  readonly phase: AgentPhase;
  readonly error?: string;
  readonly lastSeen: number;
  readonly diagnostics?: unknown;
  readonly capture?: BrowserCaptureState;
}

// ---------------------------------------------------------------------------
// Provider debug observatory (ephemeral, never persisted, never events).
// Durable delivery/action state comes from the runtime; ephemeral browser
// state is pushed in by the managed Electron browser via noteManagedDebugState.
// ---------------------------------------------------------------------------

export type DebugSessionState =
  | 'connected'
  | 'restoring'
  | 'connecting'
  | 'logged_out'
  | 'error'
  | 'not_connected'
  | 'unknown';

export type DebugPageState =
  | 'ready'
  | 'loading'
  | 'navigating'
  | 'hidden'
  | 'error'
  | 'none'
  | 'unknown';

export type DebugDeliveryState =
  | 'none'
  | 'pending'
  | 'sending'
  | 'submitted'
  | 'awaiting_response'
  | 'in_doubt'
  | 'responded'
  | 'failed';

export type DebugSendState =
  | 'unknown'
  | 'idle'
  | 'preparing'
  | 'composer_ready'
  | 'submitting'
  | 'accepted'
  | 'failed';

export type DebugAssistantTurnState = 'none' | 'waiting_for_new' | 'detected';

export type DebugGenerationState = 'idle' | 'active' | 'ended' | 'unknown';

export type DebugCaptureState =
  | 'idle'
  | 'waiting'
  | 'reading'
  | 'captured'
  | 'failed';

export type DebugCoordinatorProtocolState =
  | 'not_applicable'
  | 'not_started'
  | 'parsing'
  | 'valid'
  | 'invalid';

/** Ephemeral per-provider browser state pushed by the managed Electron host. */
export interface ManagedProviderDebugState {
  readonly providerId: string;
  readonly session?: {
    readonly state: DebugSessionState;
    readonly detail?: string;
    readonly loggedIn?: boolean;
  };
  readonly page?: {
    readonly state: DebugPageState;
    readonly url?: string;
    readonly visible?: boolean;
  };
  readonly conversation?: {
    readonly state: 'ready' | 'none' | 'unknown';
    readonly conversationId?: string;
  };
  readonly send?: { readonly state: DebugSendState; readonly error?: string };
  readonly generation?: { readonly state: DebugGenerationState };
  readonly probe?: {
    readonly hasComposer?: boolean;
    readonly hasSend?: boolean;
    readonly generating?: boolean;
    readonly url?: string;
    readonly title?: string;
  };
  readonly lastError?: string;
  readonly lastChangedAt?: number;
  readonly transitions?: readonly {
    readonly at: number;
    readonly label: string;
    readonly detail?: string;
  }[];
}

export interface ManagedDebugPush {
  readonly pushedAt: number;
  readonly restoring: boolean;
  readonly sendTraceEnabled: boolean;
  readonly providers: readonly ManagedProviderDebugState[];
}

export interface DebugTransition {
  readonly at: number;
  readonly agentId?: string;
  readonly label: string;
  readonly detail?: string;
}

export interface DebugPipelineStage {
  readonly stage: string;
  readonly state: 'not_started' | 'active' | 'completed' | 'failed';
  readonly at?: string;
  readonly detail?: string;
}

export interface DebugProviderCard {
  readonly agentId: string;
  readonly providerId: string;
  readonly label: string;
  readonly role: string | undefined;
  readonly managed: boolean;
  readonly session: { readonly state: DebugSessionState; readonly detail?: string };
  readonly page: { readonly state: DebugPageState; readonly url?: string };
  readonly conversation: {
    readonly state: 'ready' | 'none' | 'unknown';
    readonly conversationId?: string;
  };
  readonly delivery: {
    readonly state: DebugDeliveryState;
    readonly deliveryId?: string;
    readonly error?: string;
  };
  readonly send: { readonly state: DebugSendState; readonly error?: string };
  readonly assistantTurn: { readonly state: DebugAssistantTurnState };
  readonly generation: { readonly state: DebugGenerationState };
  readonly capture: {
    readonly state: DebugCaptureState;
    readonly reason?: string;
    readonly textLength?: number;
    readonly preSendTurnCount?: number;
    readonly currentTurnCount?: number;
    readonly trackedIdentity?: string;
    readonly generationEndedAt?: number;
    readonly capturedAt?: number;
    readonly domChangedAfterTerminal?: boolean;
    readonly domChangedAfterCapture?: boolean;
  };
  readonly coordinatorProtocol: {
    readonly state: DebugCoordinatorProtocolState;
    readonly error?: string;
    readonly stepIndex?: number;
    readonly action?: string;
  };
  readonly presencePhase: string;
  readonly lastError?: string;
  readonly lastChangedAt?: string;
  readonly pipeline: readonly DebugPipelineStage[];
  readonly transitions: readonly {
    readonly at: string;
    readonly label: string;
    readonly detail?: string;
  }[];
  readonly details: {
    readonly windowVisible?: boolean;
    readonly restoreActive?: boolean;
    readonly sendTraceEnabled?: boolean;
    readonly url?: string;
    readonly pageUrl?: string;
    readonly probeUrl?: string;
    readonly hasComposer?: boolean;
    readonly hasSend?: boolean;
    readonly probeGenerating?: boolean;
    readonly bindingState?: string;
    readonly lastSeen?: string;
  };
}

export interface DebugProvidersView {
  readonly now: string;
  readonly restoring: boolean;
  readonly sendTraceEnabled: boolean;
  readonly providers: readonly DebugProviderCard[];
  readonly activeCoordinatorAction: {
    readonly stepIndex: number;
    readonly action?: string;
    readonly deliveryIds?: readonly string[];
    readonly pendingDeliveryIds: readonly string[];
    readonly decisionPending: boolean;
    readonly awaitingOperator: boolean;
    readonly operatorQuestion?: {
      readonly question: string;
      readonly createdAt: string;
    };
  } | null;
  readonly recentTransitions: readonly {
    readonly at: string;
    readonly source: string;
    readonly agentId?: string;
    readonly label: string;
    readonly detail?: string;
  }[];
}

export interface DebateView {
  readonly id: string;
  readonly topic: string;
  readonly status: string;
  readonly createdAt?: string;
  readonly completedAt?: string;
}

export interface RayzanSnapshot {
  readonly bridge: 'connected';
  readonly sessionStarted: boolean;
  readonly restoredFromHistory: boolean;
  readonly debate?: DebateView;
  readonly activeDebate?: DebateView;
  readonly debateHistory: readonly DebateView[];
  readonly round?: {
    readonly id: string;
    readonly number: number;
    readonly status: string;
  };
  readonly round1?: {
    readonly id: string;
    readonly number: number;
    readonly status: string;
  };
  readonly round2?: {
    readonly id: string;
    readonly number: number;
    readonly status: string;
  };
  /** Dynamic round list. `round1`/`round2` remain for historical clients. */
  readonly rounds: readonly {
    readonly id: string;
    readonly number: number;
    readonly status: string;
  }[];
  readonly checkpoint?: {
    readonly debateId: string;
    readonly roundId: string;
    readonly roundNumber: number;
    readonly body: string;
    readonly recommendation: 'finish' | 'continue';
    readonly createdAt: string;
  };
  readonly awaitingOperator: boolean;
  /** Pending Coordinator ask_operator question (same round; not a checkpoint). */
  readonly operatorQuestion?: {
    readonly debateId: string;
    readonly roundId: string;
    readonly roundNumber: number;
    readonly question: string;
    readonly createdAt: string;
  };
  readonly agents: readonly {
    readonly id: string;
    readonly name: string;
    readonly role: string;
    readonly provider?: string;
    readonly connected: boolean;
    readonly phase: AgentPhase;
    readonly error?: string;
    readonly response?: string;
    readonly round1Status: string;
    readonly round2Status: string;
    readonly roundStatuses: readonly {
      readonly number: number;
      readonly status: string;
    }[];
    readonly capture?: BrowserCaptureState;
    readonly enabled: boolean;
  }[];
  readonly deliveries: readonly {
    readonly id: string;
    readonly messageId: string;
    readonly senderId: string;
    readonly recipientId: string;
    readonly status: string;
    readonly roundId?: string;
    readonly capture?: BrowserCaptureState;
  }[];
  readonly roundProgress?: {
    readonly responded: number;
    readonly expected: number;
    readonly complete: boolean;
  };
  readonly participants: readonly {
    readonly id: string;
    readonly name: string;
    readonly role: string;
  }[];
  readonly protocol: {
    readonly messages: number;
    readonly deliveries: number;
    readonly exposures: number;
  };
  readonly browserBindings: readonly {
    readonly agentId: string;
    readonly name: string;
    readonly role: string;
    readonly provider?: string;
    readonly state: 'bound' | 'not-bound' | 'unavailable';
    readonly lastDelivery?: {
      readonly id: string;
      readonly status: string;
    };
    readonly error?: string;
  }[];
  readonly timeline: readonly string[];
  readonly round1Responses: readonly {
    readonly name: string;
    readonly body: string;
  }[];
  readonly coordinatorPlan?: {
    readonly parsed: boolean;
    readonly raw?: string;
    readonly error?: string;
    readonly challenges?: readonly {
      readonly name: string;
      readonly challenge: string;
    }[];
  };
  readonly round2Messages: readonly {
    readonly name: string;
    readonly body: string;
  }[];
  readonly synthesis?: {
    readonly debateId: string;
    readonly coordinatorId: string;
    readonly body: string;
    readonly createdAt: string;
  };
  /** Final synthesis is in flight only after the Operator explicitly finishes. */
  readonly synthesisPending: boolean;
  readonly lastCommands?: string;
  readonly lastError?: string;
  readonly canRetryCoordinatorDispatch?: boolean;
  readonly log: readonly string[];
  readonly eventLog: readonly string[];
  readonly eventDetails: readonly string[];
  readonly externalActionRecovery: readonly string[];
  readonly messages: readonly {
    readonly id: string;
    readonly senderId: string;
    readonly recipientIds: readonly string[];
    readonly kind: string;
    readonly body: string;
    readonly roundId?: string;
  }[];
  readonly watcherContributions: readonly {
    readonly agentId: string;
    readonly name: string;
    readonly provider?: string;
    readonly roundNumber: number;
    readonly prompt: string;
    readonly response?: string;
  }[];
  readonly coordinatorAction?: {
    readonly stepIndex: number;
    readonly pendingDeliveryIds: readonly string[];
    readonly terminalDeliveryIds?: readonly string[];
    readonly decisionPending: boolean;
    readonly latestAction?: {
      readonly stepIndex: number;
      readonly action: string;
      readonly deliveryIds?: readonly string[];
    };
    readonly roundStatus?: string;
    readonly awaitingOperator?: boolean;
  };
  readonly replay: ReplayResult;
}

const CONNECTED_MS = 8000;

export class RayzanRuntime {
  readonly agents = new InMemoryAgentRegistry();
  readonly debates = new InMemoryDebateStore();
  readonly rounds = new InMemoryRoundStore();
  readonly messages = new InMemoryMessageStore();
  readonly exposures = new InMemoryExposureLedgerStore();
  readonly events: EventStore;
  readonly transport = new BrowserTransport();
  readonly orchestrator: Orchestrator;
  readonly planner: DispatchPlanner;
  readonly workflow: RoundWorkflow;
  readonly executor: CoordinatorCommandExecutor;
  readonly syntheses = new InMemorySynthesisStore();
  readonly checkpoints = new InMemoryCheckpointStore();

  #started = false;
  #coordinatorBriefSent = false;
  #round1Dispatched = false;
  #round2Bootstrapped = false;
  #round2Dispatched = false;
  #synthesisQueued = false;
  #checkpointQueued = false;
  /** Delivery IDs from the current Coordinator action step awaiting responses. */
  #pendingStepDeliveryIds = new Set<string>();
  /**
   * Exact Coordinator prompt delivery the capture layer must resolve.
   * Never “newest awaiting” — correlation is this id for the active debate.
   */
  #pendingCoordinatorDeliveryId: string | undefined;
  #coordinatorStepIndex = 0;
  #coordinatorDecisionPending = false;
  /** Pending ask_operator question for the active consultation round. */
  #pendingOperatorQuestion:
    | {
        readonly debateId: string;
        readonly roundId: string;
        readonly question: string;
        readonly createdAt: string;
      }
    | undefined;
  #seq = 0;
  #log: string[] = [];
  #lastError: string | undefined;
  #lastCommands: string | undefined;
  #coordinatorRaw: string | undefined;
  #coordinatorParseError: string | undefined;
  #parsedChallenges: readonly WatcherChallenge[] | undefined;
  #replayResult: ReplayResult = emptyReplayResult();
  #restoredFromHistory = false;
  #freezeRestoredSideEffects = false;
  #presence = new Map<string, AgentPresence>();
  #bindings = new Map<
    string,
    {
      provider?: string;
      tabId?: string;
      lastSeen: number;
      available: boolean;
      error?: string;
    }
  >();
  #eventListeners = new Set<(event: Event) => void>();
  #participation = new Map<string, boolean>();
  #agentProviders = new Map<string, string>();
  // Debug observatory — in-memory only; never persisted, never emitted.
  #managedDebug = new Map<string, ManagedProviderDebugState>();
  #managedDebugMeta: { pushedAt?: number; restoring?: boolean; sendTraceEnabled?: boolean } =
    {};
  #debugTransitions: DebugTransition[] = [];
  #coordinatorProtocolDebug:
    | {
        readonly state: 'parsing' | 'valid' | 'invalid';
        readonly at: number;
        readonly deliveryId?: string;
        readonly error?: string;
        readonly stepIndex?: number;
        readonly action?: string;
      }
    | undefined;

  constructor(events: EventStore = new InMemoryEventStore()) {
    // Fan every append (including Orchestrator emits) to SSE listeners so
    // Observatory sees pending/generating delivery states, not only round completion.
    this.events = notifyEventAppend(events, (event) => {
      for (const listener of this.#eventListeners) {
        listener(event);
      }
    });
    this.orchestrator = new Orchestrator(
      this.messages,
      this.exposures,
      this.transport,
      this.events,
    );
    this.planner = new DispatchPlanner(this.agents);
    this.workflow = new RoundWorkflow(
      this.orchestrator,
      this.agents,
      this.debates,
      this.rounds,
    );
    this.executor = new CoordinatorCommandExecutor(
      this.agents,
      this.debates,
      this.rounds,
      this.workflow,
      this.orchestrator,
    );
    this.#replayResult = this.#rehydrate();
  }

  registerAgent(name: string, role: AgentRole): Agent {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new Error('agent name cannot be empty');
    }
    if (role === 'operator') {
      throw new Error('Operator is already registered');
    }
    const agent = createAgent({
      id: this.#agentId(trimmed),
      name: trimmed,
      role,
    });
    this.agents.register(agent);
    this.#emit('AGENT_REGISTERED', {
      agentId: agent.id,
      correlationId: `agent:${agent.id}`,
      payload: { id: agent.id, name: agent.name, role: agent.role },
    });
    this.#record(`Registered ${agent.name} as ${agent.role} (${agent.id}).`);
    return agent;
  }

  /**
   * Ensure the fixed product team exists (DeepSeek / ChatGPT / Qwen / GLM).
   * Providers are catalog metadata; Operator only toggles Watcher participation.
   */
  ensureDefaultTeam(): void {
    let hasCoordinator = this.agents.listByRole('coordinator').length > 0;
    for (const member of DEFAULT_TEAM) {
      const existing = this.agents.getById(asAgentId(member.id));
      if (existing !== undefined) {
        this.#agentProviders.set(member.id, member.provider);
        continue;
      }
      let role: AgentRole = member.role;
      if (role === 'coordinator' && hasCoordinator) {
        role = 'watcher';
      }
      const agent = createAgent({
        id: member.id,
        name: member.name,
        role,
      });
      this.agents.register(agent);
      this.#agentProviders.set(member.id, member.provider);
      this.#emit('AGENT_REGISTERED', {
        agentId: agent.id,
        correlationId: `agent:${agent.id}`,
        payload: {
          id: agent.id,
          name: agent.name,
          role: agent.role,
          provider: member.provider,
        },
      });
      this.#record(
        `Seeded ${agent.name} as ${agent.role} (${agent.id}, provider ${member.provider}).`,
      );
      if (role === 'coordinator') {
        hasCoordinator = true;
      }
    }
  }

  onEvent(listener: (event: Event) => void): () => void {
    this.#eventListeners.add(listener);
    return () => {
      this.#eventListeners.delete(listener);
    };
  }

  changeCoordinator(newAgentId: string): void {
    const next = this.#requireAgent(newAgentId);
    if (next.role === 'operator') {
      throw new Error('Operator cannot become Coordinator');
    }
    const current = this.#requireSingleCoordinator();
    if (current.id === next.id) {
      return;
    }
    this.agents.replace(withAgentRole(current, 'watcher'));
    this.agents.replace(withAgentRole(next, 'coordinator'));
    this.#emit('COORDINATOR_CHANGED', {
      correlationId: `coordinator:${next.id}`,
      payload: {
        previousAgentId: current.id,
        newAgentId: next.id,
        timestamp: new Date().toISOString(),
      },
    });
    this.#record(
      `Coordinator changed from ${current.name} to ${next.name}. Existing debates are unchanged.`,
    );
  }

  setWatcherParticipation(agentId: string, enabled: boolean): void {
    const agent = this.#requireAgent(agentId);
    if (agent.role !== 'watcher') {
      throw new Error('Only Watchers can be included or excluded from a debate');
    }
    if (this.#watcherEnabled(agent) === enabled) {
      return;
    }
    this.#participation.set(agent.id, enabled);
    this.#emit('WATCHER_PARTICIPATION_CHANGED', {
      agentId: agent.id,
      correlationId: `agent:${agent.id}`,
      payload: {
        agentId: agent.id,
        enabled,
        timestamp: new Date().toISOString(),
      },
    });
    this.#record(
      enabled
        ? `${agent.name} will join the next debate.`
        : `${agent.name} will be skipped in the next debate. Existing debates are unchanged.`,
    );
  }

  /**
   * Temporary Phase 3A bootstrap. Creates one active Debate and Round 1
   * because the Coordinator `start-round` command is intentionally deferred.
   * Participants are the currently registered Watchers. Does not send any
   * browser deliveries.
   */
  createRound1(problem: string): void {
    this.#assertNoOpenDebate();
    const trimmed = problem.trim();
    if (trimmed.length === 0) {
      throw new Error('problem cannot be empty');
    }
    this.#requireSingleCoordinator();
    const watchers = this.#watchersForNewDebate();
    if (watchers.length < 1) {
      throw new Error('include at least one Watcher in the next debate');
    }

    const debateId = this.#nextId('debate');
    const roundId = this.#nextId('round');
    const createdAt = new Date().toISOString();
    this.debates.create(
      createDebate({
        id: debateId,
        topic: trimmed,
        status: 'active',
        createdAt,
      }),
    );
    const debateEvent = this.#emit('DEBATE_CREATED', {
      debateId,
      correlationId: `debate:${debateId}`,
      payload: { topic: trimmed, status: 'active', createdAt },
    });
    this.rounds.create(
      createRound({
        id: roundId,
        debateId,
        number: 1,
      }),
    );
    this.#emit('ROUND_CREATED', {
      debateId,
      roundId,
      causationEventId: debateEvent.id,
      correlationId: `round:${roundId}`,
      payload: {
        number: 1,
        participantIds: watchers.map((watcher) => watcher.id),
      },
    });
    this.workflow.startRound({
      roundId,
      participantIds: watchers.map((watcher) => watcher.id),
    });
    this.#resetDebateSessionState();
    this.#freezeRestoredSideEffects = false;
    this.#started = true;
    this.#record(
      `Round 1 bootstrapped with watchers ${watchers.map((w) => w.name).join(', ')} (not start-round).`,
    );
  }

  /**
   * Ask the Coordinator to rephrase the problem, assign Watcher roles, and
   * dispatch the same Round 1 brief. Coordinator is the sender of that brief.
   */
  runLiveRound1(problem: string): void {
    const open = this.#activeDebate();
    if (
      open !== undefined &&
      (this.#coordinatorBriefSent || this.#freezeRestoredSideEffects)
    ) {
      throw new Error(
        `An active debate already exists (${open.id}). Resume it, or end/archive it before starting a new debate.`,
      );
    }
    if (open === undefined) {
      this.createRound1(problem);
    }
    if (this.#coordinatorBriefSent) {
      throw new Error('Coordinator Round 1 prompt already queued');
    }
    const watchers = this.#watchersForNewDebate();
    if (watchers.length < 1) {
      throw new Error(
        'include at least one Watcher in the next debate',
      );
    }
    const coordinator = this.#requireSingleCoordinator();
    const debate = this.#debate();
    const round1 = this.#requireRoundNumber(1);
    const intent = this.planner.plan(
      createDispatchPlan({
        messageId: this.#nextId('msg-operator-coordinator'),
        debateId: debate.id,
        senderId: OPERATOR_ID,
        recipients: {
          type: 'explicit-agents',
          agentIds: [coordinator.id],
        },
        kind: 'input',
        body: coordinatorRound1Prompt({
          problem: debate.topic,
          coordinatorId: coordinator.id,
          debateId: debate.id,
          roundId: round1.id,
          watchers,
        }),
        referencedMessageIds: [],
      }),
    );
    this.#dispatchTracked(intent);
    this.#coordinatorBriefSent = true;
    this.#record(
      'Operator → Coordinator Round 1 prompt queued (rephrase + Watcher roles).',
    );
  }

  startRound1(problem: string): void {
    this.runLiveRound1(problem);
  }

  sendTestMessage(agentId: string, body: string): void {
    this.#requireStarted();
    const trimmed = body.trim();
    if (trimmed.length === 0) {
      throw new Error('test message cannot be empty');
    }
    const agent = this.#requireAgent(agentId);
    if (agent.role === 'operator') {
      throw new Error('cannot send a test message to the Operator');
    }
    const debate = this.#debate();
    const intent = this.planner.plan(
      createDispatchPlan({
        messageId: this.#nextId('msg-test'),
        debateId: debate.id,
        senderId: OPERATOR_ID,
        recipients: {
          type: 'explicit-agents',
          agentIds: [agent.id],
        },
        kind: 'input',
        body: trimmed,
        referencedMessageIds: [],
      }),
    );
    this.#dispatchTracked(intent);
    this.#record(`Test message queued for ${agent.name} (${agent.id}).`);
  }

  noteBinding(input: {
    agentId: string;
    provider?: string;
    tabId?: string;
    available: boolean;
    error?: string;
  }): void {
    const agent = this.#requireAgent(input.agentId);
    const previous = this.#bindings.get(agent.id);
    if (!input.available) {
      this.#bindings.delete(agent.id);
      this.#presence.delete(agent.id);
      if (previous !== undefined) {
        this.#emit('BINDING_CHANGED', {
          agentId: agent.id,
          correlationId: `agent:${agent.id}`,
          payload: {
            agentId: agent.id,
            available: false,
            state: 'not-bound',
          },
        });
      }
      this.#record(`Browser binding cleared for ${agent.name}.`);
      return;
    }
    const next = {
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.tabId ? { tabId: input.tabId } : {}),
      lastSeen: Date.now(),
      available: true,
      ...(input.error ? { error: input.error } : {}),
    };
    this.#bindings.set(agent.id, next);
    const state = this.#bindingSnapshot(agent, Date.now()).state;
    if (
      previous === undefined ||
      previous.available !== next.available ||
      previous.provider !== next.provider
    ) {
      this.#emit('BINDING_CHANGED', {
        agentId: agent.id,
        correlationId: `agent:${agent.id}`,
        payload: {
          agentId: agent.id,
          ...(next.provider !== undefined ? { provider: next.provider } : {}),
          available: next.available,
          state,
        },
      });
    }
    this.#record(
      `Browser binding set for ${agent.name}${input.provider ? ` (${input.provider})` : ''}.`,
    );
  }

  notePresence(input: {
    agentId: string;
    provider?: string;
    phase?: string;
    error?: string;
    diagnostics?: unknown;
    capture?: unknown;
  }): void {
    const agent = this.#requireAgent(input.agentId);
    const previous = this.#presence.get(agent.id);
    let phase = asPhase(input.phase);
    const capture = asCaptureState(input.capture) ?? previous?.capture;
    if (
      phase === 'waiting' &&
      capture?.phase === 'failed' &&
      previous?.phase === 'error'
    ) {
      phase = 'error';
    }
    const error =
      input.error ??
      (phase === 'sending' ||
      phase === 'captured' ||
      phase === 'waiting' ||
      phase === 'generating' ||
      phase === 'capturing'
        ? undefined
        : previous?.error);
    this.#presence.set(agent.id, {
      agentId: agent.id,
      ...(input.provider
        ? { provider: input.provider }
        : previous?.provider
          ? { provider: previous.provider }
          : {}),
      phase,
      ...(error ? { error } : {}),
      lastSeen: Date.now(),
      ...(input.diagnostics !== undefined
        ? { diagnostics: input.diagnostics }
        : previous?.diagnostics !== undefined
          ? { diagnostics: previous.diagnostics }
          : {}),
      ...(capture ? { capture } : {}),
    });
    if (phase === 'error' && error) {
      this.#lastError = `${agent.name}: ${error}`;
    } else if (
      phase === 'captured' ||
      phase === 'sending' ||
      (phase === 'waiting' && !error)
    ) {
      if (this.#lastError?.startsWith(`${agent.name}:`)) {
        this.#lastError = undefined;
      }
    }
    if (
      !this.#freezeRestoredSideEffects &&
      capture?.phase === 'failed' &&
      capture.deliveryId
    ) {
      const delivery = this.transport.getDelivery(asDeliveryId(capture.deliveryId));
      const reason = capture.reason ?? error ?? 'capture failed';
      if (capture.promptSubmitted === false) {
        this.orchestrator.failPromptDispatch({
          deliveryId: capture.deliveryId,
          recipientId: agent.id,
          debateId: delivery?.debateId,
          roundId: delivery?.roundId,
          messageId: delivery?.messageId,
          reason,
        });
      } else {
        this.orchestrator.failCapture({
          deliveryId: capture.deliveryId,
          recipientId: agent.id,
          debateId: delivery?.debateId,
          roundId: delivery?.roundId,
          reason,
        });
      }
    }
    const existing = this.#bindings.get(agent.id);
    if (existing?.available) {
      this.#bindings.set(agent.id, {
        ...existing,
        lastSeen: Date.now(),
        ...(input.provider ? { provider: input.provider } : {}),
        ...(phase === 'error' && error ? { error } : {}),
      });
    }
    if (
      !this.#freezeRestoredSideEffects &&
      capture?.phase === 'failed' &&
      capture.deliveryId
    ) {
      this.#debugTransition(
        agent.id,
        'capture-failed',
        `${capture.deliveryId}: ${capture.reason ?? error ?? 'capture failed'}`,
      );
    }
  }

  /**
   * Receive the latest ephemeral managed-browser debug state. Latest-wins,
   * in-memory only; malformed payloads are ignored. This is not an event.
   */
  noteManagedDebugState(input: unknown): void {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      return;
    }
    const record = input as Record<string, unknown>;
    const providers = record.providers;
    if (!Array.isArray(providers)) {
      return;
    }
    for (const raw of providers) {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        continue;
      }
      const item = raw as Record<string, unknown>;
      const providerId =
        typeof item.providerId === 'string' ? item.providerId : undefined;
      if (providerId === undefined || providerId.length === 0) {
        continue;
      }
      this.#managedDebug.set(providerId, normalizeManagedDebugState(item));
    }
    this.#managedDebugMeta = {
      ...(typeof record.pushedAt === 'number' ? { pushedAt: record.pushedAt } : {}),
      ...(typeof record.restoring === 'boolean'
        ? { restoring: record.restoring }
        : {}),
      ...(typeof record.sendTraceEnabled === 'boolean'
        ? { sendTraceEnabled: record.sendTraceEnabled }
        : {}),
    };
  }

  /** Compose the /api/debug/providers observatory view. */
  debugProviders(): DebugProvidersView {
    const now = Date.now();
    const agentIds = new Set<string>();
    for (const agent of this.agents.list()) {
      if (agent.role !== 'operator') {
        agentIds.add(agent.id);
      }
    }
    for (const providerId of this.#managedDebug.keys()) {
      agentIds.add(providerId);
    }
    const providers = [...agentIds]
      .sort()
      .map((agentId) => this.#debugProviderCard(agentId, now));
    const latestAction = this.#latestCoordinatorActionSummary();
    const question = this.#pendingOperatorQuestionSnapshot();
    const hasActiveConsultation = this.#activeConsultationRound() !== undefined;
    const activeCoordinatorAction =
      hasActiveConsultation || question || this.#awaitingOperator()
        ? {
            stepIndex: this.#coordinatorStepIndex,
            ...(latestAction
              ? {
                  action: latestAction.action,
                  ...(latestAction.deliveryIds
                    ? { deliveryIds: latestAction.deliveryIds }
                    : {}),
                }
              : {}),
            pendingDeliveryIds: [...this.#pendingStepDeliveryIds],
            decisionPending: this.#coordinatorDecisionPending,
            awaitingOperator: this.#awaitingOperator(),
            ...(question
              ? {
                  operatorQuestion: {
                    question: question.question,
                    createdAt: question.createdAt,
                  },
                }
              : {}),
          }
        : null;
    const recent = [
      ...this.#debugTransitions.map((item) => ({
        at: item.at,
        source: 'runtime',
        ...(item.agentId !== undefined ? { agentId: item.agentId } : {}),
        label: item.label,
        ...(item.detail !== undefined ? { detail: item.detail } : {}),
      })),
      ...[...this.#managedDebug.values()].flatMap((state) =>
        (state.transitions ?? []).map((item) => ({
          at: item.at,
          source: 'managed',
          agentId: state.providerId,
          label: item.label,
          ...(item.detail !== undefined ? { detail: item.detail } : {}),
        })),
      ),
    ]
      .sort((a, b) => b.at - a.at)
      .slice(0, 60);
    return {
      now: new Date(now).toISOString(),
      restoring: this.#managedDebugMeta.restoring ?? false,
      sendTraceEnabled: this.#managedDebugMeta.sendTraceEnabled ?? false,
      providers,
      activeCoordinatorAction,
      recentTransitions: recent.map((item) => ({
        at: new Date(item.at).toISOString(),
        source: item.source,
        ...(item.agentId !== undefined ? { agentId: item.agentId } : {}),
        label: item.label,
        ...(item.detail !== undefined ? { detail: item.detail } : {}),
      })),
    };
  }

  #debugTransition(
    agentId: string | undefined,
    label: string,
    detail?: string,
  ): void {
    this.#debugTransitions.push({
      at: Date.now(),
      ...(agentId !== undefined ? { agentId } : {}),
      label,
      ...(detail !== undefined ? { detail } : {}),
    });
    if (this.#debugTransitions.length > 120) {
      this.#debugTransitions.splice(0, this.#debugTransitions.length - 120);
    }
  }

  #debugProviderCard(agentId: string, now: number): DebugProviderCard {
    const agent = this.agents.getById(asAgentId(agentId));
    const managed = this.#managedDebug.get(agentId);
    const presence = this.#presence.get(agentId);
    const debate = this.#focusDebate();
    const deliveries = debate
      ? this.transport
          .listAll()
          .filter(
            (delivery) =>
              delivery.recipientId === agentId &&
              delivery.debateId === debate.id,
          )
      : [];
    const latest = deliveries.at(-1);
    const capture =
      presence?.capture &&
      (latest === undefined ||
        presence.capture.deliveryId === undefined ||
        presence.capture.deliveryId === latest.id)
        ? presence.capture
        : undefined;
    const inDoubt =
      latest &&
      this.#replayResult.externalActions.some(
        (action) =>
          action.deliveryId === latest.id && action.state === 'IN_DOUBT',
      );
    const captureActive =
      capture !== undefined &&
      [
        'snapshot',
        'prompt-submitted',
        'waiting-for-new-turn',
        'generating',
        'reading-final-response',
      ].includes(capture.phase);
    const captureFailed = capture?.phase === 'failed';
    const deliveryError =
      presence?.error ??
      (captureFailed ? (capture?.reason ?? 'capture failed') : undefined);

    let deliveryState: DebugDeliveryState;
    if (latest === undefined) {
      deliveryState = 'none';
    } else if (captureFailed || presence?.phase === 'error') {
      deliveryState = 'failed';
    } else if (inDoubt) {
      deliveryState = 'in_doubt';
    } else if (latest.status === 'pending') {
      deliveryState = presence?.phase === 'sending' ? 'sending' : 'pending';
    } else if (latest.status === 'delivered') {
      deliveryState = captureActive ? 'awaiting_response' : 'submitted';
    } else {
      deliveryState = 'responded';
    }

    const managedTransitions = managed?.transitions ?? [];
    const sendError = managed?.send?.error;
    const sendState: DebugSendState = managed?.send?.state ?? 'unknown';

    let assistantTurn: DebugAssistantTurnState = 'none';
    if (capture !== undefined) {
      if (capture.phase === 'waiting-for-new-turn') {
        assistantTurn =
          capture.reason === 'new-turn-timeout' ? 'waiting_for_new' : 'waiting_for_new';
      } else if (
        capture.trackedIdentity !== undefined ||
        [
          'generating',
          'reading-final-response',
          'captured',
          'failed',
        ].includes(capture.phase)
      ) {
        assistantTurn = 'detected';
      }
    }

    let generation: DebugGenerationState = 'unknown';
    if (capture !== undefined) {
      if (capture.phase === 'captured' || capture.phase === 'failed') {
        generation = 'ended';
      } else if (capture.phase === 'generating') {
        generation = 'active';
      } else if (capture.phase === 'reading-final-response') {
        generation = 'ended';
      } else {
        generation = 'idle';
      }
    } else if (managed?.generation?.state) {
      generation = managed.generation.state;
    } else if (presence?.phase === 'generating') {
      generation = 'active';
    }

    let captureView: DebugCaptureState = 'idle';
    if (capture !== undefined) {
      if (capture.phase === 'reading-final-response') {
        captureView = 'reading';
      } else if (capture.phase === 'captured') {
        captureView = 'captured';
      } else if (capture.phase === 'failed') {
        captureView = 'failed';
      } else {
        captureView = 'waiting';
      }
    }

    const coordinatorProtocol = this.#debugCoordinatorProtocol(agent, capture);

    const lastChangedAt = Math.max(
      presence?.lastSeen ?? 0,
      managed?.lastChangedAt ?? 0,
    );

    return {
      agentId,
      providerId: managed?.providerId ?? agentId,
      label: agent?.name ?? managed?.providerId ?? agentId,
      role: agent?.role,
      managed: managed !== undefined,
      session: {
        state: managed?.session?.state ?? 'unknown',
        ...(managed?.session?.detail !== undefined
          ? { detail: managed.session.detail }
          : {}),
      },
      page: {
        state: managed?.page?.state ?? 'unknown',
        ...(managed?.page?.url !== undefined ? { url: managed.page.url } : {}),
      },
      conversation: {
        state: managed?.conversation?.state ?? 'unknown',
        ...(managed?.conversation?.conversationId !== undefined
          ? { conversationId: managed.conversation.conversationId }
          : {}),
      },
      delivery: {
        state: deliveryState,
        ...(latest !== undefined ? { deliveryId: latest.id } : {}),
        ...(deliveryError !== undefined && deliveryState === 'failed'
          ? { error: deliveryError }
          : {}),
      },
      send: { state: sendState, ...(sendError !== undefined ? { error: sendError } : {}) },
      assistantTurn: { state: assistantTurn },
      generation: { state: generation },
      capture: {
        state: captureView,
        ...(capture?.reason !== undefined ? { reason: capture.reason } : {}),
        ...(capture?.textLength !== undefined
          ? { textLength: capture.textLength }
          : {}),
        ...(capture?.preSendTurnCount !== undefined
          ? { preSendTurnCount: capture.preSendTurnCount }
          : {}),
        ...(capture?.currentTurnCount !== undefined
          ? { currentTurnCount: capture.currentTurnCount }
          : {}),
        ...(capture?.trackedIdentity !== undefined
          ? { trackedIdentity: capture.trackedIdentity }
          : {}),
        ...(capture?.generationEndedAt !== undefined
          ? { generationEndedAt: capture.generationEndedAt }
          : {}),
        ...(capture?.capturedAt !== undefined
          ? { capturedAt: capture.capturedAt }
          : {}),
        ...(capture?.domChangedAfterTerminal !== undefined
          ? { domChangedAfterTerminal: capture.domChangedAfterTerminal }
          : {}),
        ...(capture?.domChangedAfterCapture !== undefined
          ? { domChangedAfterCapture: capture.domChangedAfterCapture }
          : {}),
      },
      coordinatorProtocol,
      presencePhase: presence?.phase ?? 'idle',
      ...(presence?.error !== undefined || managed?.lastError !== undefined
        ? { lastError: presence?.error ?? managed?.lastError }
        : {}),
      ...(lastChangedAt > 0 ? { lastChangedAt: new Date(lastChangedAt).toISOString() } : {}),
      pipeline: this.#debugPipeline(agentId, managedTransitions),
      transitions: managedTransitions
        .slice(-20)
        .reverse()
        .map((item) => ({
          at: new Date(item.at).toISOString(),
          label: item.label,
          ...(item.detail !== undefined ? { detail: item.detail } : {}),
        })),
      details: {
        ...(managed?.page?.visible !== undefined
          ? { windowVisible: managed.page.visible }
          : {}),
        restoreActive: this.#managedDebugMeta.restoring ?? false,
        sendTraceEnabled: this.#managedDebugMeta.sendTraceEnabled ?? false,
        ...(managed?.page?.url !== undefined ? { url: managed.page.url } : {}),
        ...(managed?.probe?.url !== undefined ? { probeUrl: managed.probe.url } : {}),
        ...(managed?.probe?.hasComposer !== undefined
          ? { hasComposer: managed.probe.hasComposer }
          : {}),
        ...(managed?.probe?.hasSend !== undefined
          ? { hasSend: managed.probe.hasSend }
          : {}),
        ...(managed?.probe?.generating !== undefined
          ? { probeGenerating: managed.probe.generating }
          : {}),
        ...(now - (presence?.lastSeen ?? 0) < CONNECTED_MS
          ? { lastSeen: new Date(presence?.lastSeen ?? now).toISOString() }
          : {}),
      },
    };
  }

  #debugCoordinatorProtocol(
    agent: Agent | undefined,
    capture: BrowserCaptureState | undefined,
  ): DebugProviderCard['coordinatorProtocol'] {
    if (agent === undefined || agent.role !== 'coordinator') {
      return { state: 'not_applicable' };
    }
    const protocol = this.#coordinatorProtocolDebug;
    if (protocol === undefined) {
      return { state: 'not_started' };
    }
    // A newer Coordinator capture that has not been parsed yet reads as
    // parsing — precise by delivery id, never inferred from timers.
    const newerCapturePendingParse =
      protocol.state === 'valid' &&
      capture?.phase === 'captured' &&
      capture.deliveryId !== undefined &&
      capture.deliveryId !== protocol.deliveryId;
    if (newerCapturePendingParse) {
      return { state: 'parsing' };
    }
    return {
      state: protocol.state,
      ...(protocol.error !== undefined ? { error: protocol.error } : {}),
      ...(protocol.stepIndex !== undefined ? { stepIndex: protocol.stepIndex } : {}),
      ...(protocol.action !== undefined ? { action: protocol.action } : {}),
    };
  }

  #debugPipeline(
    agentId: string,
    managedTransitions: readonly { readonly at: number; readonly label: string; readonly detail?: string }[],
  ): readonly DebugPipelineStage[] {
    type Entry = { at: number; label: string; detail?: string; source: 'managed' | 'runtime' };
    const entries: Entry[] = [
      ...managedTransitions.map((item) => ({ ...item, source: 'managed' as const })),
      ...this.#debugTransitions
        .filter((item) => item.agentId === agentId)
        .map((item) => ({ at: item.at, label: item.label, detail: item.detail, source: 'runtime' as const })),
    ];
    const findLast = (labels: readonly string[]): Entry | undefined =>
      entries
        .filter((item) => labels.includes(item.label))
        .sort((a, b) => a.at - b.at)
        .at(-1);
    const stage = (
      name: string,
      labels: readonly string[],
      failLabels: readonly string[] = [],
    ): DebugPipelineStage => {
      const done = findLast(labels);
      const failed = failLabels.length > 0 ? findLast(failLabels) : undefined;
      if (failed && (!done || failed.at >= done.at)) {
        return { stage: name, state: 'failed', at: new Date(failed.at).toISOString(), ...(failed.detail !== undefined ? { detail: failed.detail } : {}) };
      }
      if (done) {
        return { stage: name, state: 'completed', at: new Date(done.at).toISOString(), ...(done.detail !== undefined ? { detail: done.detail } : {}) };
      }
      return { stage: name, state: 'not_started' };
    };
    const stages = [
      stage('Provider session ready', ['session-connected']),
      stage('Page ready', ['page-ready']),
      stage('Delivery selected', ['delivery-selected']),
      stage('Send started', ['send-started'], ['send-failed']),
      stage('Submit accepted', ['submit-accepted', 'new-turn-detected'], ['send-failed']),
      stage('New assistant turn', ['new-turn-detected']),
      stage('Generation active', ['generation-active']),
      stage('Generation ended', ['generation-ended']),
      stage('Response captured', ['response-captured', 'capture-captured'], ['capture-failed']),
      stage('Coordinator parsed', ['coordinator-parsed'], ['coordinator-invalid']),
      stage('Next action', ['coordinator-reinvoked']),
    ];
    // The furthest completed stage before a failure is the active one.
    let furthest = -1;
    let furthestAt = 0;
    stages.forEach((item, index) => {
      if (item.state === 'completed' && item.at !== undefined) {
        const at = Date.parse(item.at);
        if (at >= furthestAt) {
          furthestAt = at;
          furthest = index;
        }
      }
    });
    const failedIndex = stages.findIndex((item) => item.state === 'failed');
    if (furthest >= 0 && (failedIndex === -1 || furthest < failedIndex)) {
      const current = stages[furthest];
      if (current && current.state === 'completed') {
        stages[furthest] = { ...current, state: 'active' };
      }
    }
    return stages;
  }

  listAgents(): readonly Agent[] {
    return this.agents.list();
  }

  nextPendingForAgent(agentId: string): PendingBrowserJob | undefined {
    if (!this.#started) {
      return undefined;
    }
    return this.#jobFromDelivery(this.#resolveCorrelatedWork(agentId, 'pending'));
  }

  awaitingResponseForAgent(agentId: string): PendingBrowserJob | undefined {
    if (!this.#started) {
      return undefined;
    }
    return this.#jobFromDelivery(
      this.#resolveCorrelatedWork(agentId, 'delivered'),
    );
  }

  /**
   * Correlate capture/send work to the active debate + current Coordinator
   * action/delivery — never “newest Map entry” and never cross-debate fallback.
   *
   * 0 matches → no job (attention if stale leftovers exist)
   * 1 match → that delivery
   * >1 matches → attention / recovery; do not choose silently
   */
  #resolveCorrelatedWork(
    agentId: string,
    status: 'pending' | 'delivered',
  ): OutboundDelivery | undefined {
    const agent = this.#requireAgent(agentId);
    const debate = this.#activeDebate();
    if (debate === undefined) {
      return undefined;
    }

    const pool =
      status === 'pending'
        ? this.transport.listPendingForAgent(agent.id)
        : this.transport.listAwaitingResponseForAgent(agent.id);
    const inDebate = pool.filter((item) => item.debateId === debate.id);

    const correlatedIds = this.#correlatedDeliveryIdsForAgent(agent);
    const eligible =
      correlatedIds === undefined
        ? []
        : inDebate.filter((item) => correlatedIds.has(item.id));

    if (eligible.length === 1) {
      return eligible[0];
    }

    if (eligible.length > 1) {
      this.#noteCaptureAttention(
        agent.id,
        `${eligible.length} correlated ${status} deliveries for ${agent.name}; Operator recovery required.`,
      );
      return undefined;
    }

    // Zero correlated matches. Stale in-debate leftovers are an invariant
    // problem — quarantine them; do not fall back to any of them.
    if (inDebate.length > 0 && correlatedIds !== undefined) {
      for (const leftover of inDebate) {
        if (!correlatedIds.has(leftover.id)) {
          this.#quarantineDelivery(
            leftover.id,
            'SUPERSEDED',
            `stale ${status} delivery outside current Coordinator step`,
          );
        }
      }
    } else if (inDebate.length > 1 && correlatedIds === undefined) {
      this.#noteCaptureAttention(
        agent.id,
        `${inDebate.length} ${status} deliveries with no correlated Coordinator step; recovery required.`,
      );
    } else if (inDebate.length === 1 && correlatedIds === undefined) {
      // Safe restore path: exactly one in-debate job and we lost the pointer
      // (e.g. mid-replay). Adopt it rather than inventing “newest”.
      const only = inDebate[0];
      if (only !== undefined && agent.role === 'coordinator') {
        this.#pendingCoordinatorDeliveryId = only.id;
      }
      return only;
    }

    return undefined;
  }

  /**
   * Delivery ids that belong to the currently executing Coordinator action
   * for this agent. `undefined` means no correlated step is known yet.
   */
  #correlatedDeliveryIdsForAgent(agent: Agent): ReadonlySet<string> | undefined {
    if (agent.role === 'coordinator') {
      if (this.#pendingCoordinatorDeliveryId !== undefined) {
        return new Set([this.#pendingCoordinatorDeliveryId]);
      }
      return undefined;
    }
    if (this.#pendingStepDeliveryIds.size === 0) {
      return undefined;
    }
    const ids = new Set<string>();
    for (const deliveryId of this.#pendingStepDeliveryIds) {
      const delivery = this.transport.getDelivery(asDeliveryId(deliveryId));
      if (delivery?.recipientId === agent.id) {
        ids.add(deliveryId);
      }
    }
    return ids.size > 0 ? ids : undefined;
  }

  #noteCaptureAttention(agentId: string, message: string): void {
    this.#record(`CAPTURE ATTENTION: ${message}`);
    this.notePresence({
      agentId,
      phase: 'attention',
      error: message,
    });
  }

  #quarantineDelivery(
    deliveryId: string,
    reason: 'IN_DOUBT' | 'SUPERSEDED' | 'FAILED',
    detail?: string,
  ): void {
    if (this.transport.isQuarantined(deliveryId)) {
      return;
    }
    const delivery = this.transport.getDelivery(asDeliveryId(deliveryId));
    if (delivery === undefined) {
      return;
    }
    this.transport.quarantineDelivery(deliveryId, reason, detail);
    this.#emit('DELIVERY_QUARANTINED', {
      debateId: delivery.debateId,
      ...(delivery.roundId !== undefined ? { roundId: delivery.roundId } : {}),
      agentId: delivery.recipientId,
      correlationId: `delivery:${deliveryId}`,
      payload: {
        deliveryId,
        reason,
        ...(detail ? { detail } : {}),
        status: delivery.status,
      },
    });
    this.#record(
      `Delivery ${deliveryId} quarantined (${reason}${detail ? `: ${detail}` : ''}).`,
    );
    this.#debugTransition(
      delivery.recipientId,
      'delivery-quarantined',
      `${reason}${detail ? `: ${detail}` : ''}`,
    );
  }

  #adoptCoordinatorDelivery(deliveryId: string): void {
    const debate = this.#activeDebate();
    const coordinator = this.agents.listByRole('coordinator')[0];
    if (debate !== undefined && coordinator !== undefined) {
      const previous = this.#pendingCoordinatorDeliveryId;
      if (previous !== undefined && previous !== deliveryId) {
        this.#quarantineDelivery(
          previous,
          'SUPERSEDED',
          'replaced by a newer Coordinator prompt delivery',
        );
      }
      for (const pending of this.transport.listPendingForAgent(coordinator.id)) {
        if (pending.debateId === debate.id && pending.id !== deliveryId) {
          this.#quarantineDelivery(
            pending.id,
            'SUPERSEDED',
            'stale Coordinator pending outside current prompt',
          );
        }
      }
      for (const awaiting of this.transport.listAwaitingResponseForAgent(
        coordinator.id,
      )) {
        if (awaiting.debateId === debate.id && awaiting.id !== deliveryId) {
          this.#quarantineDelivery(
            awaiting.id,
            'SUPERSEDED',
            'stale Coordinator awaiting outside current prompt',
          );
        }
      }
    }
    this.#pendingCoordinatorDeliveryId = deliveryId;
  }

  #setPendingStepDeliveries(deliveryIds: readonly string[]): void {
    const next = new Set(deliveryIds);
    for (const oldId of this.#pendingStepDeliveryIds) {
      if (!next.has(oldId)) {
        const delivery = this.transport.getDelivery(asDeliveryId(oldId));
        if (delivery !== undefined && delivery.status !== 'responded') {
          this.#quarantineDelivery(
            oldId,
            'SUPERSEDED',
            'left behind when Coordinator advanced to a new action step',
          );
        }
      }
    }
    this.#pendingStepDeliveryIds = next;
  }

  #dispatchTracked(intent: DispatchIntent): readonly OutboundDelivery[] {
    const deliveries = this.orchestrator.dispatch(intent);
    for (const delivery of deliveries) {
      const recipient = this.agents.getById(delivery.recipientId);
      if (recipient?.role === 'coordinator') {
        this.#adoptCoordinatorDelivery(delivery.id);
      }
    }
    return deliveries;
  }

  /**
   * Explicit Operator recovery when a response is visible but automatic
   * capture failed. Emits CAPTURE_SALVAGED_BY_OPERATOR provenance — never
   * count this as happy-path capture success.
   */
  salvageVisibleResponse(
    agentId: string,
    deliveryId: string,
    body: string,
  ): void {
    this.#requireStarted();
    const agent = this.#requireAgent(agentId);
    const delivery = this.transport.getDelivery(asDeliveryId(deliveryId));
    if (delivery === undefined) {
      throw new Error(`unknown delivery: ${deliveryId}`);
    }
    if (delivery.recipientId !== agent.id) {
      throw new Error(
        `agent ${agentId} cannot salvage delivery ${deliveryId}`,
      );
    }
    this.#emit('CAPTURE_SALVAGED_BY_OPERATOR', {
      debateId: delivery.debateId,
      ...(delivery.roundId !== undefined ? { roundId: delivery.roundId } : {}),
      agentId: agent.id,
      correlationId: `delivery:${deliveryId}`,
      payload: {
        deliveryId,
        bodyLength: body.trim().length,
        provenance: 'operator-visible-response',
      },
    });
    this.#record(
      `CAPTURE_SALVAGED_BY_OPERATOR for ${agent.name} delivery ${deliveryId}.`,
    );
    this.submitCapturedResponse(agentId, deliveryId, body);
  }

  acknowledgeDelivery(agentId: string, deliveryId: string): OutboundDelivery {
    this.#requireStarted();
    const agent = this.#requireAgent(agentId);
    const delivery = this.transport.getDelivery(asDeliveryId(deliveryId));
    if (delivery === undefined) {
      throw new Error(`unknown delivery: ${deliveryId}`);
    }
    if (delivery.recipientId !== agent.id) {
      throw new Error(
        `agent ${agentId} cannot acknowledge delivery ${deliveryId}`,
      );
    }

    // Managed browser + extension can both ACK the same job. Treat already
    // delivered/responded as success so the losing racer does not surface a
    // red "delivery already confirmed" error while the model is still working.
    if (delivery.status === 'delivered' || delivery.status === 'responded') {
      return delivery;
    }

    const confirmed =
      delivery.roundId === undefined
        ? this.orchestrator.confirmDelivery(deliveryId)
        : this.workflow.confirmDelivery(delivery.roundId, deliveryId);
    this.#record(`Delivery ${deliveryId} marked delivered.`);
    this.#debugTransition(agent.id, 'delivery-confirmed', deliveryId);
    return confirmed;
  }

  submitCapturedResponse(
    agentId: string,
    deliveryId: string,
    body: string,
  ): void {
    this.#requireStarted();
    const agent = this.#requireAgent(agentId);
    const delivery = this.transport.getDelivery(asDeliveryId(deliveryId));
    if (delivery === undefined) {
      throw new Error(`unknown delivery: ${deliveryId}`);
    }
    if (delivery.recipientId !== agent.id) {
      throw new Error(
        `agent ${agentId} cannot submit a response for delivery ${deliveryId}`,
      );
    }

    const inbound =
      delivery.roundId === undefined
        ? this.orchestrator.submitResponse({
            deliveryId,
            responderId: agent.id,
            body,
          })
        : this.workflow.submitResponse(delivery.roundId, {
            deliveryId,
            responderId: agent.id,
            body,
          });
    this.#record(`Captured response for ${agent.name} (${agent.role}).`);
    this.notePresence({ agentId: agent.id, phase: 'captured' });
    this.#debugTransition(agent.id, 'response-captured', deliveryId);

    if (agent.role === 'coordinator') {
      if (this.#pendingCoordinatorDeliveryId === deliveryId) {
        this.#pendingCoordinatorDeliveryId = undefined;
      }
      this.#coordinatorProtocolDebug = {
        state: 'parsing',
        at: Date.now(),
        deliveryId,
      };
      this.#handleCoordinatorResponse(inbound.message.body, deliveryId);
      return;
    }

    this.#advanceAfterWatcherResponse();
  }

  snapshot(): RayzanSnapshot {
    const debateRecord = this.#focusDebate();
    const activeDebate = this.#activeDebate();
    const debateHistory = this.#historyDebates().map((debate) =>
      this.#debateView(debate),
    );
    const round1 = this.#roundByNumber(1);
    const round2 = this.#roundByNumber(2);
    const rounds = debateRecord
      ? this.rounds.listByDebate(debateRecord.id).map((round) => ({
          id: round.id,
          number: round.number,
          status: round.status,
        }))
      : [];
    const checkpointRecord = this.#latestCheckpoint();
    const checkpointRound = checkpointRecord
      ? this.rounds.getById(checkpointRecord.roundId)
      : undefined;
    let roundProgress;
    if (this.#started && round1) {
      try {
        const progress = this.workflow.getRoundProgress(round1.id);
        roundProgress = {
          responded: progress.responded,
          expected: progress.expected,
          complete: progress.complete,
        };
      } catch {
        roundProgress = undefined;
      }
    }

    const now = Date.now();
    const round1Responses = this.#round1Responses().map((response) => ({
      name: response.name,
      body: response.body,
    }));
    const coordinatorPlan = this.#coordinatorPlanSnapshot();
    const synthesis = this.#synthesisRecord();

    return Object.freeze({
      bridge: 'connected',
      sessionStarted: this.#started,
      restoredFromHistory: this.#restoredFromHistory,
      debateHistory,
      ...(debateRecord ? { debate: this.#debateView(debateRecord) } : {}),
      ...(activeDebate ? { activeDebate: this.#debateView(activeDebate) } : {}),
      ...(round1
        ? {
            round: {
              id: round1.id,
              number: round1.number,
              status: round1.status,
            },
            round1: {
              id: round1.id,
              number: round1.number,
              status: round1.status,
            },
          }
        : {}),
      ...(round2
        ? {
            round2: {
              id: round2.id,
              number: round2.number,
              status: round2.status,
            },
          }
        : {}),
      rounds,
      awaitingOperator: this.#awaitingOperator(),
      ...(this.#pendingOperatorQuestionSnapshot()
        ? { operatorQuestion: this.#pendingOperatorQuestionSnapshot() }
        : {}),
      ...(checkpointRecord && checkpointRound
        ? {
            checkpoint: {
              debateId: checkpointRecord.debateId,
              roundId: checkpointRecord.roundId,
              roundNumber: checkpointRound.number,
              body: checkpointRecord.body,
              recommendation: checkpointRecord.recommendation,
              createdAt: checkpointRecord.createdAt,
            },
          }
        : {}),
      agents: this.agents.list().map((agent) => {
        const presence = this.#presence.get(agent.id);
        const response = this.#latestResponseFrom(agent.id);
        return {
          id: agent.id,
          name: agent.name,
          role: agent.role,
          ...(() => {
            const provider = this.#providerFor(agent.id);
            return provider !== undefined ? { provider } : {};
          })(),
          connected:
            presence !== undefined && now - presence.lastSeen < CONNECTED_MS,
          phase: presence?.phase ?? 'idle',
          ...(presence?.error ? { error: presence.error } : {}),
          ...(response ? { response } : {}),
          round1Status: this.#round1Status(agent),
          round2Status: this.#round2Status(agent),
          roundStatuses: rounds.map((round) => ({
            number: round.number,
            status:
              agent.role === 'watcher'
                ? this.#roundStatus(agent, round.id)
                : 'idle',
          })),
          enabled: this.#watcherEnabled(agent),
          ...(presence?.capture ? { capture: presence.capture } : {}),
        };
      }),
      deliveries: this.transport.listAll().map((delivery) => {
        const recipientPresence = this.#presence.get(delivery.recipientId);
        const capture =
          recipientPresence?.capture?.deliveryId === delivery.id
            ? recipientPresence.capture
            : undefined;
        return {
          id: delivery.id,
          messageId: delivery.messageId,
          senderId: delivery.senderId,
          recipientId: delivery.recipientId,
          status: delivery.status,
          ...(delivery.roundId !== undefined
            ? { roundId: delivery.roundId }
            : {}),
          ...(capture ? { capture } : {}),
        };
      }),
      ...(roundProgress ? { roundProgress } : {}),
      participants: this.#safeParticipants(round1?.id),
      protocol: {
        messages: debateRecord
          ? this.messages.listByDebate(debateRecord.id).length
          : 0,
        deliveries: this.transport.listAll().length,
        exposures: debateRecord
          ? this.exposures.listByDebate(debateRecord.id).length
          : 0,
      },
      browserBindings: this.agents
        .list()
        .filter((agent) => agent.role !== 'operator')
        .map((agent) => this.#bindingSnapshot(agent, now)),
      timeline: this.#timeline(),
      round1Responses,
      ...(coordinatorPlan ? { coordinatorPlan } : {}),
      round2Messages: this.#round2Messages(),
      ...(synthesis ? { synthesis } : {}),
      synthesisPending: this.#synthesisQueued && synthesis === undefined,
      ...(this.#lastCommands && this.#activeDebate() !== undefined
        ? { lastCommands: this.#lastCommands }
        : {}),
      ...(this.#lastError && this.#activeDebate() !== undefined
        ? { lastError: this.#lastError }
        : {}),
      ...(this.#activeDebate() !== undefined &&
      !this.#round1Dispatched &&
      this.#coordinatorCommandText() !== undefined
        ? { canRetryCoordinatorDispatch: true }
        : {}),
      log: [...this.#log],
      eventLog: this.#eventLog(),
      eventDetails: this.#eventDetailsLog(),
      externalActionRecovery: this.#externalActionRecoveryLog(),
      messages: debateRecord
        ? this.messages.listByDebate(debateRecord.id).map((message) => ({
            id: message.id,
            senderId: message.senderId,
            recipientIds: [...message.recipientIds],
            kind: message.kind,
            body: message.body,
            ...(message.roundId !== undefined
              ? { roundId: message.roundId }
              : {}),
          }))
        : [],
      watcherContributions: this.#watcherContributions(),
      ...(this.#activeConsultationRound()
        ? {
            coordinatorAction: {
              stepIndex: this.#coordinatorStepIndex,
              pendingDeliveryIds: [...this.#pendingStepDeliveryIds],
              terminalDeliveryIds: this.#terminalStepDeliveryIds(),
              decisionPending: this.#coordinatorDecisionPending,
              latestAction: this.#latestCoordinatorActionSummary(),
              roundStatus: this.#activeConsultationRound()?.status,
              awaitingOperator: this.#awaitingOperator(),
            },
          }
        : this.#awaitingOperator()
          ? {
              coordinatorAction: {
                stepIndex: this.#coordinatorStepIndex,
                pendingDeliveryIds: [],
                terminalDeliveryIds: [],
                decisionPending: false,
                latestAction: this.#latestCoordinatorActionSummary(),
                roundStatus: 'completed',
                awaitingOperator: true,
              },
            }
          : {}),
      replay: this.#replayResult,
    });
  }

  #terminalStepDeliveryIds(): readonly string[] {
    const ids: string[] = [];
    for (const deliveryId of this.#pendingStepDeliveryIds) {
      const delivery = this.transport.getDelivery(asDeliveryId(deliveryId));
      if (delivery?.status === 'responded') {
        ids.push(deliveryId);
      }
    }
    // Also include responded deliveries from the latest action payload.
    const latest = this.#latestCoordinatorActionSummary();
    if (latest?.deliveryIds) {
      for (const deliveryId of latest.deliveryIds) {
        const delivery = this.transport.getDelivery(asDeliveryId(deliveryId));
        if (delivery?.status === 'responded' && !ids.includes(deliveryId)) {
          ids.push(deliveryId);
        }
      }
    }
    return Object.freeze(ids);
  }

  #latestCoordinatorActionSummary():
    | {
        readonly stepIndex: number;
        readonly action: string;
        readonly deliveryIds?: readonly string[];
      }
    | undefined {
    const debate = this.#focusDebate();
    if (debate === undefined) {
      return undefined;
    }
    const event = this.events
      .listByDebate(debate.id)
      .filter((item) => item.type === 'COORDINATOR_ACTION_CREATED')
      .at(-1);
    if (event === undefined) {
      return undefined;
    }
    const payload = event.payload as {
      readonly stepIndex?: number;
      readonly action?: string;
      readonly deliveryIds?: readonly string[];
    };
    return {
      stepIndex:
        typeof payload.stepIndex === 'number' ? payload.stepIndex : 0,
      action: payload.action ?? 'unknown',
      ...(Array.isArray(payload.deliveryIds)
        ? { deliveryIds: payload.deliveryIds }
        : {}),
    };
  }

  #advanceAfterWatcherResponse(): void {
    this.#maybeAdvanceCoordinatorActionStep();
  }

  /**
   * After every Watcher delivery from the current Coordinator step is
   * responded, re-invoke the Coordinator instead of ending the round.
   */
  #maybeAdvanceCoordinatorActionStep(): void {
    if (this.#pendingStepDeliveryIds.size === 0) {
      return;
    }
    for (const deliveryId of this.#pendingStepDeliveryIds) {
      const delivery = this.transport.getDelivery(asDeliveryId(deliveryId));
      if (delivery === undefined || delivery.status !== 'responded') {
        return;
      }
    }
    const completedIds = [...this.#pendingStepDeliveryIds];
    this.#pendingStepDeliveryIds.clear();
    this.#record(
      `Coordinator action step complete (${completedIds.length} Watcher response(s)); re-invoking Coordinator.`,
    );
    this.#debugTransition(
      undefined,
      'coordinator-reinvoked',
      `step ${this.#coordinatorStepIndex} complete (${completedIds.length} response(s))`,
    );
    this.#queueCoordinatorNextAction(completedIds);
  }

  /** Legacy helpers — Round completion is now checkpoint-driven. */
  #maybeCompleteRound1(): void {
    return;
  }

  #ensureRound2Bootstrapped(): void {
    return;
  }

  #maybeCompleteRound2AndSynthesize(): void {
    return;
  }

  #ensureSynthesisQueued(): void {
    return;
  }

  #startNextRound(causationEventId: string, guidance?: string): void {
    const debate = this.#debate();
    const previous = this.#latestCheckpoint();
    const watchers = this.#debateWatchers();
    const number = this.rounds.listByDebate(debate.id).length + 1;
    const roundId = this.#nextId('round');
    this.rounds.create(createRound({ id: roundId, debateId: debate.id, number }));
    this.#emit('ROUND_CREATED', {
      debateId: debate.id,
      roundId,
      causationEventId,
      correlationId: `round:${roundId}`,
      payload: { number, participantIds: watchers.map((watcher) => watcher.id) },
    });
    this.workflow.startRound({
      roundId,
      participantIds: watchers.map((watcher) => watcher.id),
    });
    this.#round2Bootstrapped = true;
    this.#round2Dispatched = false;
    this.#pendingStepDeliveryIds.clear();
    this.#coordinatorStepIndex = 0;
    this.#coordinatorDecisionPending = true;
    this.#pendingOperatorQuestion = undefined;
    const coordinator = this.#requireSingleCoordinator();
    const intent = this.planner.plan(
      createDispatchPlan({
        messageId: this.#nextId('msg-coordinator-evidence'),
        debateId: debate.id,
        senderId: OPERATOR_ID,
        recipients: { type: 'explicit-agents', agentIds: [coordinator.id] },
        kind: 'input',
        body: coordinatorActionPrompt({
          problem: debate.topic,
          coordinatorId: coordinator.id,
          debateId: debate.id,
          roundId,
          roundNumber: number,
          watchers,
          evidencePacket: this.#boundedEvidence(),
          evidenceCatalog: formatEvidenceCatalog(this.#evidenceCatalogForDebate()),
          latestCheckpoint: previous?.body,
          intervention: guidance,
          stepContext: `Consultation Round ${number} started. Choose the next Rayzan action.`,
        }),
        referencedMessageIds: this.#recentResponseIds(),
      }),
    );
    this.#dispatchTracked(intent);
    this.#record(`Round ${number} created; Coordinator action step queued.`);
  }

  #queueCoordinatorCheckpoint(round: Round): void {
    if (this.checkpoints.getByRoundId(round.id) !== undefined || this.#checkpointQueued) {
      return;
    }
    const debate = this.#debate();
    const coordinator = this.#requireSingleCoordinator();
    const intent = this.planner.plan(
      createDispatchPlan({
        messageId: this.#nextId('msg-coordinator-checkpoint'),
        debateId: debate.id,
        senderId: OPERATOR_ID,
        recipients: { type: 'explicit-agents', agentIds: [coordinator.id] },
        kind: 'input',
        body: coordinatorCheckpointPrompt({
          coordinatorId: coordinator.id,
          debateId: debate.id,
          roundId: round.id,
          roundNumber: round.number,
          evidencePacket: this.#boundedEvidence(),
        }),
        referencedMessageIds: this.#recentResponseIds(),
      }),
    );
    this.#dispatchTracked(intent);
    this.#checkpointQueued = true;
    this.#record(`Round ${round.number} complete; Coordinator checkpoint queued.`);
  }

  #storeCoordinatorCheckpoint(text: string): void {
    const round = this.#latestCompletedRound();
    const debate = this.#debate();
    if (round === undefined || this.checkpoints.getByRoundId(round.id) !== undefined) {
      return;
    }
    const createdAt = new Date().toISOString();
    const recommendation = /Coordinator recommendation:\s*FINISH\b/i.test(text)
      ? 'finish'
      : 'continue';
    const checkpoint = createCoordinatorCheckpoint({
      debateId: debate.id,
      roundId: round.id,
      body: text,
      recommendation,
      createdAt,
    });
    this.checkpoints.store(checkpoint);
    this.#emit('COORDINATOR_CHECKPOINT_CREATED', {
      debateId: checkpoint.debateId,
      roundId: checkpoint.roundId,
      agentId: this.#requireSingleCoordinator().id,
      causationEventId: this.#lastEventId('ROUND_COMPLETED'),
      correlationId: `round:${checkpoint.roundId}`,
      payload: {
        body: checkpoint.body,
        recommendation: checkpoint.recommendation,
        createdAt: checkpoint.createdAt,
      },
    });
    this.#checkpointQueued = false;
    this.#record(`Coordinator checkpoint stored for Round ${round.number}.`);
  }

  #bootstrapRound2AndNotifyCoordinator(): void {
    if (this.#round2Bootstrapped) {
      return;
    }
    const watchers = this.#debateWatchers();
    const failed = watchers.find(
      (watcher) => this.#round1Status(watcher) === 'failed',
    );
    if (failed) {
      this.#lastError = `${failed.name}: Capture failed; Coordinator was not contacted.`;
      return;
    }
    const debate = this.#debate();
    const round2Id = this.#nextId('round');
    this.rounds.create(
      createRound({
        id: round2Id,
        debateId: debate.id,
        number: 2,
      }),
    );
    this.#emit('ROUND_CREATED', {
      debateId: debate.id,
      roundId: round2Id,
      causationEventId: this.#lastEventId('ROUND_COMPLETED'),
      correlationId: `round:${round2Id}`,
      payload: {
        number: 2,
        participantIds: watchers.map((watcher) => watcher.id),
      },
    });
    this.workflow.startRound({
      roundId: round2Id,
      participantIds: watchers.map((watcher) => watcher.id),
    });
    this.#round2Bootstrapped = true;
    this.#record(
      'Round 2 bootstrapped at application level (not start-round).',
    );

    const coordinator = this.#requireSingleCoordinator();
    const responses = this.#round1Responses();
    const evidencePacket = round1EvidencePacket({
      problem: debate.topic,
      coordinatorBrief: this.#coordinatorRound1Brief(),
      responses,
    });
    const intent = this.planner.plan(
      createDispatchPlan({
        messageId: this.#nextId('msg-coordinator-evidence'),
        debateId: debate.id,
        senderId: OPERATOR_ID,
        recipients: {
          type: 'explicit-agents',
          agentIds: [coordinator.id],
        },
        kind: 'input',
        body: coordinatorRound2Prompt({
          problem: debate.topic,
          coordinatorId: coordinator.id,
          debateId: debate.id,
          round2Id,
          watchers,
          responses,
          coordinatorBrief: this.#coordinatorRound1Brief(),
          evidencePacket,
        }),
        referencedMessageIds: responses.map((response) => response.messageId),
      }),
    );
    this.#dispatchTracked(intent);
    this.#record('Round 1 evidence packet queued for Coordinator.');
  }

  #handleCoordinatorResponse(text: string, deliveryId?: string): void {
    this.#lastCommands = text;
    if (this.#synthesisQueued) {
      this.#storeCoordinatorSynthesis(text, deliveryId);
      return;
    }
    if (this.#checkpointQueued) {
      // Legacy freeform checkpoint path (should be rare after 3C.6).
      this.#storeCoordinatorCheckpoint(text);
      return;
    }
    const round = this.#activeConsultationRound();
    if (round !== undefined) {
      this.#handleCoordinatorAction(text, round, deliveryId);
      return;
    }
    this.#storeCoordinatorSynthesis(text, deliveryId);
  }

  #activeConsultationRound(): Round | undefined {
    const debate = this.#activeDebate();
    if (debate === undefined) {
      return undefined;
    }
    return this.rounds
      .listByDebate(debate.id)
      .filter((round) => round.status !== 'completed')
      .sort((a, b) => a.number - b.number)
      .at(-1);
  }

  #handleCoordinatorAction(text: string, round: Round, deliveryId?: string): void {
    this.#coordinatorRaw = text;
    this.#coordinatorParseError = undefined;
    this.#coordinatorDecisionPending = false;
    try {
      if (this.#pendingOperatorQuestion !== undefined) {
        throw new Error(
          'Coordinator ask_operator is pending; wait for the Operator reply',
        );
      }
      const parsed = parseCoordinatorCommandBatch(unwrapCoordinatorJson(text));
      const batch = this.#bindActionCommandIds(parsed, round);
      this.#coordinatorStepIndex += 1;
      this.#coordinatorProtocolDebug = {
        state: 'valid',
        at: Date.now(),
        ...(deliveryId !== undefined ? { deliveryId } : {}),
        stepIndex: this.#coordinatorStepIndex,
        action: batch.commands[0]?.type ?? 'unknown',
      };
      this.#debugTransition(
        this.#requireSingleCoordinator().id,
        'coordinator-parsed',
        `step ${this.#coordinatorStepIndex}: ${batch.commands[0]?.type ?? 'unknown'}`,
      );

      const mode = batch.commands[0]?.type;
      if (mode === 'checkpoint') {
        const checkpoint = batch.commands[0];
        if (checkpoint === undefined || checkpoint.type !== 'checkpoint') {
          throw new Error('invalid checkpoint command');
        }
        this.#emit('COORDINATOR_ACTION_CREATED', {
          debateId: round.debateId,
          roundId: round.id,
          agentId: this.#requireSingleCoordinator().id,
          causationEventId: this.#lastEventId('RESPONSE_CAPTURED'),
          correlationId: `round:${round.id}`,
          payload: {
            stepIndex: this.#coordinatorStepIndex,
            action: 'checkpoint',
            commands: ['checkpoint'],
            recommendation: checkpoint.recommendation,
          },
        });
        this.#applyCheckpointCommand(
          round,
          checkpoint.content,
          checkpoint.recommendation,
        );
        this.#lastError = undefined;
        this.#record(
          `Coordinator checkpoint received for Round ${round.number} (${checkpoint.recommendation}).`,
        );
        return;
      }

      if (mode === 'ask_operator') {
        const ask = batch.commands[0];
        if (ask?.type !== 'ask_operator') {
          throw new Error('invalid ask_operator command');
        }
        this.#emit('COORDINATOR_ACTION_CREATED', {
          debateId: round.debateId,
          roundId: round.id,
          agentId: this.#requireSingleCoordinator().id,
          causationEventId: this.#lastEventId('RESPONSE_CAPTURED'),
          correlationId: `round:${round.id}`,
          payload: {
            stepIndex: this.#coordinatorStepIndex,
            action: 'ask_operator',
            commands: ['ask_operator'],
            question: ask.question,
          },
        });
        this.#applyAskOperatorCommand(round, ask.question);
        this.#lastError = undefined;
        this.#record(
          `Coordinator asked Operator a clarifying question (Round ${round.number}).`,
        );
        return;
      }

      if (mode === 'forward') {
        const deliveryIds = this.#forwardActionCommands(batch, round);
        this.#setPendingStepDeliveries(deliveryIds);
        this.#emit('COORDINATOR_ACTION_CREATED', {
          debateId: round.debateId,
          roundId: round.id,
          agentId: this.#requireSingleCoordinator().id,
          causationEventId: this.#lastEventId('RESPONSE_CAPTURED'),
          correlationId: `round:${round.id}`,
          payload: {
            stepIndex: this.#coordinatorStepIndex,
            action: 'forward',
            commands: batch.commands.map((command) => command.type),
            deliveryIds,
          },
        });
        this.#markRoundDispatched(round);
        this.#lastError = undefined;
        this.#record(
          `Coordinator action step ${this.#coordinatorStepIndex}: forwarded evidence to ${deliveryIds.length} recipient delivery(ies).`,
        );
        return;
      }

      if (mode !== 'dispatch') {
        throw new Error(`unsupported Coordinator action mode: ${String(mode)}`);
      }

      const deliveryIds = this.#dispatchActionCommands(batch, round);
      this.#setPendingStepDeliveries(deliveryIds);
      this.#emit('COORDINATOR_ACTION_CREATED', {
        debateId: round.debateId,
        roundId: round.id,
        agentId: this.#requireSingleCoordinator().id,
        causationEventId: this.#lastEventId('RESPONSE_CAPTURED'),
        correlationId: `round:${round.id}`,
        payload: {
          stepIndex: this.#coordinatorStepIndex,
          action: 'dispatch',
          commands: batch.commands.map((command) => command.type),
          deliveryIds,
        },
      });
      this.#markRoundDispatched(round);
      this.#lastError = undefined;
      this.#record(
        `Coordinator action step ${this.#coordinatorStepIndex}: dispatched to ${deliveryIds.length} recipient delivery(ies).`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#coordinatorParseError = message;
      this.#lastError = looksLikeTruncatedCoordinatorJson(text)
        ? `Coordinator action was captured before the JSON finished streaming (${message}).`
        : message;
      this.#record(`Coordinator action PARSE FAILED: ${this.#lastError}`);
      this.#coordinatorProtocolDebug = {
        state: 'invalid',
        at: Date.now(),
        ...(deliveryId !== undefined ? { deliveryId } : {}),
        error: message,
      };
      this.#debugTransition(
        this.agents.listByRole('coordinator')[0]?.id,
        'coordinator-invalid',
        message,
      );
    }
  }

  #markRoundDispatched(round: Round): void {
    if (round.number === 1) {
      this.#round1Dispatched = true;
    } else {
      this.#round2Dispatched = true;
    }
  }

  #pendingOperatorQuestionSnapshot():
    | {
        readonly debateId: string;
        readonly roundId: string;
        readonly roundNumber: number;
        readonly question: string;
        readonly createdAt: string;
      }
    | undefined {
    const pending = this.#pendingOperatorQuestion;
    if (pending === undefined) {
      return undefined;
    }
    const round = this.rounds.getById(asRoundId(pending.roundId));
    return {
      debateId: pending.debateId,
      roundId: pending.roundId,
      roundNumber: round?.number ?? 0,
      question: pending.question,
      createdAt: pending.createdAt,
    };
  }

  #bindActionCommandIds(
    batch: CoordinatorCommandBatch,
    round: Round,
  ): CoordinatorCommandBatch {
    const debateId = this.#debate().id;
    return Object.freeze({
      version: batch.version,
      commands: Object.freeze(
        batch.commands.map((command) => {
          if (command.type === 'dispatch') {
            const kind =
              round.number === 1
                ? command.kind === 'query'
                  ? 'brief'
                  : command.kind
                : command.kind === 'brief'
                  ? 'query'
                  : command.kind;
            return Object.freeze({
              ...command,
              messageId: asMessageId(this.#nextId('msg-coord-dispatch')),
              debateId,
              roundId: round.id,
              kind,
            });
          }
          if (command.type === 'forward') {
            return Object.freeze({
              ...command,
              messageId: asMessageId(this.#nextId('msg-coord-forward')),
              debateId,
              roundId: round.id,
            });
          }
          if (command.type === 'ask_operator' || command.type === 'checkpoint') {
            return Object.freeze({
              ...command,
              debateId,
              roundId: round.id,
            });
          }
          return command;
        }),
      ),
    });
  }

  #evidenceCatalogForDebate() {
    const debate = this.#debate();
    return buildEvidenceCatalog({
      messages: this.messages.listByDebate(debate.id),
      rounds: this.rounds.listByDebate(debate.id),
      agents: this.agents.list(),
    });
  }

  #forwardActionCommands(
    batch: CoordinatorCommandBatch,
    round: Round,
  ): readonly string[] {
    const watchers = this.#debateWatchers();
    const byId = new Map(watchers.map((watcher) => [watcher.id, watcher]));
    const catalog = this.#evidenceCatalogForDebate();
    const debate = this.#debate();
    const deliveryIds: string[] = [];
    const forwards = batch.commands.filter(
      (command) => command.type === 'forward',
    );
    if (forwards.length === 0 || forwards.length !== batch.commands.length) {
      throw new Error('forward batches cannot mix non-forward commands');
    }

    for (const command of forwards) {
      if (command.type !== 'forward') {
        continue;
      }
      const sources = resolveEvidenceRefs({
        catalog,
        sourceRefs: command.sourceRefs,
        sourceMessageIds: command.sourceMessageIds,
      });
      const recipientIds =
        command.recipients.type === 'explicit-agents'
          ? command.recipients.agentIds
          : watchers.map((watcher) => watcher.id);
      if (recipientIds.length === 0) {
        throw new Error('forward recipients cannot be empty');
      }
      const sourceBlocks = sources.map((entry) => ({
        authorName: entry.authorName,
        body: entry.body,
      }));
      const referenced = sources.map((entry) => entry.messageId);

      for (const agentId of recipientIds) {
        const watcher = byId.get(agentId);
        if (watcher === undefined) {
          throw new Error(
            `forward recipient is not an active Watcher: ${agentId}`,
          );
        }
        const body = composeForwardWatcherBody(
          round.number,
          watcher.name,
          sourceBlocks,
          command.instruction,
        );
        const deliveries = this.workflow.dispatchPlan(
          round.id,
          createDispatchPlan({
            messageId: this.#nextId('msg-watcher-forward'),
            debateId: debate.id,
            roundId: round.id,
            senderId: this.#requireSingleCoordinator().id,
            recipients: {
              type: 'explicit-agents',
              agentIds: [watcher.id],
            },
            kind: round.number === 1 ? 'brief' : 'query',
            body,
            referencedMessageIds: referenced,
          }),
        );
        for (const delivery of deliveries) {
          deliveryIds.push(delivery.id);
        }
      }
    }
    return Object.freeze(deliveryIds);
  }

  #applyAskOperatorCommand(round: Round, question: string): void {
    const createdAt = new Date().toISOString();
    this.#pendingStepDeliveryIds.clear();
    this.#pendingOperatorQuestion = {
      debateId: round.debateId,
      roundId: round.id,
      question,
      createdAt,
    };
    this.#coordinatorDecisionPending = false;
    this.#emit('COORDINATOR_OPERATOR_QUESTION_CREATED', {
      debateId: round.debateId,
      roundId: round.id,
      agentId: this.#requireSingleCoordinator().id,
      causationEventId: this.#lastEventId('COORDINATOR_ACTION_CREATED'),
      correlationId: `round:${round.id}`,
      payload: {
        question,
        createdAt,
      },
    });
  }

  /**
   * Operator answers a pending ask_operator question; resumes the same round.
   */
  answerOperatorQuestion(answer: string): void {
    this.#requireStarted();
    const pending = this.#pendingOperatorQuestion;
    if (pending === undefined) {
      throw new Error('No pending Coordinator question for the Operator');
    }
    const trimmed = answer.trim();
    if (trimmed.length === 0) {
      throw new Error('Operator answer cannot be empty');
    }
    const round = this.rounds.getById(asRoundId(pending.roundId));
    if (round === undefined || round.status === 'completed') {
      throw new Error('ask_operator round is no longer active');
    }
    const coordinator = this.#requireSingleCoordinator();
    const messageId = asMessageId(this.#nextId('msg-operator-answer'));
    const message = createMessageEnvelope({
      id: messageId,
      debateId: pending.debateId,
      roundId: pending.roundId,
      senderId: OPERATOR_ID,
      recipientIds: [coordinator.id],
      kind: 'input',
      body: `OPERATOR ANSWER\n${trimmed}`,
    });
    this.messages.store(message);
    this.#emit('MESSAGE_CREATED', {
      debateId: pending.debateId,
      roundId: pending.roundId,
      agentId: OPERATOR_ID,
      correlationId: `round:${pending.roundId}`,
      payload: {
        messageId,
        senderId: OPERATOR_ID,
        recipientIds: [coordinator.id],
        kind: 'input',
        body: message.body,
      },
    });
    this.#emit('OPERATOR_INTERVENTION', {
      debateId: pending.debateId,
      roundId: pending.roundId,
      correlationId: `round:${pending.roundId}`,
      payload: {
        kind: 'ask_operator_answer',
        question: pending.question,
        answer: trimmed,
        messageId,
      },
    });
    this.#pendingOperatorQuestion = undefined;
    this.#record('Operator answered Coordinator clarifying question.');
    this.#coordinatorDecisionPending = true;
    const intent = this.planner.plan(
      createDispatchPlan({
        messageId: this.#nextId('msg-coordinator-action'),
        debateId: pending.debateId,
        senderId: OPERATOR_ID,
        recipients: { type: 'explicit-agents', agentIds: [coordinator.id] },
        kind: 'input',
        body: coordinatorActionPrompt({
          problem: this.#debate().topic,
          coordinatorId: coordinator.id,
          debateId: pending.debateId,
          roundId: pending.roundId,
          roundNumber: round.number,
          watchers: this.#debateWatchers(),
          evidencePacket: this.#boundedEvidence(),
          evidenceCatalog: formatEvidenceCatalog(this.#evidenceCatalogForDebate()),
          latestCheckpoint: this.#latestCheckpoint()?.body,
          newResults: `Operator answer to your question:\n${trimmed}`,
          stepContext: `Round ${round.number}: Operator answered your question. Decide the next Rayzan action.`,
        }),
        referencedMessageIds: [messageId, ...this.#recentResponseIds()],
      }),
    );
    this.#dispatchTracked(intent);
  }

  #dispatchActionCommands(
    batch: CoordinatorCommandBatch,
    round: Round,
  ): readonly string[] {
    const watchers = this.#debateWatchers();
    const challenges = watcherChallengesFromBatch({ batch, watchers });
    // Round 1 stays independent: do not prepend shared Watcher answers.
    // Later rounds may include bounded common evidence for cross-examination.
    const common =
      round.number === 1
        ? ''
        : `COMMON DEBATE EVIDENCE\n======================\n${this.#boundedEvidence()}`;
    const deliveryIds: string[] = [];
    const debate = this.#debate();
    const baselineIds = this.#recentResponseIds();

    for (const challenge of challenges) {
      const deliveries = this.workflow.dispatchPlan(
        round.id,
        createDispatchPlan({
          messageId: this.#nextId('msg-watcher'),
          debateId: debate.id,
          roundId: round.id,
          senderId: this.#requireSingleCoordinator().id,
          recipients: {
            type: 'explicit-agents',
            agentIds: [challenge.agentId],
          },
          kind: round.number === 1 ? 'brief' : 'query',
          body: composeRoundWatcherBody(
            round.number,
            challenge.name,
            common,
            challenge.challenge,
          ),
          referencedMessageIds: mergeReferencedMessageIds(
            challenge.referencedMessageIds,
            baselineIds,
          ),
        }),
      );
      for (const delivery of deliveries) {
        deliveryIds.push(delivery.id);
      }
    }
    return Object.freeze(deliveryIds);
  }

  #applyCheckpointCommand(
    round: Round,
    content: string,
    recommendation: 'finish' | 'continue',
  ): void {
    this.#pendingStepDeliveryIds.clear();
    if (round.status !== 'completed') {
      this.workflow.completeRound(round.id);
      this.#emit('ROUND_COMPLETED', {
        debateId: round.debateId,
        roundId: round.id,
        causationEventId: this.#lastEventId('COORDINATOR_ACTION_CREATED'),
        correlationId: `round:${round.id}`,
        payload: { number: round.number, status: 'completed' },
      });
    }
    if (this.checkpoints.getByRoundId(round.id) !== undefined) {
      return;
    }
    const createdAt = new Date().toISOString();
    const checkpoint = createCoordinatorCheckpoint({
      debateId: round.debateId,
      roundId: round.id,
      body: content,
      recommendation,
      createdAt,
    });
    this.checkpoints.store(checkpoint);
    this.#emit('COORDINATOR_CHECKPOINT_CREATED', {
      debateId: checkpoint.debateId,
      roundId: checkpoint.roundId,
      agentId: this.#requireSingleCoordinator().id,
      causationEventId: this.#lastEventId('ROUND_COMPLETED'),
      correlationId: `round:${checkpoint.roundId}`,
      payload: {
        body: checkpoint.body,
        recommendation: checkpoint.recommendation,
        createdAt: checkpoint.createdAt,
      },
    });
    this.#checkpointQueued = false;
    this.#coordinatorDecisionPending = false;
  }

  #queueCoordinatorNextAction(completedDeliveryIds: readonly string[]): void {
    const round = this.#activeConsultationRound();
    if (round === undefined) {
      return;
    }
    if (this.checkpoints.getByRoundId(round.id) !== undefined) {
      return;
    }
    if (this.#pendingOperatorQuestion !== undefined) {
      return;
    }
    const debate = this.#debate();
    const coordinator = this.#requireSingleCoordinator();
    const newResults = this.#formatStepResults(completedDeliveryIds);
    this.#coordinatorDecisionPending = true;
    const intent = this.planner.plan(
      createDispatchPlan({
        messageId: this.#nextId('msg-coordinator-action'),
        debateId: debate.id,
        senderId: OPERATOR_ID,
        recipients: { type: 'explicit-agents', agentIds: [coordinator.id] },
        kind: 'input',
        body: coordinatorActionPrompt({
          problem: debate.topic,
          coordinatorId: coordinator.id,
          debateId: debate.id,
          roundId: round.id,
          roundNumber: round.number,
          watchers: this.#debateWatchers(),
          evidencePacket: this.#boundedEvidence(),
          evidenceCatalog: formatEvidenceCatalog(this.#evidenceCatalogForDebate()),
          latestCheckpoint: this.#latestCheckpoint()?.body,
          newResults,
          stepContext: `Round ${round.number} action step ${this.#coordinatorStepIndex} finished. Decide the next Rayzan action.`,
        }),
        referencedMessageIds: this.#recentResponseIds(),
      }),
    );
    this.#dispatchTracked(intent);
    this.#record('Coordinator re-invoked after Watcher step results.');
  }

  #formatStepResults(deliveryIds: readonly string[]): string {
    const debate = this.#focusDebate();
    if (debate === undefined) {
      return '(none)';
    }
    const lines: string[] = [];
    for (const deliveryId of deliveryIds) {
      const delivery = this.transport.getDelivery(asDeliveryId(deliveryId));
      if (delivery === undefined) {
        continue;
      }
      const agent = this.agents.getById(delivery.recipientId);
      const responseBody = this.#responseBodyForDelivery(deliveryId);
      lines.push(
        `${agent?.name ?? delivery.recipientId}:\n${responseBody ?? '(missing response)'}`,
      );
    }
    return lines.join('\n\n') || '(none)';
  }

  /** Resolve the captured response body for a specific delivery (not merely the first in-round reply). */
  #responseBodyForDelivery(deliveryId: string): string | undefined {
    const debate = this.#focusDebate();
    if (debate === undefined) {
      return undefined;
    }
    const captured = this.events
      .listByDebate(debate.id)
      .filter((event) => event.type === 'RESPONSE_CAPTURED')
      .find((event) => {
        const payload = event.payload as { readonly deliveryId?: string };
        return payload.deliveryId === deliveryId;
      });
    if (captured === undefined) {
      return undefined;
    }
    const payload = captured.payload as { readonly messageId?: string };
    if (typeof payload.messageId !== 'string') {
      return undefined;
    }
    return this.messages.getById(asMessageId(payload.messageId))?.body;
  }

  #handleRound1CoordinatorBrief(text: string): void {
    const round = this.#requireRoundNumber(1);
    this.#handleCoordinatorAction(text, round);
  }

  #handleRound2CoordinatorPlan(text: string): void {
    const round = this.#activeChallengeRound() ?? this.#activeConsultationRound();
    if (round === undefined) {
      throw new Error('no active consultation round');
    }
    this.#handleCoordinatorAction(text, round);
  }

  /**
   * Re-run the latest Coordinator Round 1 JSON after a parse/dispatch failure
   * (for example a reused example messageId from a prior debate).
   */
  retryCoordinatorDispatch(): void {
    this.#requireStarted();
    if (this.#round1Dispatched) {
      throw new Error('Round 1 Watcher brief already dispatched');
    }
    const text = this.#coordinatorCommandText();
    if (text === undefined) {
      throw new Error('No Coordinator response available to retry');
    }
    this.#handleCoordinatorResponse(text);
    if (this.#lastError !== undefined) {
      throw new Error(this.#lastError);
    }
  }

  /** Operator authorizes one more shared-evidence round from a checkpoint gate. */
  continueDebate(guidance?: string): void {
    this.#requireStarted();
    const checkpoint = this.#latestCheckpoint();
    if (checkpoint === undefined || !this.#awaitingOperator()) {
      throw new Error('A Coordinator checkpoint is required before continuing');
    }
    const trimmed = guidance?.trim() ?? '';
    if (trimmed.length > 0) {
      this.#emit('OPERATOR_INTERVENTION', {
        debateId: checkpoint.debateId,
        roundId: checkpoint.roundId,
        correlationId: `round:${checkpoint.roundId}`,
        payload: { guidance: trimmed },
      });
    }
    const continued = this.#emit('DEBATE_CONTINUED', {
      debateId: checkpoint.debateId,
      roundId: checkpoint.roundId,
      correlationId: `round:${checkpoint.roundId}`,
      payload: { fromRoundId: checkpoint.roundId },
    });
    this.#checkpointQueued = false;
    this.#startNextRound(continued.id, trimmed || undefined);
  }

  /** Operator explicitly requests the final report; synthesis is never automatic. */
  finishDebate(): void {
    this.#requireStarted();
    const checkpoint = this.#latestCheckpoint();
    if (checkpoint === undefined || !this.#awaitingOperator()) {
      throw new Error('A Coordinator checkpoint is required before finishing');
    }
    const finish = this.#emit('DEBATE_FINISH_REQUESTED', {
      debateId: checkpoint.debateId,
      roundId: checkpoint.roundId,
      correlationId: `debate:${checkpoint.debateId}`,
      payload: { roundId: checkpoint.roundId },
    });
    this.#checkpointQueued = false;
    this.#queueCoordinatorSynthesis(finish.id);
  }

  #bindRound1DispatchIds(
    batch: CoordinatorCommandBatch,
  ): CoordinatorCommandBatch {
    const debateId = this.#debate().id;
    const roundId = this.#requireRoundNumber(1).id;
    return Object.freeze({
      version: batch.version,
      commands: Object.freeze(
        batch.commands.map((command) => {
          if (command.type !== 'dispatch') {
            return command;
          }
          return Object.freeze({
            ...command,
            // Coordinator prompts use a fixed example id; bind a unique one
            // so later debates do not collide in the append-only message store.
            messageId: asMessageId(this.#nextId('msg-round1-brief')),
            debateId,
            roundId,
          });
        }),
      ),
    });
  }

  #coordinatorCommandText(): string | undefined {
    if (this.#lastCommands !== undefined) {
      return this.#lastCommands;
    }
    const coordinator = this.agents.listByRole('coordinator')[0];
    const debate = this.#activeDebate();
    if (coordinator === undefined || debate === undefined) {
      return undefined;
    }
    const responses = this.messages
      .listByDebate(debate.id)
      .filter(
        (message) =>
          message.senderId === coordinator.id && message.kind === 'response',
      );
    return responses.at(-1)?.body;
  }

  #dispatchPersonalizedRound2(challenges: readonly WatcherChallenge[]): void {
    if (this.#round2Dispatched) {
      return;
    }
    const round2 = this.#activeChallengeRound();
    if (round2 === undefined) {
      throw new Error('no active follow-up round');
    }
    const debate = this.#debate();
    const responses = this.#round1Responses();
    const baselineIds = responses.map((response) => response.messageId);
    const common = `COMMON DEBATE EVIDENCE\n======================\n${this.#boundedEvidence()}`;

    for (const challenge of challenges) {
      this.workflow.dispatchPlan(
        round2.id,
        createDispatchPlan({
          messageId: this.#nextId('msg-round2'),
          debateId: debate.id,
          roundId: round2.id,
          senderId: this.#requireSingleCoordinator().id,
          recipients: {
            type: 'explicit-agents',
            agentIds: [challenge.agentId],
          },
          kind: 'query',
          body: composeRoundWatcherBody(
            round2.number,
            challenge.name,
            common,
            challenge.challenge,
          ),
          referencedMessageIds: mergeReferencedMessageIds(
            challenge.referencedMessageIds,
            baselineIds,
          ),
        }),
      );
    }
    this.#round2Dispatched = true;
    this.#record(
      `Personalized Round ${round2.number} prompts queued (common evidence prepended).`,
    );
  }

  #queueCoordinatorSynthesis(causationEventId?: string): void {
    if (this.#synthesisAlreadyQueuedOrStored()) {
      this.#synthesisQueued = true;
      return;
    }
    const debate = this.#debate();
    const coordinator = this.#requireSingleCoordinator();
    const evidencePacket = this.#boundedEvidence();
    const intent = this.planner.plan(
      createDispatchPlan({
        messageId: this.#nextId('msg-coordinator-synthesis'),
        debateId: debate.id,
        senderId: OPERATOR_ID,
        recipients: {
          type: 'explicit-agents',
          agentIds: [coordinator.id],
        },
        kind: 'input',
        body: coordinatorSynthesisPrompt({
          coordinatorId: coordinator.id,
          debateId: debate.id,
          evidencePacket,
        }),
        referencedMessageIds: this.#recentResponseIds(),
      }),
    );
    this.#dispatchTracked(intent);
    this.#synthesisQueued = true;
    this.#record(
      causationEventId
        ? 'Operator requested final synthesis; evidence packet queued for Coordinator.'
        : 'Synthesis evidence packet queued for Coordinator.',
    );
  }

  #synthesisAlreadyQueuedOrStored(): boolean {
    const debate = this.#activeDebate() ?? this.#focusDebate();
    if (debate === undefined) {
      return false;
    }
    if (this.syntheses.getByDebateId(debate.id) !== undefined) {
      return true;
    }
    const coordinator = this.agents.listByRole('coordinator')[0];
    if (coordinator === undefined) {
      return false;
    }
    return this.messages.listByDebate(debate.id).some(
      (message) =>
        message.kind === 'input' &&
        message.senderId === OPERATOR_ID &&
        message.recipientIds.includes(coordinator.id) &&
        message.id.startsWith('msg-coordinator-synthesis'),
    );
  }

  #storeCoordinatorSynthesis(text: string, deliveryId?: string): void {
    const debate = this.#debate();
    if (this.syntheses.getByDebateId(debate.id)) {
      return;
    }
    const coordinator = this.#requireSingleCoordinator();
    try {
      const synthesis = createDebateSynthesis({
        debateId: debate.id,
        coordinatorId: coordinator.id,
        body: text,
        createdAt: new Date().toISOString(),
      });
      this.syntheses.store(synthesis);
      this.#coordinatorProtocolDebug = {
        state: 'valid',
        at: Date.now(),
        ...(deliveryId !== undefined ? { deliveryId } : {}),
        action: 'synthesis',
      };
      this.#debugTransition(coordinator.id, 'coordinator-parsed', 'synthesis');
      this.#emit('SYNTHESIS_CREATED', {
        debateId: synthesis.debateId,
        agentId: synthesis.coordinatorId,
        causationEventId: this.#lastEventId('ROUND_COMPLETED'),
        correlationId: `debate:${synthesis.debateId}`,
        payload: {
          coordinatorId: synthesis.coordinatorId,
          body: synthesis.body,
          createdAt: synthesis.createdAt,
        },
      });
      this.debates.update(
        withDebateStatus(debate, 'completed', {
          completedAt: synthesis.createdAt,
        }),
      );
      this.#syncLogicalFlags();
      this.#lastError = undefined;
      this.#record('Coordinator final synthesis stored.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#lastError = message;
      this.#record(`Coordinator synthesis STORE FAILED: ${message}`);
    }
  }

  #round1Responses(): readonly AttributedWatcherResponse[] {
    return this.#watcherResponsesForRound(1);
  }

  #round2Responses(): readonly AttributedWatcherResponse[] {
    return this.#watcherResponsesForRound(2);
  }

  #watcherResponsesForRound(
    number: number,
  ): readonly AttributedWatcherResponse[] {
    const debate = this.#focusDebate();
    const round = this.#roundByNumber(number);
    if (debate === undefined || round === undefined) {
      return [];
    }
    return this.agents.listByRole('watcher').flatMap((watcher) => {
      const message = this.messages
        .listByDebate(debate.id)
        .find(
          (item) =>
            item.kind === 'response' &&
            item.senderId === watcher.id &&
            item.roundId === round.id,
        );
      return message
        ? [
            {
              agentId: watcher.id,
              name: watcher.name,
              messageId: message.id,
              body: message.body,
            },
          ]
        : [];
    });
  }

  #synthesisRecord(): RayzanSnapshot['synthesis'] {
    const debate = this.#focusDebate();
    if (debate === undefined) {
      return undefined;
    }
    const synthesis = this.syntheses.getByDebateId(debate.id);
    if (synthesis === undefined) {
      return undefined;
    }
    return {
      debateId: synthesis.debateId,
      coordinatorId: synthesis.coordinatorId,
      body: synthesis.body,
      createdAt: synthesis.createdAt,
    };
  }

  #round2Messages(): readonly { name: string; body: string }[] {
    const debate = this.#focusDebate();
    const round2 = this.#roundByNumber(2);
    if (debate === undefined || round2 === undefined) {
      return [];
    }
    return this.agents.listByRole('watcher').flatMap((watcher) => {
      const message = this.messages
        .listByDebate(debate.id)
        .find(
          (item) =>
            item.roundId === round2.id &&
            item.kind === 'query' &&
            item.recipientIds.includes(watcher.id),
        );
      return message ? [{ name: watcher.name, body: message.body }] : [];
    });
  }

  /** Product-facing prompt/response pairs for Desktop transparency. */
  #watcherContributions(): RayzanSnapshot['watcherContributions'] {
    const debate = this.#focusDebate();
    if (debate === undefined) {
      return [];
    }
    const rounds = this.rounds.listByDebate(debate.id);
    const messages = this.messages.listByDebate(debate.id);
    const out: {
      agentId: string;
      name: string;
      provider?: string;
      roundNumber: number;
      prompt: string;
      response?: string;
    }[] = [];

    for (const round of rounds) {
      for (const watcher of this.agents.listByRole('watcher')) {
        if (!this.#watcherEnabled(watcher)) {
          continue;
        }
        // One contribution per Coordinator→Watcher dispatch in the round.
        // Agentic steps may contact the same Watcher multiple times.
        const prompts = messages.filter(
          (message) =>
            message.roundId === round.id &&
            (message.kind === 'brief' || message.kind === 'query') &&
            message.recipientIds.includes(watcher.id),
        );
        if (prompts.length === 0) {
          continue;
        }
        const responses = messages.filter(
          (message) =>
            message.roundId === round.id &&
            message.kind === 'response' &&
            message.senderId === watcher.id,
        );
        const provider = this.#providerFor(watcher.id);
        for (let index = 0; index < prompts.length; index += 1) {
          const prompt = prompts[index]!;
          const response = responses[index];
          out.push({
            agentId: watcher.id,
            name: watcher.name,
            ...(provider !== undefined ? { provider } : {}),
            roundNumber: round.number,
            prompt: prompt.body,
            ...(response ? { response: response.body } : {}),
          });
        }
      }
    }
    return Object.freeze(out);
  }

  #coordinatorPlanSnapshot(): RayzanSnapshot['coordinatorPlan'] {
    if (
      this.#parsedChallenges === undefined &&
      this.#coordinatorParseError === undefined &&
      this.#coordinatorRaw === undefined
    ) {
      return undefined;
    }
    if (this.#coordinatorParseError) {
      return {
        parsed: false,
        ...(this.#coordinatorRaw ? { raw: this.#coordinatorRaw } : {}),
        error: this.#coordinatorParseError,
      };
    }
    if (this.#parsedChallenges) {
      return {
        parsed: true,
        challenges: this.#parsedChallenges.map((challenge) => ({
          name: challenge.name,
          challenge: challenge.challenge,
        })),
      };
    }
    return undefined;
  }

  #timeline(): readonly string[] {
    const lines: string[] = [];
    const watchers = this.#debateWatchers();
    const debate = this.#focusDebate();
    const round1 = this.#roundByNumber(1);
    const coordinator = this.agents.listByRole('coordinator')[0];
    const coordinatorCapture = coordinator
      ? this.#presence.get(coordinator.id)?.capture
      : undefined;
    const coordinatorDeliveries =
      coordinator === undefined || debate === undefined
        ? []
        : this.transport
            .listAll()
            .filter(
              (delivery) =>
                delivery.recipientId === coordinator.id &&
                delivery.debateId === debate.id,
            );
    const coordinatorR1 = coordinatorDeliveries[0];
    const coordinatorR2 = coordinatorDeliveries[1];

    lines.push('LIVE DEBATE');
    lines.push('');
    lines.push('COORDINATOR — ROUND 1');
    if (coordinatorR1?.status === 'pending') {
      lines.push('… Prompt sending');
    }
    if (
      coordinatorR1 &&
      (coordinatorR1.status === 'delivered' ||
        coordinatorR1.status === 'responded')
    ) {
      lines.push('✓ Prompt delivered');
    }
    if (coordinatorR1?.status === 'responded') {
      lines.push('✓ Response automatically captured');
    } else if (this.#captureFailed(coordinator?.id)) {
      lines.push('✗ Capture FAILED');
      const reason = coordinatorCapture?.reason;
      if (reason) {
        lines.push(`Reason: ${reason}`);
      }
    }
    if (this.#round1Dispatched) {
      lines.push('✓ Round 1 brief parsed');
    }

    lines.push('');
    lines.push('ROUND 1');
    for (const watcher of watchers) {
      const status = this.#round1Status(watcher);
      const capture = this.#presence.get(watcher.id)?.capture;
      lines.push(watcher.name);
      if (status === 'pending' || status === 'sending') {
        lines.push('… Delivered (sending)');
      } else if (status !== 'idle') {
        lines.push('✓ Delivered');
      }
      if (status === 'generating' && capture?.phase) {
        lines.push(`Capture: ${capture.phase}`);
      } else if (status === 'responded') {
        lines.push('✓ Response captured');
      } else if (status === 'failed') {
        lines.push('✗ Capture FAILED');
        if (capture?.reason) {
          lines.push(`Reason: ${capture.reason}`);
        }
      }
      lines.push('');
    }
    const progress = round1 ? this.#safeProgress(round1.id) : undefined;
    lines.push('Progress');
    lines.push(
      progress ? `${progress.responded} / ${progress.expected}` : '0 / 0',
    );
    if (round1?.status === 'completed') {
      lines.push('Status');
      lines.push('COMPLETED ✓');
    }

    lines.push('');
    lines.push('COORDINATOR — ROUND 2');
    if (this.#round2Bootstrapped) {
      if (
        coordinatorR2 &&
        (coordinatorR2.status === 'delivered' ||
          coordinatorR2.status === 'responded')
      ) {
        lines.push('✓ Evidence delivered');
      }
      if (coordinatorR2?.status === 'responded' || this.#coordinatorRaw) {
        lines.push('✓ Response automatically captured');
      }
      if (this.#parsedChallenges) {
        lines.push('✓ Plan parsed');
      }
      if (this.#coordinatorParseError) {
        lines.push('✗ PARSE FAILED');
      }
    }

    lines.push('');
    lines.push('ROUND 2');
    for (const watcher of watchers) {
      const status = this.#round2Status(watcher);
      const capture = this.#presence.get(watcher.id)?.capture;
      if (status === 'pending') {
        lines.push(`${watcher.name}`);
        lines.push('… Personalized prompt sending');
      }
      if (status === 'generating') {
        lines.push(`${watcher.name}`);
        lines.push('Personalized prompt delivered ✓');
        if (capture?.phase) {
          lines.push(`Capture: ${capture.phase}`);
        }
      }
      if (status === 'responded') {
        lines.push(`${watcher.name}`);
        lines.push('✓ Round 2 response captured');
      }
      if (status === 'failed') {
        lines.push(`${watcher.name}`);
        lines.push('✗ Round 2 capture failed');
      }
    }
    const round2 = this.#roundByNumber(2);
    const round2Progress = round2 ? this.#safeProgress(round2.id) : undefined;
    if (round2) {
      lines.push('Progress');
      lines.push(
        round2Progress
          ? `${round2Progress.responded} / ${round2Progress.expected}`
          : '0 / 0',
      );
      if (round2.status === 'completed') {
        lines.push('Status');
        lines.push('COMPLETED ✓');
      }
    }

    lines.push('');
    lines.push('SYNTHESIS');
    const synthesis = this.#synthesisRecord();
    const coordinatorSynthesis = coordinatorDeliveries[2];
    if (this.#synthesisQueued && coordinatorSynthesis?.status === 'pending') {
      lines.push('… Final report sending');
    }
    if (
      coordinatorSynthesis &&
      (coordinatorSynthesis.status === 'delivered' ||
        coordinatorSynthesis.status === 'responded')
    ) {
      lines.push('✓ Synthesis prompt delivered');
    }
    if (synthesis) {
      lines.push('✓ Final Coordinator Report stored');
    }
    return Object.freeze(lines);
  }

  #safeProgress(
    roundId: string,
  ): { responded: number; expected: number } | undefined {
    try {
      const progress = this.workflow.getRoundProgress(roundId);
      return { responded: progress.responded, expected: progress.expected };
    } catch {
      return undefined;
    }
  }

  #captureFailed(agentId: string | undefined): boolean {
    if (agentId === undefined) {
      return false;
    }
    const presence = this.#presence.get(agentId);
    return presence?.phase === 'error' || presence?.capture?.phase === 'failed';
  }

  #coordinatorRound1Brief(): string | undefined {
    const debate = this.#focusDebate();
    const coordinator = this.agents.listByRole('coordinator')[0];
    if (debate === undefined || coordinator === undefined) {
      return undefined;
    }
    return this.messages
      .listByDebate(debate.id)
      .find(
        (message) =>
          message.kind === 'brief' && message.senderId === coordinator.id,
      )?.body;
  }

  #round1Status(agent: Agent): string {
    if (agent.role === 'coordinator') {
      return 'idle';
    }
    const round1 = this.#roundByNumber(1);
    const delivery = this.#deliveryFor(agent.id, round1?.id);
    if (
      this.#presence.get(agent.id)?.phase === 'error' &&
      delivery?.status !== 'responded'
    ) {
      return 'failed';
    }
    if (delivery?.status === 'responded') {
      return 'responded';
    }
    if (delivery?.status === 'delivered') {
      return 'generating';
    }
    if (delivery?.status === 'pending') {
      return 'pending';
    }
    return 'idle';
  }

  #round2Status(agent: Agent): string {
    if (agent.role !== 'watcher') {
      return 'idle';
    }
    const round2 = this.#roundByNumber(2);
    const delivery = this.#deliveryFor(agent.id, round2?.id);
    if (
      this.#presence.get(agent.id)?.phase === 'error' &&
      delivery?.status !== 'responded'
    ) {
      return 'failed';
    }
    if (delivery?.status === 'responded') {
      return 'responded';
    }
    if (delivery?.status === 'delivered') {
      return 'generating';
    }
    if (delivery?.status === 'pending') {
      return 'pending';
    }
    return 'idle';
  }

  #roundStatus(agent: Agent, roundId: string): string {
    const delivery = this.#deliveryFor(agent.id, roundId);
    if (
      this.#presence.get(agent.id)?.phase === 'error' &&
      delivery?.status !== 'responded'
    ) {
      return 'failed';
    }
    if (delivery?.status === 'responded') {
      return 'responded';
    }
    if (delivery?.status === 'delivered') {
      return 'generating';
    }
    if (delivery?.status === 'pending') {
      return 'pending';
    }
    return 'idle';
  }

  #deliveryFor(
    agentId: AgentId,
    roundId: string | undefined,
  ): OutboundDelivery | undefined {
    if (roundId === undefined) {
      return undefined;
    }
    // Prefer the delivery from the current Coordinator action step so a prior
    // responded hop in the same round does not mask an in-flight job.
    for (const deliveryId of this.#pendingStepDeliveryIds) {
      const pending = this.transport.getDelivery(asDeliveryId(deliveryId));
      if (
        pending !== undefined &&
        pending.recipientId === agentId &&
        pending.roundId === roundId
      ) {
        return pending;
      }
    }
    const matches = this.transport
      .listAll()
      .filter(
        (delivery) =>
          delivery.recipientId === agentId && delivery.roundId === roundId,
      );
    // Newest delivery in this round (Map insertion order is oldest-first).
    return matches.at(-1);
  }

  #latestResponseFrom(agentId: AgentId): string | undefined {
    const debate = this.#focusDebate();
    if (debate === undefined) {
      return undefined;
    }
    return this.messages
      .listByDebate(debate.id)
      .filter(
        (message) =>
          message.kind === 'response' && message.senderId === agentId,
      )
      .at(-1)?.body;
  }

  #jobFromDelivery(
    delivery: OutboundDelivery | undefined,
  ): PendingBrowserJob | undefined {
    if (delivery === undefined) {
      return undefined;
    }
    const message = this.transport.getMessage(delivery.messageId);
    if (message === undefined) {
      throw new Error(`missing message for delivery ${delivery.id}`);
    }
    return Object.freeze({
      deliveryId: delivery.id,
      messageId: message.id,
      recipientId: delivery.recipientId,
      senderId: delivery.senderId,
      body: message.body,
      kind: message.kind,
      capture: true,
    });
  }

  #watcherEnabled(agent: Agent): boolean {
    return this.#participation.get(agent.id) !== false;
  }

  #watchersForNewDebate(): readonly Agent[] {
    return this.agents
      .listByRole('watcher')
      .filter((watcher) => this.#watcherEnabled(watcher));
  }

  /** Watchers that joined Round 1 (or enabled team if Round 1 has no roster yet). */
  #debateWatchers(): readonly Agent[] {
    const round1 = this.#roundByNumber(1);
    if (round1 !== undefined) {
      try {
        const ids = this.workflow.getParticipantIds(round1.id);
        if (ids.length > 0) {
          return ids.flatMap((id) => {
            const agent = this.agents.getById(id);
            return agent !== undefined && agent.role === 'watcher' ? [agent] : [];
          });
        }
      } catch {
        // Fall through to enabled Watchers.
      }
    }
    return this.#watchersForNewDebate();
  }

  #requireSingleCoordinator(): Agent {
    const coordinators = this.agents.listByRole('coordinator');
    if (coordinators.length !== 1) {
      throw new Error(
        'register exactly one Coordinator before starting Round 1',
      );
    }
    return coordinators[0]!;
  }

  archiveActiveDebate(): Debate {
    const debate = this.#requireActiveDebate();
    const updated = withDebateStatus(debate, 'archived');
    this.debates.update(updated);
    this.#emit('DEBATE_ARCHIVED', {
      debateId: debate.id,
      correlationId: `debate:${debate.id}`,
      payload: { previousStatus: debate.status, status: 'archived' },
    });
    this.#freezeRestoredSideEffects = false;
    this.#syncLogicalFlags();
    this.#record(`Debate ${debate.id} archived.`);
    return updated;
  }

  endActiveDebate(): Debate {
    return this.archiveActiveDebate();
  }

  #requireStarted(): void {
    if (!this.#started) {
      throw new Error('start Round 1 first');
    }
  }

  #requireAgent(agentId: string): Agent {
    const agent = this.agents.getById(asAgentId(agentId));
    if (agent === undefined) {
      throw new Error(`unknown agent: ${agentId}`);
    }
    return agent;
  }

  #debate() {
    return this.#requireActiveDebate();
  }

  #activeDebate(): Debate | undefined {
    return this.debates
      .list()
      .find((debate) => isOpenDebateStatus(debate.status));
  }

  #historyDebates(): readonly Debate[] {
    return this.debates
      .list()
      .filter((debate) => !isOpenDebateStatus(debate.status));
  }

  #focusDebate(): Debate | undefined {
    return this.#activeDebate() ?? this.#historyDebates().at(-1);
  }

  #requireActiveDebate(): Debate {
    const debate = this.#activeDebate();
    if (debate === undefined) {
      throw new Error('no active debate');
    }
    return debate;
  }

  #assertNoOpenDebate(): void {
    const open = this.#activeDebate();
    if (open !== undefined) {
      throw new Error(
        `An active debate already exists (${open.id}). Resume it, or end/archive it before starting a new debate.`,
      );
    }
  }

  #debateView(debate: Debate): DebateView {
    return {
      id: debate.id,
      topic: debate.topic,
      status: debate.status,
      ...(debate.createdAt !== undefined ? { createdAt: debate.createdAt } : {}),
      ...(debate.completedAt !== undefined
        ? { completedAt: debate.completedAt }
        : {}),
    };
  }

  #roundByNumber(number: number): Round | undefined {
    const debate = this.#focusDebate();
    if (debate === undefined) {
      return undefined;
    }
    return this.rounds
      .listByDebate(debate.id)
      .find((round) => round.number === number);
  }

  #requireRoundNumber(number: number): Round {
    const round = this.#roundByNumber(number);
    if (round === undefined) {
      throw new Error(`round ${number} missing`);
    }
    return round;
  }

  #activeChallengeRound(): Round | undefined {
    const debate = this.#activeDebate();
    if (debate === undefined) {
      return undefined;
    }
    return this.rounds
      .listByDebate(debate.id)
      .filter((round) => round.number > 1 && round.status !== 'completed')
      .at(-1);
  }

  #latestCompletedRound(): Round | undefined {
    const debate = this.#focusDebate();
    if (debate === undefined) {
      return undefined;
    }
    return this.rounds
      .listByDebate(debate.id)
      .filter((round) => round.status === 'completed')
      .sort((a, b) => a.number - b.number)
      .at(-1);
  }

  #latestCheckpoint(): CoordinatorCheckpoint | undefined {
    const debate = this.#focusDebate();
    if (debate === undefined) {
      return undefined;
    }
    return [...this.checkpoints.listByDebate(debate.id)]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .at(-1);
  }

  /** Event-derived operator gate; no awaiting state is persisted. */
  #awaitingOperator(): boolean {
    const checkpoint = this.#latestCheckpoint();
    if (checkpoint === undefined) {
      return false;
    }
    const events = this.events.listByDebate(checkpoint.debateId);
    let index = -1;
    for (let cursor = events.length - 1; cursor >= 0; cursor -= 1) {
      const event = events[cursor];
      if (
        event?.type === 'COORDINATOR_CHECKPOINT_CREATED' &&
        event.roundId === checkpoint.roundId
      ) {
        index = cursor;
        break;
      }
    }
    return (
      index >= 0 &&
      !events.slice(index + 1).some(
        (event) =>
          event.type === 'DEBATE_CONTINUED' ||
          event.type === 'DEBATE_FINISH_REQUESTED',
      )
    );
  }

  #recentResponseIds(): readonly string[] {
    const debate = this.#focusDebate();
    if (debate === undefined) {
      return [];
    }
    return this.messages
      .listByDebate(debate.id)
      .filter((message) => message.kind === 'response')
      .slice(-8)
      .map((message) => message.id);
  }

  #boundedEvidence(): string {
    const debate = this.#debate();
    const latest = this.#latestCheckpoint();
    const watcherById = new Map(
      this.#debateWatchers().map((watcher) => [watcher.id, watcher.name]),
    );
    const responses = this.messages
      .listByDebate(debate.id)
      .filter(
        (message) =>
          message.kind === 'response' && watcherById.has(message.senderId),
      )
      .slice(-8)
      .map(
        (message) => `${watcherById.get(message.senderId) ?? message.senderId}:\n${message.body}`,
      )
      .join('\n\n');
    const interventions = this.events
      .listByDebate(debate.id)
      .filter((event) => event.type === 'OPERATOR_INTERVENTION')
      .map((event) => stringField(asPayload(event.payload), 'guidance'))
      .filter((guidance): guidance is string => guidance !== undefined)
      .slice(-3)
      .join('\n\n');
    return [
      `Original Operator problem:\n${debate.topic}`,
      latest ? `Latest Coordinator checkpoint:\n${latest.body}` : undefined,
      interventions ? `Operator guidance:\n${interventions}` : undefined,
      responses ? `Recent Watcher answers:\n${responses}` : undefined,
    ]
      .filter((part): part is string => part !== undefined)
      .join('\n\n');
  }

  #bindingSnapshot(
    agent: Agent,
    now: number,
  ): RayzanSnapshot['browserBindings'][number] {
    const binding = this.#bindings.get(agent.id);
    const presence = this.#presence.get(agent.id);
    const last = this.transport
      .listAll()
      .filter((delivery) => delivery.recipientId === agent.id)
      .at(-1);
    let state: 'bound' | 'not-bound' | 'unavailable' = 'not-bound';
    if (binding?.available === false) {
      state = 'unavailable';
    } else if (binding?.available === true) {
      state = now - binding.lastSeen < CONNECTED_MS ? 'bound' : 'unavailable';
    }
    return {
      agentId: agent.id,
      name: agent.name,
      role: agent.role,
      ...(this.#providerFor(agent.id)
        ? { provider: this.#providerFor(agent.id) }
        : {}),
      state,
      ...(last ? { lastDelivery: { id: last.id, status: last.status } } : {}),
      ...(binding?.error || presence?.error
        ? { error: binding?.error ?? presence?.error }
        : {}),
    };
  }

  #providerFor(agentId: string): string | undefined {
    const catalog = this.#agentProviders.get(agentId);
    if (catalog !== undefined) {
      return catalog;
    }
    const binding = this.#bindings.get(agentId);
    if (binding?.provider !== undefined) {
      return binding.provider;
    }
    const presence = this.#presence.get(asAgentId(agentId));
    if (presence?.provider !== undefined) {
      return presence.provider;
    }
    return undefined;
  }

  #agentId(name: string): string {
    const slug =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'agent';
    if (this.agents.getById(asAgentId(slug)) === undefined) {
      return slug;
    }
    let suffix = 2;
    while (this.agents.getById(asAgentId(`${slug}-${suffix}`)) !== undefined) {
      suffix += 1;
    }
    return `${slug}-${suffix}`;
  }

  #nextId(prefix: string): string {
    this.#seq += 1;
    return `${prefix}-${this.#seq}`;
  }

  #emit(
    type: EventType,
    input: {
      debateId?: string;
      roundId?: string;
      agentId?: string;
      causationEventId?: string;
      correlationId?: string;
      payload?: unknown;
    },
  ): Event {
    // Listeners are notified by the EventStore append wrapper.
    return recordEvent(this.events, { type, ...input });
  }

  #lastEventId(type: EventType): string | undefined {
    return this.events
      .listAll()
      .filter((event) => event.type === type)
      .at(-1)?.id;
  }

  #eventLog(): readonly string[] {
    const events = this.events.listAll();
    if (events.length === 0) {
      return [];
    }
    const restored = this.debates.list().length > 0;
    const incompleteHistory =
      !restored && events.some((item) => item.type === 'DEBATE_CREATED');
    const lines: string[] = [
      'Persisted Debate Events',
      incompleteHistory
        ? 'History available. Runtime reconstruction incomplete.'
        : restored
          ? 'Runtime restored by deterministic event replay. Browser jobs were not resumed.'
          : 'Append-only event history. Survives process restart.',
    ];
    for (const event of events) {
      lines.push('');
      lines.push(clock(event.timestamp));
      lines.push(event.type);
      lines.push(`id: ${event.id}`);
      lines.push(
        `schema: ${event.schemaVersion === 0 ? 'legacy' : `v${event.schemaVersion}`}`,
      );
      lines.push(`at: ${event.timestamp.toISOString()}`);
      if (event.causationEventId !== undefined) {
        lines.push(`caused by: ${event.causationEventId}`);
      }
      if (event.correlationId !== undefined) {
        lines.push(`correlation: ${event.correlationId}`);
      }
      if (event.debateId !== undefined) {
        lines.push(event.debateId);
      }
      const detail = this.#eventDetail(event);
      if (detail !== undefined) {
        lines.push(detail);
      }
    }
    return lines;
  }

  #rehydrate(): ReplayResult {
    const events = this.events.listAll();
    this.#participation.clear();
    if (events.length === 0) {
      this.#bootstrapOperator();
      return emptyReplayResult('FRESH');
    }
    const result = new EventReplayer().replay(events, this.#replayTarget());
    this.#syncLogicalFlags();
    this.#bumpSeqFromRestoredIds();
    this.#restoredFromHistory = this.debates.list().length > 0;
    this.#freezeRestoredSideEffects = this.#activeDebate() !== undefined;
    if (this.agents.getById(asAgentId(OPERATOR_ID)) === undefined) {
      this.agents.register(
        createAgent({
          id: OPERATOR_ID,
          name: 'Operator',
          role: 'operator',
        }),
      );
    }
    // Resume Round 2 / synthesis if a prior debate stalled mid-flow.
    this.#ensureRound2Bootstrapped();
    this.#ensureSynthesisQueued();
    return result;
  }

  #bootstrapOperator(): void {
    const operator = createAgent({
      id: OPERATOR_ID,
      name: 'Operator',
      role: 'operator',
    });
    this.agents.register(operator);
    this.#emit('AGENT_REGISTERED', {
      agentId: operator.id,
      correlationId: `agent:${operator.id}`,
      payload: { id: operator.id, name: operator.name, role: operator.role },
    });
  }

  #syncLogicalFlags(): void {
    const debate = this.#activeDebate();
    this.#started = debate !== undefined;
    if (debate === undefined) {
      this.#coordinatorBriefSent = false;
      this.#round1Dispatched = false;
      this.#round2Bootstrapped = false;
      this.#round2Dispatched = false;
      this.#synthesisQueued = false;
      this.#checkpointQueued = false;
      this.#pendingStepDeliveryIds.clear();
      this.#pendingCoordinatorDeliveryId = undefined;
      this.#coordinatorStepIndex = 0;
      this.#coordinatorDecisionPending = false;
      this.#pendingOperatorQuestion = undefined;
      this.#lastCommands = undefined;
      this.#lastError = undefined;
      this.#coordinatorRaw = undefined;
      this.#coordinatorParseError = undefined;
      this.#coordinatorProtocolDebug = undefined;
      this.#parsedChallenges = undefined;
      return;
    }
    const rounds = this.rounds.listByDebate(debate.id);
    const round1 = rounds.find((round) => round.number === 1);
    const round2 = rounds.find((round) => round.number === 2);
    const activeFollowUp = rounds
      .filter((round) => round.number > 1 && round.status !== 'completed')
      .at(-1);
    this.#round2Bootstrapped = round2 !== undefined;
    const coordinator = this.agents.listByRole('coordinator')[0];
    const messages = this.messages.listByDebate(debate.id);
    this.#coordinatorBriefSent = messages.some(
      (message) =>
        message.senderId === OPERATOR_ID &&
        coordinator !== undefined &&
        message.recipientIds.includes(coordinator.id),
    );
    this.#round1Dispatched = messages.some(
      (message) =>
        coordinator !== undefined &&
        message.senderId === coordinator.id &&
        (message.kind === 'brief' || message.kind === 'query') &&
        round1 !== undefined &&
        message.roundId === round1.id,
    );
    this.#round2Dispatched =
      activeFollowUp !== undefined &&
      messages.some(
        (message) =>
          message.roundId === activeFollowUp.id && message.kind === 'query',
      );
    this.#synthesisQueued = this.#synthesisAlreadyQueuedOrStored();
    this.#checkpointQueued = false;
    this.#restoreCoordinatorActionLoop(debate.id);
  }

  /**
   * Rebuild Coordinator action-step flags from the event log after replay.
   * Does not re-dispatch browser work.
   */
  #restoreCoordinatorActionLoop(debateId: string): void {
    this.#pendingStepDeliveryIds.clear();
    this.#pendingCoordinatorDeliveryId = undefined;
    this.#coordinatorStepIndex = 0;
    this.#coordinatorDecisionPending = false;
    this.#pendingOperatorQuestion = undefined;
    const active = this.#activeConsultationRound();
    if (active === undefined || this.checkpoints.getByRoundId(active.id)) {
      return;
    }
    const events = this.events.listByDebate(asDebateId(debateId));

    // Restore pending ask_operator if unanswered.
    const questions = events.filter(
      (event) =>
        event.type === 'COORDINATOR_OPERATOR_QUESTION_CREATED' &&
        event.roundId === active.id,
    );
    const latestQuestion = questions.at(-1);
    if (latestQuestion !== undefined) {
      const qPayload = latestQuestion.payload as {
        readonly question?: string;
        readonly createdAt?: string;
      };
      const answeredAfter = events
        .slice(events.indexOf(latestQuestion) + 1)
        .some((event) => {
          if (event.type !== 'OPERATOR_INTERVENTION') {
            return false;
          }
          const payload = event.payload as { readonly kind?: string };
          return payload.kind === 'ask_operator_answer';
        });
      if (!answeredAfter && typeof qPayload.question === 'string') {
        this.#pendingOperatorQuestion = {
          debateId: active.debateId,
          roundId: active.id,
          question: qPayload.question,
          createdAt:
            typeof qPayload.createdAt === 'string'
              ? qPayload.createdAt
              : latestQuestion.timestamp.toISOString(),
        };
        this.#coordinatorDecisionPending = false;
        const actionForQuestion = events
          .filter(
            (event) =>
              event.type === 'COORDINATOR_ACTION_CREATED' &&
              event.roundId === active.id,
          )
          .at(-1);
        const actionPayload = actionForQuestion?.payload as
          | { readonly stepIndex?: number }
          | undefined;
        this.#coordinatorStepIndex =
          typeof actionPayload?.stepIndex === 'number'
            ? actionPayload.stepIndex
            : questions.length;
        return;
      }
    }

    const actions = events.filter(
      (event) =>
        event.type === 'COORDINATOR_ACTION_CREATED' &&
        event.roundId === active.id,
    );
    const latest = actions.at(-1);
    if (latest === undefined) {
      this.#coordinatorDecisionPending = true;
      this.#restorePendingCoordinatorDeliveryPointer();
      return;
    }
    const payload = latest.payload as {
      readonly stepIndex?: number;
      readonly action?: string;
      readonly deliveryIds?: readonly string[];
    };
    this.#coordinatorStepIndex =
      typeof payload.stepIndex === 'number' ? payload.stepIndex : actions.length;
    if (payload.action === 'checkpoint' || payload.action === 'ask_operator') {
      return;
    }
    const deliveryIds = Array.isArray(payload.deliveryIds)
      ? payload.deliveryIds
      : [];
    const unresolved = deliveryIds.filter((id) => {
      const delivery = this.transport.getDelivery(asDeliveryId(id));
      return delivery === undefined || delivery.status !== 'responded';
    });
    if (unresolved.length > 0) {
      this.#setPendingStepDeliveries(unresolved);
      this.#coordinatorDecisionPending = false;
      return;
    }
    this.#coordinatorDecisionPending = true;
    this.#restorePendingCoordinatorDeliveryPointer();
  }

  /** After replay, re-bind the exact Coordinator delivery when exactly one remains. */
  #restorePendingCoordinatorDeliveryPointer(): void {
    if (this.#pendingCoordinatorDeliveryId !== undefined) {
      return;
    }
    const debate = this.#activeDebate();
    const coordinator = this.agents.listByRole('coordinator')[0];
    if (debate === undefined || coordinator === undefined) {
      return;
    }
    const candidates = [
      ...this.transport.listPendingForAgent(coordinator.id),
      ...this.transport.listAwaitingResponseForAgent(coordinator.id),
    ].filter((item) => item.debateId === debate.id);
    if (candidates.length === 1 && candidates[0] !== undefined) {
      this.#pendingCoordinatorDeliveryId = candidates[0].id;
    }
  }

  #resetDebateSessionState(): void {
    this.#coordinatorBriefSent = false;
    this.#round1Dispatched = false;
    this.#round2Bootstrapped = false;
    this.#round2Dispatched = false;
    this.#synthesisQueued = false;
    this.#checkpointQueued = false;
    this.#pendingStepDeliveryIds.clear();
    this.#pendingCoordinatorDeliveryId = undefined;
    this.#coordinatorStepIndex = 0;
    this.#coordinatorDecisionPending = false;
    this.#pendingOperatorQuestion = undefined;
    this.#lastError = undefined;
    this.#lastCommands = undefined;
    this.#coordinatorRaw = undefined;
    this.#coordinatorParseError = undefined;
    this.#coordinatorProtocolDebug = undefined;
    this.#parsedChallenges = undefined;
  }

  #bumpSeqFromRestoredIds(): void {
    const ids = [
      ...this.debates.list().map((item) => item.id),
      ...this.debates.list().flatMap((debate) =>
        this.rounds.listByDebate(debate.id).map((round) => round.id),
      ),
      ...this.debates.list().flatMap((debate) =>
        this.messages.listByDebate(debate.id).map((message) => message.id),
      ),
      ...this.transport.listAll().map((delivery) => delivery.id),
    ];
    for (const id of ids) {
      const match = /-(\d+)$/.exec(id);
      if (match?.[1] !== undefined) {
        const value = Number(match[1]);
        if (Number.isInteger(value)) {
          this.#seq = Math.max(this.#seq, value);
        }
      }
    }
  }

  #replayTarget(): ReplayTarget {
    return {
      getAgent: (id) => this.agents.getById(asAgentId(id)),
      registerAgent: (agent) => {
        this.agents.register(agent);
      },
      replaceAgent: (agent) => {
        this.agents.replace(agent);
      },
      setWatcherParticipation: (agentId, enabled) => {
        this.#participation.set(agentId, enabled);
      },
      getDebate: (id) => this.debates.getById(asDebateId(id)),
      createDebate: (debate) => {
        this.debates.create(debate);
      },
      updateDebate: (debate) => {
        this.debates.update(debate);
      },
      getRound: (id) => this.rounds.getById(asRoundId(id)),
      createRound: (round) => {
        this.rounds.create(round);
      },
      updateRound: (round) => {
        this.rounds.update(round);
      },
      getMessage: (id) => this.messages.getById(asMessageId(id)),
      storeMessage: (message) => {
        this.messages.store(message);
      },
      recordExposure: (record) => {
        this.exposures.record(record);
      },
      getSynthesis: (debateId) =>
        this.syntheses.getByDebateId(asDebateId(debateId)),
      storeSynthesis: (synthesis) => {
        this.syntheses.store(synthesis);
      },
      getCheckpoint: (roundId) =>
        this.checkpoints.getByRoundId(asRoundId(roundId)),
      storeCheckpoint: (checkpoint) => {
        this.checkpoints.store(checkpoint);
      },
      hydrateMessage: (message) => {
        this.transport.hydrateMessage(message);
      },
      hydrateDelivery: (delivery) => {
        this.transport.hydrateDelivery(delivery);
      },
      quarantineDelivery: (deliveryId, reason, detail) => {
        this.transport.quarantineDelivery(deliveryId, reason, detail);
      },
      getDelivery: (id) => this.transport.getDelivery(asDeliveryId(id)),
      setDeliveryStatus: (id, status) => {
        this.transport.setDeliveryStatus(id, status);
      },
      restoreRoundExecution: (roundId, participantIds) => {
        this.workflow.restoreExecution({ roundId, participantIds });
      },
      hasRoundExecution: (roundId) => this.workflow.hasExecution(roundId),
      noteRoundDelivery: (roundId, delivery) => {
        this.workflow.noteRestoredDelivery(roundId, delivery);
      },
      noteRoundConfirmed: (roundId, deliveryId) => {
        this.workflow.noteRestoredConfirmed(roundId, deliveryId);
      },
      noteRoundResponded: (roundId, deliveryId) => {
        this.workflow.noteRestoredResponded(roundId, deliveryId);
      },
      restoreRoundCompleted: (roundId) => {
        this.workflow.restoreCompleted(roundId);
      },
      restoreDeliveryReferences: (deliveryId, referencedMessageIds) => {
        this.orchestrator.restoreDeliveryReferences(
          deliveryId,
          referencedMessageIds.map((id) => asMessageId(id)),
        );
      },
      listDeliveries: () => this.transport.listAll(),
    };
  }

  #safeParticipants(
    roundId: string | undefined,
  ): RayzanSnapshot['participants'] {
    if (roundId === undefined) {
      return [];
    }
    try {
      return this.workflow.getParticipantIds(roundId).map((agentId) => {
        const agent = this.agents.getById(agentId);
        return {
          id: agentId,
          name: agent?.name ?? agentId,
          role: agent?.role ?? 'watcher',
        };
      });
    } catch {
      return [];
    }
  }

  #eventDetailsLog(): readonly string[] {
    const events = this.events.listAll();
    if (events.length === 0) {
      return [];
    }
    const blocks: string[] = [];
    for (const event of events) {
      blocks.push(
        [
          event.type,
          `id: ${event.id}`,
          `schema: ${event.schemaVersion === 0 ? 'legacy' : `v${event.schemaVersion}`}`,
          ...(event.causationEventId !== undefined
            ? [`caused by: ${event.causationEventId}`]
            : []),
          ...(event.correlationId !== undefined
            ? [`correlation: ${event.correlationId}`]
            : []),
        ].join('\n'),
      );
    }
    return blocks;
  }

  #externalActionRecoveryLog(): readonly string[] {
    const actions = this.#replayResult.externalActions.filter(
      (action) => action.state === 'IN_DOUBT' || action.state === 'failed',
    );
    if (actions.length === 0) {
      return [];
    }
    return actions.map((action) => {
      const agent = action.agentId
        ? this.#agentLabel(action.agentId)
        : 'unknown';
      return [
        `${agent} ${action.action.replaceAll('-', ' ')}`,
        action.state,
        action.reason,
      ].join('\n');
    });
  }

  #eventDetail(event: Event): string | undefined {
    const payload = asPayload(event.payload);
    if (
      event.type === 'MESSAGE_CREATED' ||
      event.type === 'MESSAGE_DISPATCHED'
    ) {
      const sender = this.#agentLabel(
        stringField(payload, 'senderId') ?? event.agentId,
      );
      const recipients = stringList(payload.recipientIds).map((id) =>
        this.#agentLabel(id),
      );
      if (recipients.length === 0) {
        return sender;
      }
      return `${sender} → ${recipients.join(', ')}`;
    }
    if (event.type === 'RESPONSE_CAPTURED') {
      return this.#agentLabel(
        stringField(payload, 'senderId') ?? event.agentId,
      );
    }
    if (event.type === 'AGENT_REGISTERED') {
      const name = stringField(payload, 'name');
      const role = stringField(payload, 'role');
      if (name && role) {
        return `${name} (${role})`;
      }
      return this.#agentLabel(event.agentId);
    }
    if (event.type === 'COORDINATOR_CHANGED') {
      const previous = this.#agentLabel(stringField(payload, 'previousAgentId'));
      const next = this.#agentLabel(stringField(payload, 'newAgentId'));
      return `${previous} → ${next}`;
    }
    if (event.type === 'WATCHER_PARTICIPATION_CHANGED') {
      const name = this.#agentLabel(
        stringField(payload, 'agentId') ?? event.agentId,
      );
      return payload.enabled === false
        ? `${name} excluded from next debate`
        : `${name} included in next debate`;
    }
    if (event.type === 'SYNTHESIS_CREATED') {
      return this.#agentLabel(
        stringField(payload, 'coordinatorId') ?? event.agentId,
      );
    }
    return undefined;
  }

  #agentLabel(id: string | undefined): string {
    if (id === undefined || id.trim().length === 0) {
      return 'unknown';
    }
    return this.agents.getById(asAgentId(id))?.name ?? id;
  }

  #record(line: string): void {
    this.#log.push(line);
  }
}

function asPhase(value: string | undefined): AgentPhase {
  switch (value) {
    case 'waiting':
    case 'sending':
    case 'generating':
    case 'capturing':
    case 'captured':
    case 'attention':
    case 'error':
    case 'idle':
      return value;
    default:
      return 'waiting';
  }
}

const DEBUG_SESSION_STATES = [
  'connected',
  'restoring',
  'connecting',
  'logged_out',
  'error',
  'not_connected',
  'unknown',
] as const;
const DEBUG_PAGE_STATES = [
  'ready',
  'loading',
  'navigating',
  'hidden',
  'error',
  'none',
  'unknown',
] as const;
const DEBUG_SEND_STATES = [
  'unknown',
  'idle',
  'preparing',
  'composer_ready',
  'submitting',
  'accepted',
  'failed',
] as const;
const DEBUG_GENERATION_STATES = ['idle', 'active', 'ended', 'unknown'] as const;

function normalizeManagedDebugState(
  record: Record<string, unknown>,
): ManagedProviderDebugState {
  const pick = (
    allowed: readonly string[],
    value: unknown,
  ): string | undefined =>
    typeof value === 'string' && (allowed as readonly string[]).includes(value)
      ? value
      : undefined;
  const session =
    record.session !== null && typeof record.session === 'object'
      ? (record.session as Record<string, unknown>)
      : undefined;
  const page =
    record.page !== null && typeof record.page === 'object'
      ? (record.page as Record<string, unknown>)
      : undefined;
  const conversation =
    record.conversation !== null && typeof record.conversation === 'object'
      ? (record.conversation as Record<string, unknown>)
      : undefined;
  const send =
    record.send !== null && typeof record.send === 'object'
      ? (record.send as Record<string, unknown>)
      : undefined;
  const generation =
    record.generation !== null && typeof record.generation === 'object'
      ? (record.generation as Record<string, unknown>)
      : undefined;
  const probe =
    record.probe !== null && typeof record.probe === 'object'
      ? (record.probe as Record<string, unknown>)
      : undefined;
  const transitions = Array.isArray(record.transitions)
    ? record.transitions
        .filter(
          (item): item is Record<string, unknown> =>
            item !== null &&
            typeof item === 'object' &&
            typeof (item as Record<string, unknown>).at === 'number' &&
            typeof (item as Record<string, unknown>).label === 'string',
        )
        .slice(-40)
        .map((item) => ({
          at: item.at as number,
          label: item.label as string,
          ...(typeof item.detail === 'string' ? { detail: item.detail } : {}),
        }))
    : undefined;
  const sessionState = pick(DEBUG_SESSION_STATES, session?.state);
  const pageState = pick(DEBUG_PAGE_STATES, page?.state);
  const sendState = pick(DEBUG_SEND_STATES, send?.state);
  const generationState = pick(DEBUG_GENERATION_STATES, generation?.state);
  return {
    providerId: String(record.providerId),
    ...(sessionState !== undefined
      ? {
          session: {
            state: sessionState as DebugSessionState,
            ...(typeof session?.detail === 'string'
              ? { detail: session.detail }
              : {}),
            ...(typeof session?.loggedIn === 'boolean'
              ? { loggedIn: session.loggedIn }
              : {}),
          },
        }
      : {}),
    ...(pageState !== undefined
      ? {
          page: {
            state: pageState as DebugPageState,
            ...(typeof page?.url === 'string' ? { url: page.url } : {}),
            ...(typeof page?.visible === 'boolean'
              ? { visible: page.visible }
              : {}),
          },
        }
      : {}),
    ...(conversation !== undefined &&
    (conversation.state === 'ready' ||
      conversation.state === 'none' ||
      conversation.state === 'unknown')
      ? {
          conversation: {
            state: conversation.state,
            ...(typeof conversation.conversationId === 'string'
              ? { conversationId: conversation.conversationId }
              : {}),
          },
        }
      : {}),
    ...(sendState !== undefined
      ? {
          send: {
            state: sendState as DebugSendState,
            ...(typeof send?.error === 'string' ? { error: send.error } : {}),
          },
        }
      : {}),
    ...(generationState !== undefined
      ? { generation: { state: generationState as DebugGenerationState } }
      : {}),
    ...(probe !== undefined
      ? {
          probe: {
            ...(typeof probe.hasComposer === 'boolean'
              ? { hasComposer: probe.hasComposer }
              : {}),
            ...(typeof probe.hasSend === 'boolean'
              ? { hasSend: probe.hasSend }
              : {}),
            ...(typeof probe.generating === 'boolean'
              ? { generating: probe.generating }
              : {}),
            ...(typeof probe.url === 'string' ? { url: probe.url } : {}),
            ...(typeof probe.title === 'string' ? { title: probe.title } : {}),
          },
        }
      : {}),
    ...(typeof record.lastError === 'string'
      ? { lastError: record.lastError }
      : {}),
    ...(typeof record.lastChangedAt === 'number'
      ? { lastChangedAt: record.lastChangedAt }
      : {}),
    ...(transitions !== undefined ? { transitions } : {}),
  };
}

function asCaptureState(value: unknown): BrowserCaptureState | undefined {  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.phase !== 'string') {
    return undefined;
  }
  return {
    phase: record.phase,
    ...(typeof record.deliveryId === 'string'
      ? { deliveryId: record.deliveryId }
      : {}),
    ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
    ...(typeof record.promptSubmitted === 'boolean'
      ? { promptSubmitted: record.promptSubmitted }
      : {}),
    ...(typeof record.preSendTurnCount === 'number'
      ? { preSendTurnCount: record.preSendTurnCount }
      : {}),
    ...(typeof record.currentTurnCount === 'number'
      ? { currentTurnCount: record.currentTurnCount }
      : {}),
    ...(typeof record.trackedIdentity === 'string'
      ? { trackedIdentity: record.trackedIdentity }
      : {}),
    ...(typeof record.trackedConnected === 'boolean'
      ? { trackedConnected: record.trackedConnected }
      : {}),
    ...(typeof record.textLength === 'number'
      ? { textLength: record.textLength }
      : {}),
    ...(typeof record.posted === 'boolean' ? { posted: record.posted } : {}),
    ...(typeof record.generationEndedAt === 'number'
      ? { generationEndedAt: record.generationEndedAt }
      : {}),
    ...(typeof record.capturedAt === 'number'
      ? { capturedAt: record.capturedAt }
      : {}),
    ...(typeof record.domChangedAfterTerminal === 'boolean'
      ? { domChangedAfterTerminal: record.domChangedAfterTerminal }
      : {}),
    ...(typeof record.domChangedAfterCapture === 'boolean'
      ? { domChangedAfterCapture: record.domChangedAfterCapture }
      : {}),
  };
}

function clock(timestamp: Date): string {
  return timestamp.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function asPayload(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function stringField(
  payload: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = payload[key];
  return typeof value === 'string' ? value : undefined;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function notifyEventAppend(
  store: EventStore,
  onAppend: (event: Event) => void,
): EventStore {
  return {
    append(event) {
      store.append(event);
      onAppend(event);
    },
    getById(id) {
      return store.getById(id);
    },
    listByDebate(debateId) {
      return store.listByDebate(debateId);
    },
    listAll() {
      return store.listAll();
    },
  };
}
