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
  createDebate,
  createDebateSynthesis,
  createRound,
  InMemoryAgentRegistry,
  InMemoryDebateStore,
  InMemoryExposureLedgerStore,
  InMemoryMessageStore,
  InMemoryRoundStore,
  InMemorySynthesisStore,
  type Agent,
  type AgentId,
  type AgentRole,
  type Round,
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
  type ReplayResult,
  type ReplayTarget,
} from '@rayzan/orchestrator';

import {
  coordinatorRound1Prompt,
  coordinatorRound2Prompt,
  coordinatorSynthesisPrompt,
  synthesisEvidencePacket,
  unwrapCoordinatorJson,
} from './coordinator-prompt.js';
import { OPERATOR_ID } from './demo-ids.js';
import {
  commonRound1Evidence,
  composeRound2WatcherBody,
  mergeReferencedMessageIds,
  round1EvidencePacket,
  watcherChallengesFromBatch,
  type AttributedWatcherResponse,
  type WatcherChallenge,
} from './round2-policy.js';

export type AgentPhase =
  'idle' | 'waiting' | 'sending' | 'generating' | 'captured' | 'error';

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

export interface RayzanSnapshot {
  readonly bridge: 'connected';
  readonly sessionStarted: boolean;
  readonly restoredFromHistory: boolean;
  readonly debate?: {
    readonly id: string;
    readonly topic: string;
    readonly status: string;
  };
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
    readonly capture?: BrowserCaptureState;
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
  readonly lastCommands?: string;
  readonly lastError?: string;
  readonly log: readonly string[];
  readonly eventLog: readonly string[];
  readonly messages: readonly {
    readonly id: string;
    readonly senderId: string;
    readonly recipientIds: readonly string[];
    readonly kind: string;
    readonly body: string;
  }[];
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

  #started = false;
  #coordinatorBriefSent = false;
  #round1Dispatched = false;
  #round2Bootstrapped = false;
  #round2Dispatched = false;
  #synthesisQueued = false;
  #seq = 0;
  #log: string[] = [];
  #lastError: string | undefined;
  #lastCommands: string | undefined;
  #coordinatorRaw: string | undefined;
  #coordinatorParseError: string | undefined;
  #parsedChallenges: readonly WatcherChallenge[] | undefined;
  #replayResult: ReplayResult = emptyReplayResult();
  #restoredFromHistory = false;
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

  constructor(events: EventStore = new InMemoryEventStore()) {
    this.events = events;
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
      payload: { id: agent.id, name: agent.name, role: agent.role },
    });
    this.#record(`Registered ${agent.name} as ${agent.role} (${agent.id}).`);
    return agent;
  }

  /**
   * Temporary Phase 3A bootstrap. Creates one active Debate and Round 1
   * because the Coordinator `start-round` command is intentionally deferred.
   * Participants are the currently registered Watchers. Does not send any
   * browser deliveries.
   */
  createRound1(problem: string): void {
    if (this.#restoredFromHistory) {
      throw new Error(
        'A debate was restored from event history. Replay does not resend prompts or resume capture. Park apps/rayzan-local/data/rayzan.sqlite and start Rayzan with a fresh database to run a new live debate.',
      );
    }
    if (this.#started) {
      throw new Error('Round 1 already started');
    }
    const trimmed = problem.trim();
    if (trimmed.length === 0) {
      throw new Error('problem cannot be empty');
    }
    this.#requireSingleCoordinator();
    const watchers = this.agents.listByRole('watcher');
    if (watchers.length < 1) {
      throw new Error('register at least one Watcher before creating Round 1');
    }

    const debateId = this.#nextId('debate');
    const roundId = this.#nextId('round');
    this.debates.create(
      createDebate({
        id: debateId,
        topic: trimmed,
        status: 'active',
      }),
    );
    this.#emit('DEBATE_CREATED', {
      debateId,
      payload: { topic: trimmed, status: 'active' },
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
      payload: {
        number: 1,
        participantIds: watchers.map((watcher) => watcher.id),
      },
    });
    this.workflow.startRound({
      roundId,
      participantIds: watchers.map((watcher) => watcher.id),
    });
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
    if (this.#coordinatorBriefSent) {
      throw new Error('Coordinator Round 1 prompt already queued');
    }
    if (this.#restoredFromHistory) {
      throw new Error(
        'A debate was restored from event history. Replay does not resend prompts or resume capture. Park apps/rayzan-local/data/rayzan.sqlite and start Rayzan with a fresh database to run a new live debate.',
      );
    }
    if (!this.#started) {
      this.createRound1(problem);
    }
    const watchers = this.agents.listByRole('watcher');
    if (watchers.length < 2) {
      throw new Error(
        'register at least two Watchers before running live Round 1',
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
    this.orchestrator.dispatch(intent);
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
    this.orchestrator.dispatch(intent);
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
    this.#bindings.set(agent.id, {
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.tabId ? { tabId: input.tabId } : {}),
      lastSeen: Date.now(),
      available: input.available,
      ...(input.error ? { error: input.error } : {}),
    });
    this.#record(
      input.available
        ? `Browser binding set for ${agent.name}${input.provider ? ` (${input.provider})` : ''}.`
        : `Browser binding unavailable for ${agent.name}.`,
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
      (previous?.phase === 'error' || capture?.phase === 'failed')
    ) {
      phase = 'error';
    }
    const error =
      input.error ??
      (phase === 'sending' || phase === 'captured'
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
  }

  listAgents(): readonly Agent[] {
    return this.agents.list();
  }

  nextPendingForAgent(agentId: string): PendingBrowserJob | undefined {
    if (!this.#started) {
      return undefined;
    }
    return this.#jobFromDelivery(
      this.transport.listPendingForAgent(this.#requireAgent(agentId).id)[0],
    );
  }

  awaitingResponseForAgent(agentId: string): PendingBrowserJob | undefined {
    if (!this.#started) {
      return undefined;
    }
    return this.#jobFromDelivery(
      this.transport.listAwaitingResponseForAgent(
        this.#requireAgent(agentId).id,
      )[0],
    );
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

    const confirmed =
      delivery.roundId === undefined
        ? this.orchestrator.confirmDelivery(deliveryId)
        : this.workflow.confirmDelivery(delivery.roundId, deliveryId);
    this.#record(`Delivery ${deliveryId} marked delivered.`);
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

    if (agent.role === 'coordinator') {
      this.#handleCoordinatorResponse(inbound.message.body);
      return;
    }

    this.#advanceAfterWatcherResponse();
  }

  snapshot(): RayzanSnapshot {
    const debateRecord = this.debates.list()[0];
    const round1 = this.#roundByNumber(1);
    const round2 = this.#roundByNumber(2);
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
      ...(debateRecord
        ? {
            debate: {
              id: debateRecord.id,
              topic: debateRecord.topic,
              status: debateRecord.status,
            },
          }
        : {}),
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
      agents: this.agents.list().map((agent) => {
        const presence = this.#presence.get(agent.id);
        const response = this.#latestResponseFrom(agent.id);
        return {
          id: agent.id,
          name: agent.name,
          role: agent.role,
          ...(presence?.provider ? { provider: presence.provider } : {}),
          connected:
            presence !== undefined && now - presence.lastSeen < CONNECTED_MS,
          phase: presence?.phase ?? 'idle',
          ...(presence?.error ? { error: presence.error } : {}),
          ...(response ? { response } : {}),
          round1Status: this.#round1Status(agent),
          round2Status: this.#round2Status(agent),
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
      ...(this.#lastCommands ? { lastCommands: this.#lastCommands } : {}),
      ...(this.#lastError ? { lastError: this.#lastError } : {}),
      log: [...this.#log],
      eventLog: this.#eventLog(),
      messages: debateRecord
        ? this.messages.listByDebate(debateRecord.id).map((message) => ({
            id: message.id,
            senderId: message.senderId,
            recipientIds: [...message.recipientIds],
            kind: message.kind,
            body: message.body,
          }))
        : [],
      replay: this.#replayResult,
    });
  }

  #advanceAfterWatcherResponse(): void {
    this.#maybeCompleteRound1();
    this.#maybeCompleteRound2AndSynthesize();
  }

  #maybeCompleteRound1(): void {
    const round1 = this.#roundByNumber(1);
    if (round1 === undefined || round1.status === 'completed') {
      return;
    }
    try {
      const progress = this.workflow.getRoundProgress(round1.id);
      if (!progress.complete) {
        return;
      }
      this.workflow.completeRound(round1.id);
      this.#emit('ROUND_COMPLETED', {
        debateId: round1.debateId,
        roundId: round1.id,
        payload: { number: 1, status: 'completed' },
      });
      this.#record('Round 1 auto-completed after all Watcher responses.');
      this.#bootstrapRound2AndNotifyCoordinator();
    } catch {
      // Collection not ready.
    }
  }

  #maybeCompleteRound2AndSynthesize(): void {
    const round2 = this.#roundByNumber(2);
    if (
      round2 === undefined ||
      round2.status === 'completed' ||
      !this.#round2Dispatched
    ) {
      return;
    }
    try {
      const progress = this.workflow.getRoundProgress(round2.id);
      if (!progress.complete) {
        return;
      }
      this.workflow.completeRound(round2.id);
      this.#emit('ROUND_COMPLETED', {
        debateId: round2.debateId,
        roundId: round2.id,
        payload: { number: 2, status: 'completed' },
      });
      this.#record('Round 2 auto-completed after all Watcher responses.');
      this.#queueCoordinatorSynthesis();
    } catch {
      // Collection not ready.
    }
  }

  #bootstrapRound2AndNotifyCoordinator(): void {
    if (this.#round2Bootstrapped) {
      return;
    }
    const failed = this.agents
      .listByRole('watcher')
      .find((watcher) => this.#round1Status(watcher) === 'failed');
    if (failed) {
      this.#lastError = `${failed.name}: Capture failed; Coordinator was not contacted.`;
      return;
    }
    const watchers = this.agents.listByRole('watcher');
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
    this.orchestrator.dispatch(intent);
    this.#record('Round 1 evidence packet queued for Coordinator.');
  }

  #handleCoordinatorResponse(text: string): void {
    this.#lastCommands = text;
    if (!this.#round1Dispatched) {
      this.#handleRound1CoordinatorBrief(text);
      return;
    }
    if (!this.#round2Dispatched) {
      this.#handleRound2CoordinatorPlan(text);
      return;
    }
    this.#storeCoordinatorSynthesis(text);
  }

  #handleRound1CoordinatorBrief(text: string): void {
    try {
      const batch = this.#bindRound1DispatchIds(
        parseCoordinatorCommandBatch(unwrapCoordinatorJson(text)),
      );
      const dispatches = batch.commands.filter(
        (command) => command.type === 'dispatch',
      );
      if (dispatches.length === 0) {
        throw new Error('Coordinator Round 1 response had no dispatch command');
      }
      this.executor.execute(
        createCoordinatorExecutionContext({
          coordinatorId: this.#requireSingleCoordinator().id,
          debateId: this.#debate().id,
        }),
        Object.freeze({
          version: batch.version,
          commands: Object.freeze(dispatches),
        }),
      );
      this.#round1Dispatched = true;
      this.#lastError = undefined;
      this.#record(
        'Coordinator Round 1 brief parsed; Watcher prompts queued with Coordinator as sender.',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#lastError = message;
      this.#record(`Coordinator Round 1 command PARSE FAILED: ${message}`);
    }
  }

  #handleRound2CoordinatorPlan(text: string): void {
    this.#coordinatorRaw = text;
    this.#coordinatorParseError = undefined;
    this.#parsedChallenges = undefined;
    try {
      const batch = parseCoordinatorCommandBatch(unwrapCoordinatorJson(text));
      const watchers = this.agents.listByRole('watcher');
      const challenges = watcherChallengesFromBatch({ batch, watchers });
      this.#parsedChallenges = challenges;
      this.#lastError = undefined;
      this.#record('Coordinator Round 2 plan parsed.');
      this.#dispatchPersonalizedRound2(challenges);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#coordinatorParseError = message;
      this.#lastError = message;
      this.#record(`Coordinator command PARSE FAILED: ${message}`);
    }
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
            debateId,
            roundId,
          });
        }),
      ),
    });
  }

  #dispatchPersonalizedRound2(challenges: readonly WatcherChallenge[]): void {
    if (this.#round2Dispatched) {
      return;
    }
    const round2 = this.#requireRoundNumber(2);
    const debate = this.#debate();
    const responses = this.#round1Responses();
    const baselineIds = responses.map((response) => response.messageId);
    const common = commonRound1Evidence({ responses });

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
          body: composeRound2WatcherBody(
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
      'Personalized Round 2 prompts queued (common evidence prepended).',
    );
  }

  #queueCoordinatorSynthesis(): void {
    if (this.#synthesisQueued) {
      return;
    }
    const debate = this.#debate();
    const coordinator = this.#requireSingleCoordinator();
    const evidencePacket = synthesisEvidencePacket({
      problem: debate.topic,
      coordinatorBrief: this.#coordinatorRound1Brief(),
      round1Responses: this.#round1Responses(),
      round2Plan: this.#parsedChallenges?.map((challenge) => ({
        name: challenge.name,
        challenge: challenge.challenge,
      })),
      round2Responses: this.#round2Responses(),
    });
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
        referencedMessageIds: [
          ...this.#round1Responses(),
          ...this.#round2Responses(),
        ].map((response) => response.messageId),
      }),
    );
    this.orchestrator.dispatch(intent);
    this.#synthesisQueued = true;
    this.#record('Synthesis evidence packet queued for Coordinator.');
  }

  #storeCoordinatorSynthesis(text: string): void {
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
      this.#emit('SYNTHESIS_CREATED', {
        debateId: synthesis.debateId,
        agentId: synthesis.coordinatorId,
        payload: {
          coordinatorId: synthesis.coordinatorId,
          body: synthesis.body,
          createdAt: synthesis.createdAt,
        },
      });
      this.debates.update(
        createDebate({
          id: debate.id,
          topic: debate.topic,
          status: 'completed',
        }),
      );
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
    const debate = this.debates.list()[0];
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
    const debate = this.debates.list()[0];
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
    const debate = this.debates.list()[0];
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
    const watchers = this.agents.listByRole('watcher');
    const round1 = this.#roundByNumber(1);
    const coordinator = this.agents.listByRole('coordinator')[0];
    const coordinatorCapture = coordinator
      ? this.#presence.get(coordinator.id)?.capture
      : undefined;
    const coordinatorDeliveries = coordinator
      ? this.transport
          .listAll()
          .filter((delivery) => delivery.recipientId === coordinator.id)
      : [];
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
    const debate = this.debates.list()[0];
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

  #deliveryFor(
    agentId: AgentId,
    roundId: string | undefined,
  ): OutboundDelivery | undefined {
    if (roundId === undefined) {
      return undefined;
    }
    return this.transport
      .listAll()
      .find(
        (delivery) =>
          delivery.recipientId === agentId && delivery.roundId === roundId,
      );
  }

  #latestResponseFrom(agentId: AgentId): string | undefined {
    const debate = this.debates.list()[0];
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

  #requireSingleCoordinator(): Agent {
    const coordinators = this.agents.listByRole('coordinator');
    if (coordinators.length !== 1) {
      throw new Error(
        'register exactly one Coordinator before starting Round 1',
      );
    }
    return coordinators[0]!;
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
    const debate = this.debates.list()[0];
    if (debate === undefined) {
      throw new Error('debate missing');
    }
    return debate;
  }

  #roundByNumber(number: number): Round | undefined {
    const debate = this.debates.list()[0];
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
      ...(binding?.provider || presence?.provider
        ? { provider: binding?.provider ?? presence?.provider }
        : {}),
      state,
      ...(last ? { lastDelivery: { id: last.id, status: last.status } } : {}),
      ...(binding?.error || presence?.error
        ? { error: binding?.error ?? presence?.error }
        : {}),
    };
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
      payload?: unknown;
    },
  ): void {
    recordEvent(this.events, { type, ...input });
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
      lines.push(`at: ${event.timestamp.toISOString()}`);
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
    if (events.length === 0) {
      this.#bootstrapOperator();
      return emptyReplayResult('FRESH');
    }
    const result = new EventReplayer().replay(events, this.#replayTarget());
    this.#syncLogicalFlags();
    this.#bumpSeqFromRestoredIds();
    this.#restoredFromHistory = this.debates.list().length > 0;
    if (this.agents.getById(asAgentId(OPERATOR_ID)) === undefined) {
      this.agents.register(
        createAgent({
          id: OPERATOR_ID,
          name: 'Operator',
          role: 'operator',
        }),
      );
    }
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
      payload: { id: operator.id, name: operator.name, role: operator.role },
    });
  }

  #syncLogicalFlags(): void {
    const debate = this.debates.list()[0];
    this.#started = debate !== undefined;
    const round1 = this.#roundByNumber(1);
    const round2 = this.#roundByNumber(2);
    this.#round2Bootstrapped = round2 !== undefined;
    const coordinator = this.agents.listByRole('coordinator')[0];
    const messages =
      debate === undefined ? [] : this.messages.listByDebate(debate.id);
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
      round2 !== undefined &&
      messages.some(
        (message) =>
          message.roundId === round2.id && message.kind === 'query',
      );
    this.#synthesisQueued =
      (debate !== undefined &&
        this.syntheses.getByDebateId(debate.id) !== undefined) ||
      messages.some(
        (message) =>
          coordinator !== undefined &&
          message.recipientIds.includes(coordinator.id) &&
          message.kind === 'input' &&
          this.#round2Dispatched,
      );
  }

  #bumpSeqFromRestoredIds(): void {
    const debate = this.debates.list()[0];
    const ids = [
      ...this.debates.list().map((item) => item.id),
      ...(debate
        ? this.rounds.listByDebate(debate.id).map((round) => round.id)
        : []),
      ...(debate
        ? this.messages.listByDebate(debate.id).map((message) => message.id)
        : []),
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
      hydrateMessage: (message) => {
        this.transport.hydrateMessage(message);
      },
      hydrateDelivery: (delivery) => {
        this.transport.hydrateDelivery(delivery);
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
    case 'captured':
    case 'error':
    case 'idle':
      return value;
    default:
      return 'waiting';
  }
}

function asCaptureState(value: unknown): BrowserCaptureState | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
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
