import {
  asAgentId,
  createAgent,
  createDebate,
  createRound,
  InMemoryAgentRegistry,
  InMemoryDebateStore,
  InMemoryExposureLedgerStore,
  InMemoryMessageStore,
  InMemoryRoundStore,
  type Agent,
  type AgentId,
  type AgentRole,
} from '@rayzan/protocol';
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
  Orchestrator,
  parseCoordinatorCommandBatch,
  RoundWorkflow,
  type CoordinatorCommandBatch,
} from '@rayzan/orchestrator';

import {
  coordinatorRound1Prompt,
  unwrapCoordinatorJson,
} from './coordinator-prompt.js';
import { OPERATOR_ID } from './demo-ids.js';

export type AgentPhase =
  'idle' | 'waiting' | 'sending' | 'generating' | 'captured' | 'error';

export interface PendingBrowserJob {
  readonly deliveryId: string;
  readonly messageId: string;
  readonly recipientId: string;
  readonly senderId: string;
  readonly body: string;
  readonly kind: string;
}

export interface AgentPresence {
  readonly agentId: string;
  readonly provider?: string;
  readonly phase: AgentPhase;
  readonly error?: string;
  readonly lastSeen: number;
  readonly diagnostics?: unknown;
}

export interface RayzanSnapshot {
  readonly bridge: 'connected';
  readonly sessionStarted: boolean;
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
  readonly agents: readonly {
    readonly id: string;
    readonly name: string;
    readonly role: string;
    readonly provider?: string;
    readonly connected: boolean;
    readonly phase: AgentPhase;
    readonly error?: string;
    readonly response?: string;
  }[];
  readonly deliveries: readonly {
    readonly id: string;
    readonly messageId: string;
    readonly senderId: string;
    readonly recipientId: string;
    readonly status: string;
    readonly roundId?: string;
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
  readonly lastCommands?: string;
  readonly lastError?: string;
  readonly log: readonly string[];
  readonly messages: readonly {
    readonly id: string;
    readonly senderId: string;
    readonly recipientIds: readonly string[];
    readonly kind: string;
    readonly body: string;
  }[];
}

const CONNECTED_MS = 8000;

export class RayzanRuntime {
  readonly agents = new InMemoryAgentRegistry();
  readonly debates = new InMemoryDebateStore();
  readonly rounds = new InMemoryRoundStore();
  readonly messages = new InMemoryMessageStore();
  readonly exposures = new InMemoryExposureLedgerStore();
  readonly transport = new BrowserTransport();
  readonly orchestrator = new Orchestrator(
    this.messages,
    this.exposures,
    this.transport,
  );
  readonly planner = new DispatchPlanner(this.agents);
  readonly workflow = new RoundWorkflow(
    this.orchestrator,
    this.agents,
    this.debates,
    this.rounds,
  );
  readonly executor = new CoordinatorCommandExecutor(
    this.agents,
    this.debates,
    this.rounds,
    this.workflow,
    this.orchestrator,
  );

  #started = false;
  #seq = 0;
  #log: string[] = [];
  #lastError: string | undefined;
  #lastCommands: string | undefined;
  #presence = new Map<string, AgentPresence>();

  constructor() {
    this.agents.register(
      createAgent({
        id: OPERATOR_ID,
        name: 'Operator',
        role: 'operator',
      }),
    );
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
    this.#record(`Registered ${agent.name} as ${agent.role} (${agent.id}).`);
    return agent;
  }

  /**
   * Temporary Phase 3A.1 bootstrap. Creates one active Debate and Round 1
   * because the Coordinator `start-round` command is intentionally deferred.
   * Participants are the currently registered Watchers. Does not send any
   * browser deliveries.
   */
  createRound1(problem: string): void {
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
    this.rounds.create(
      createRound({
        id: roundId,
        debateId,
        number: 1,
      }),
    );
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
   * Queues Operator → Coordinator input. Kept for later checkpoints; Checkpoint
   * 3A.1 does not call this from the dashboard.
   */
  sendToCoordinator(): void {
    this.#requireStarted();
    const coordinator = this.#requireSingleCoordinator();
    const debate = this.#debate();
    const round = this.#round();
    const watchers = this.agents.listByRole('watcher');
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
          roundId: round.id,
          watchers,
        }),
        referencedMessageIds: [],
      }),
    );
    this.orchestrator.dispatch(intent);
    this.#record('Operator → Coordinator prompt queued for browser delivery.');
  }

  startRound1(problem: string): void {
    this.createRound1(problem);
    this.sendToCoordinator();
  }

  notePresence(input: {
    agentId: string;
    provider?: string;
    phase?: string;
    error?: string;
    diagnostics?: unknown;
  }): void {
    const agent = this.#requireAgent(input.agentId);
    const phase = asPhase(input.phase);
    this.#presence.set(agent.id, {
      agentId: agent.id,
      ...(input.provider ? { provider: input.provider } : {}),
      phase,
      ...(input.error ? { error: input.error } : {}),
      lastSeen: Date.now(),
      ...(input.diagnostics !== undefined
        ? { diagnostics: input.diagnostics }
        : {}),
    });
    if (phase === 'error' && input.error) {
      this.#lastError = `${agent.name}: ${input.error}`;
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
      this.#executeCoordinatorCommands(
        inbound.message.body,
        inbound.message.senderId,
      );
    }

    this.#autoCompleteRoundIfReady();
  }

  snapshot(): RayzanSnapshot {
    const debateRecord = this.debates.list()[0];
    const roundRecord = debateRecord
      ? this.rounds.listByDebate(debateRecord.id)[0]
      : undefined;
    let roundProgress;
    if (this.#started && roundRecord) {
      try {
        const progress = this.workflow.getRoundProgress(roundRecord.id);
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
    return Object.freeze({
      bridge: 'connected',
      sessionStarted: this.#started,
      ...(debateRecord
        ? {
            debate: {
              id: debateRecord.id,
              topic: debateRecord.topic,
              status: debateRecord.status,
            },
          }
        : {}),
      ...(roundRecord
        ? {
            round: {
              id: roundRecord.id,
              number: roundRecord.number,
              status: roundRecord.status,
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
        };
      }),
      deliveries: this.transport.listAll().map((delivery) => ({
        id: delivery.id,
        messageId: delivery.messageId,
        senderId: delivery.senderId,
        recipientId: delivery.recipientId,
        status: delivery.status,
        ...(delivery.roundId !== undefined
          ? { roundId: delivery.roundId }
          : {}),
      })),
      ...(roundProgress ? { roundProgress } : {}),
      participants: roundRecord
        ? this.workflow.getParticipantIds(roundRecord.id).map((agentId) => {
            const agent = this.agents.getById(agentId);
            return {
              id: agentId,
              name: agent?.name ?? agentId,
              role: agent?.role ?? 'watcher',
            };
          })
        : [],
      protocol: {
        messages: debateRecord
          ? this.messages.listByDebate(debateRecord.id).length
          : 0,
        deliveries: this.transport.listAll().length,
        exposures: debateRecord
          ? this.exposures.listByDebate(debateRecord.id).length
          : 0,
      },
      ...(this.#lastCommands ? { lastCommands: this.#lastCommands } : {}),
      ...(this.#lastError ? { lastError: this.#lastError } : {}),
      log: [...this.#log],
      messages: debateRecord
        ? this.messages.listByDebate(debateRecord.id).map((message) => ({
            id: message.id,
            senderId: message.senderId,
            recipientIds: [...message.recipientIds],
            kind: message.kind,
            body: message.body,
          }))
        : [],
    });
  }

  #autoCompleteRoundIfReady(): void {
    const debate = this.debates.list()[0];
    const round = debate ? this.rounds.listByDebate(debate.id)[0] : undefined;
    if (round === undefined || round.status === 'completed') {
      return;
    }
    try {
      const progress = this.workflow.getRoundProgress(round.id);
      if (progress.complete) {
        this.workflow.completeRound(round.id);
        this.#record('Round 1 auto-completed after all Watcher responses.');
      }
    } catch {
      // Collection not ready.
    }
  }

  #executeCoordinatorCommands(text: string, coordinatorId: AgentId): void {
    this.#lastCommands = text;
    try {
      const batch = this.#bindRound1DispatchIds(
        parseCoordinatorCommandBatch(unwrapCoordinatorJson(text)),
      );
      this.executor.execute(
        createCoordinatorExecutionContext({
          coordinatorId,
          debateId: this.#debate().id,
        }),
        batch,
      );
      this.#lastError = undefined;
      this.#record('Coordinator command batch executed.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#lastError = message;
      this.#record(`Coordinator command parse/execute failed: ${message}`);
    }
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

  #bindRound1DispatchIds(
    batch: CoordinatorCommandBatch,
  ): CoordinatorCommandBatch {
    const debateId = this.#debate().id;
    const roundId = this.#round().id;
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

  #debate() {
    const debate = this.debates.list()[0];
    if (debate === undefined) {
      throw new Error('debate missing');
    }
    return debate;
  }

  #round() {
    const round = this.rounds.listByDebate(this.#debate().id)[0];
    if (round === undefined) {
      throw new Error('round missing');
    }
    return round;
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
