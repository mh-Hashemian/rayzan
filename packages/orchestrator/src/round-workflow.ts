import {
  asAgentId,
  asRoundId,
  type AgentId,
  type AgentRegistry,
  type DebateId,
  type DebateStore,
  type RoundStatus,
  type RoundStore,
} from '@rayzan/protocol';
import {
  asDeliveryId,
  type DeliveryId,
  type InboundResponse,
  type OutboundDelivery,
  type SubmitResponseInput,
} from '@rayzan/transport';

import type { DispatchIntent } from './dispatch-intent.js';
import type { DispatchPlan } from './dispatch-plan.js';
import { DispatchPlanner } from './dispatch-planner.js';
import { OrchestratorError } from './error.js';
import type { Orchestrator } from './orchestrator.js';

export interface ParticipantProgress {
  readonly agentId: AgentId;
  readonly deliveryIds: readonly DeliveryId[];
  readonly delivered: boolean;
  readonly responded: boolean;
}

export interface RoundProgress {
  readonly roundId: string;
  readonly debateId: DebateId;
  readonly status: RoundStatus;
  readonly expected: number;
  readonly delivered: number;
  readonly responded: number;
  readonly remaining: number;
  readonly complete: boolean;
  readonly participants: readonly ParticipantProgress[];
}

type TrackedDelivery = {
  readonly id: DeliveryId;
  readonly recipientId: AgentId;
};

type RoundExecution = {
  readonly debateId: DebateId;
  readonly participantIds: readonly AgentId[];
  deliveries: TrackedDelivery[];
  readonly confirmed: Set<string>;
  readonly responded: Set<string>;
};

export class RoundWorkflow {
  readonly #executions = new Map<string, RoundExecution>();
  readonly #planner: DispatchPlanner;

  constructor(
    private readonly orchestrator: Orchestrator,
    private readonly agents: AgentRegistry,
    private readonly debates: DebateStore,
    private readonly rounds: RoundStore,
  ) {
    this.#planner = new DispatchPlanner(agents);
  }

  startRound(input: {
    roundId: string;
    participantIds: readonly string[];
  }): void {
    const roundId = asRoundId(input.roundId);
    const round = this.rounds.getById(roundId);
    if (round === undefined) {
      throw new OrchestratorError(`unknown round: ${roundId}`);
    }

    if (this.debates.getById(round.debateId) === undefined) {
      throw new OrchestratorError(`unknown debate: ${round.debateId}`);
    }

    if (round.status === 'completed') {
      throw new OrchestratorError(`round already completed: ${roundId}`);
    }

    if (this.#executions.has(roundId)) {
      throw new OrchestratorError(
        `round execution already started: ${roundId}`,
      );
    }

    if (input.participantIds.length === 0) {
      throw new OrchestratorError('participant list cannot be empty');
    }

    const participantIds = input.participantIds.map((id) => asAgentId(id));

    if (new Set(participantIds).size !== participantIds.length) {
      throw new OrchestratorError('duplicate participant ids');
    }

    for (const participantId of participantIds) {
      if (this.agents.getById(participantId) === undefined) {
        throw new OrchestratorError(`unknown participant: ${participantId}`);
      }
    }

    this.#executions.set(roundId, {
      debateId: round.debateId,
      participantIds: Object.freeze([...participantIds]),
      deliveries: [],
      confirmed: new Set(),
      responded: new Set(),
    });

    this.#setRoundStatus(roundId, 'active');
  }

  restoreExecution(input: {
    roundId: string;
    participantIds: readonly string[];
  }): void {
    const roundId = asRoundId(input.roundId);
    const round = this.rounds.getById(roundId);
    if (round === undefined) {
      throw new OrchestratorError(`unknown round: ${roundId}`);
    }
    if (this.debates.getById(round.debateId) === undefined) {
      throw new OrchestratorError(`unknown debate: ${round.debateId}`);
    }
    if (this.#executions.has(roundId)) {
      throw new OrchestratorError(
        `round execution already started: ${roundId}`,
      );
    }
    if (input.participantIds.length === 0) {
      throw new OrchestratorError('participant list cannot be empty');
    }
    const participantIds = input.participantIds.map((id) => asAgentId(id));
    if (new Set(participantIds).size !== participantIds.length) {
      throw new OrchestratorError('duplicate participant ids');
    }
    for (const participantId of participantIds) {
      if (this.agents.getById(participantId) === undefined) {
        throw new OrchestratorError(`unknown participant: ${participantId}`);
      }
    }
    this.#executions.set(roundId, {
      debateId: round.debateId,
      participantIds: Object.freeze([...participantIds]),
      deliveries: [],
      confirmed: new Set(),
      responded: new Set(),
    });
    if (round.status === 'pending') {
      this.#setRoundStatus(roundId, 'active');
    }
  }

  noteRestoredDelivery(
    roundId: string,
    delivery: { id: string; recipientId: string },
  ): void {
    const execution = this.#requireExecution(roundId);
    execution.deliveries.push({
      id: asDeliveryId(delivery.id),
      recipientId: asAgentId(delivery.recipientId),
    });
    const round = this.rounds.getById(asRoundId(roundId));
    if (round?.status === 'pending' || round?.status === 'active') {
      this.#setRoundStatus(asRoundId(roundId), 'collecting');
    }
  }

  noteRestoredConfirmed(roundId: string, deliveryId: string): void {
    this.#requireExecution(roundId).confirmed.add(deliveryId);
  }

  noteRestoredResponded(roundId: string, deliveryId: string): void {
    const execution = this.#requireExecution(roundId);
    execution.confirmed.add(deliveryId);
    execution.responded.add(deliveryId);
  }

  restoreCompleted(roundId: string): void {
    this.#setRoundStatus(asRoundId(roundId), 'completed');
  }

  hasExecution(roundId: string): boolean {
    return this.#executions.has(asRoundId(roundId));
  }

  getParticipantIds(roundId: string): readonly AgentId[] {
    return this.#requireExecution(roundId).participantIds;
  }

  dispatchPlan(
    roundId: string,
    plan: DispatchPlan,
  ): readonly OutboundDelivery[] {
    const execution = this.#requireOpenExecution(roundId);

    if (plan.debateId !== execution.debateId) {
      throw new OrchestratorError(
        `plan debate ${plan.debateId} does not match round debate ${execution.debateId}`,
      );
    }

    if (plan.roundId !== undefined && plan.roundId !== roundId) {
      throw new OrchestratorError(
        `plan round ${plan.roundId} does not match ${roundId}`,
      );
    }

    const resolvedPlan =
      plan.roundId === undefined
        ? Object.freeze({
            ...plan,
            roundId: asRoundId(roundId),
          })
        : plan;

    const intent = this.#planner.plan(resolvedPlan, {
      participantIds: execution.participantIds,
    });

    return this.dispatch(roundId, intent);
  }

  dispatch(
    roundId: string,
    intent: DispatchIntent,
  ): readonly OutboundDelivery[] {
    const execution = this.#requireOpenExecution(roundId);
    const message = intent.message;

    if (message.debateId !== execution.debateId) {
      throw new OrchestratorError(
        `message debate ${message.debateId} does not match round debate ${execution.debateId}`,
      );
    }

    if (message.roundId !== roundId) {
      throw new OrchestratorError(
        `message round ${message.roundId ?? 'none'} does not match ${roundId}`,
      );
    }

    const participants = new Set(execution.participantIds);
    for (const recipientId of message.recipientIds) {
      if (!participants.has(recipientId)) {
        throw new OrchestratorError(
          `recipient ${recipientId} is not a participant in round ${roundId}`,
        );
      }
    }

    const deliveries = this.orchestrator.dispatch(intent);
    execution.deliveries.push(
      ...deliveries.map((delivery) => ({
        id: delivery.id,
        recipientId: delivery.recipientId,
      })),
    );

    this.#setRoundStatus(asRoundId(roundId), 'collecting');
    return deliveries;
  }

  confirmDelivery(roundId: string, deliveryId: string): OutboundDelivery {
    const execution = this.#requireOpenExecution(roundId);
    this.#requireTrackedDelivery(execution, deliveryId);

    const delivery = this.orchestrator.confirmDelivery(deliveryId);
    execution.confirmed.add(delivery.id);
    return delivery;
  }

  submitResponse(roundId: string, input: SubmitResponseInput): InboundResponse {
    const execution = this.#requireOpenExecution(roundId);
    const tracked = this.#requireTrackedDelivery(execution, input.deliveryId);

    if (!execution.participantIds.includes(tracked.recipientId)) {
      throw new OrchestratorError(
        `responder ${tracked.recipientId} is not a participant in round ${roundId}`,
      );
    }

    const inbound = this.orchestrator.submitResponse(input);
    execution.confirmed.add(inbound.deliveryId);
    execution.responded.add(inbound.deliveryId);
    return inbound;
  }

  getRoundProgress(roundId: string): RoundProgress {
    const execution = this.#requireExecution(roundId);
    const round = this.rounds.getById(asRoundId(roundId));
    if (round === undefined) {
      throw new OrchestratorError(`unknown round: ${roundId}`);
    }

    const participants = execution.participantIds.map((agentId) => {
      const deliveryIds = execution.deliveries
        .filter((delivery) => delivery.recipientId === agentId)
        .map((delivery) => delivery.id);
      const delivered =
        deliveryIds.length > 0 &&
        deliveryIds.every(
          (id) => execution.confirmed.has(id) || execution.responded.has(id),
        );
      const responded =
        deliveryIds.length > 0 &&
        deliveryIds.every((id) => execution.responded.has(id));

      return Object.freeze({
        agentId,
        deliveryIds: Object.freeze(deliveryIds),
        delivered,
        responded,
      });
    });

    const expected = participants.length;
    const delivered = participants.filter(
      (participant) => participant.delivered,
    ).length;
    const responded = participants.filter(
      (participant) => participant.responded,
    ).length;
    const remaining = expected - responded;
    const complete =
      remaining === 0 &&
      participants.every((participant) => participant.responded);

    return Object.freeze({
      roundId,
      debateId: execution.debateId,
      status: round.status,
      expected,
      delivered,
      responded,
      remaining,
      complete,
      participants: Object.freeze(participants),
    });
  }

  completeRound(roundId: string): void {
    const progress = this.getRoundProgress(roundId);
    if (!progress.complete) {
      throw new OrchestratorError(
        `cannot complete round ${roundId} before all expected responses exist`,
      );
    }

    if (progress.status === 'completed') {
      throw new OrchestratorError(`round already completed: ${roundId}`);
    }

    this.#setRoundStatus(asRoundId(roundId), 'completed');
  }

  #requireExecution(roundId: string): RoundExecution {
    const execution = this.#executions.get(asRoundId(roundId));
    if (execution === undefined) {
      throw new OrchestratorError(`unknown round execution: ${roundId}`);
    }
    return execution;
  }

  #requireOpenExecution(roundId: string): RoundExecution {
    const execution = this.#requireExecution(roundId);
    const round = this.rounds.getById(asRoundId(roundId));
    if (round?.status === 'completed') {
      throw new OrchestratorError(`round already completed: ${roundId}`);
    }
    return execution;
  }

  #requireTrackedDelivery(
    execution: RoundExecution,
    deliveryId: string,
  ): TrackedDelivery {
    const tracked = execution.deliveries.find(
      (delivery) => delivery.id === deliveryId,
    );
    if (tracked === undefined) {
      throw new OrchestratorError(
        `delivery ${deliveryId} is not part of this round`,
      );
    }
    return tracked;
  }

  #setRoundStatus(roundId: ReturnType<typeof asRoundId>, status: RoundStatus) {
    const round = this.rounds.getById(roundId);
    if (round === undefined) {
      throw new OrchestratorError(`unknown round: ${roundId}`);
    }

    this.rounds.update(
      Object.freeze({
        ...round,
        status,
      }),
    );
  }
}
