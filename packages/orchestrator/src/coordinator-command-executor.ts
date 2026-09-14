import {
  asAgentId,
  asDebateId,
  asRoundId,
  type Agent,
  type AgentId,
  type AgentRegistry,
  type Debate,
  type DebateId,
  type DebateStore,
  type RoundStore,
} from '@rayzan/protocol';

import type {
  CompleteRoundCommand,
  CoordinatorCommandBatch,
  DispatchCommand,
} from './coordinator-command.js';
import type { CoordinatorExecutionContext } from './coordinator-execution-context.js';
import type {
  CompleteRoundExecutionResult,
  CoordinatorCommandExecutionResult,
  CoordinatorExecutionResult,
  DispatchExecutionResult,
  FinalizeDebateExecutionResult,
} from './coordinator-execution-result.js';
import { createDispatchPlan } from './dispatch-plan.js';
import { DispatchPlanner } from './dispatch-planner.js';
import { OrchestratorError } from './error.js';
import type { Orchestrator } from './orchestrator.js';
import type { RoundWorkflow } from './round-workflow.js';

export class CoordinatorCommandExecutor {
  readonly #planner: DispatchPlanner;

  constructor(
    private readonly agents: AgentRegistry,
    private readonly debates: DebateStore,
    private readonly rounds: RoundStore,
    private readonly workflow: RoundWorkflow,
    private readonly orchestrator: Orchestrator,
  ) {
    this.#planner = new DispatchPlanner(agents);
  }

  execute(
    context: CoordinatorExecutionContext,
    batch: CoordinatorCommandBatch,
  ): CoordinatorExecutionResult {
    const coordinator = this.#requireCoordinator(context.coordinatorId);
    const debate = this.#requireDebate(context.debateId);
    this.#preflightBatch(debate, batch);

    const results: CoordinatorCommandExecutionResult[] = [];
    for (const command of batch.commands) {
      if (command.type === 'dispatch') {
        results.push(this.#executeDispatch(coordinator, command));
        continue;
      }
      if (command.type === 'complete-round') {
        results.push(this.#executeCompleteRound(debate.id, command));
        continue;
      }
      results.push(this.#executeFinalize(debate.id, command.body));
    }

    return Object.freeze({
      results: Object.freeze(results),
    });
  }

  #preflightBatch(debate: Debate, batch: CoordinatorCommandBatch): void {
    if (debate.status === 'completed') {
      throw new OrchestratorError(`debate already completed: ${debate.id}`);
    }

    for (const command of batch.commands) {
      if (command.debateId !== debate.id) {
        throw new OrchestratorError(
          `command debate ${command.debateId} does not match trusted debate ${debate.id}`,
        );
      }
    }

    const finalizeIndexes = batch.commands.flatMap((command, index) =>
      command.type === 'finalize-debate' ? [index] : [],
    );

    if (finalizeIndexes.length > 1) {
      throw new OrchestratorError(
        'finalize-debate may appear at most once in a batch',
      );
    }

    if (
      finalizeIndexes.length === 1 &&
      finalizeIndexes[0] !== batch.commands.length - 1
    ) {
      throw new OrchestratorError(
        'finalize-debate must be the last command in a batch',
      );
    }
  }

  #executeDispatch(
    coordinator: Agent,
    command: DispatchCommand,
  ): DispatchExecutionResult {
    const plan = createDispatchPlan({
      messageId: command.messageId,
      debateId: command.debateId,
      ...(command.roundId !== undefined ? { roundId: command.roundId } : {}),
      senderId: coordinator.id,
      recipients: command.recipients,
      kind: command.kind,
      body: command.body,
      referencedMessageIds: command.referencedMessageIds,
    });

    const deliveries =
      plan.roundId === undefined
        ? this.orchestrator.dispatch(this.#planner.plan(plan))
        : this.workflow.dispatchPlan(plan.roundId, plan);

    const result: DispatchExecutionResult = {
      type: 'dispatch',
      messageId: plan.messageId,
      debateId: plan.debateId,
      senderId: coordinator.id,
      recipientIds: Object.freeze(
        deliveries.map((delivery) => delivery.recipientId),
      ),
      deliveries,
    };

    if (plan.roundId !== undefined) {
      return Object.freeze({
        ...result,
        roundId: plan.roundId,
      });
    }

    return Object.freeze(result);
  }

  #executeCompleteRound(
    debateId: DebateId,
    command: CompleteRoundCommand,
  ): CompleteRoundExecutionResult {
    const round = this.rounds.getById(asRoundId(command.roundId));
    if (round === undefined) {
      throw new OrchestratorError(`unknown round: ${command.roundId}`);
    }
    if (round.debateId !== debateId) {
      throw new OrchestratorError(
        `round ${command.roundId} does not belong to debate ${debateId}`,
      );
    }

    this.workflow.completeRound(command.roundId);

    return Object.freeze({
      type: 'complete-round',
      debateId,
      roundId: round.id,
      status: 'completed',
    });
  }

  #executeFinalize(
    debateId: DebateId,
    body: string,
  ): FinalizeDebateExecutionResult {
    const debate = this.#requireDebate(debateId);
    if (debate.status !== 'active') {
      throw new OrchestratorError(
        `debate ${debateId} cannot be finalized from status ${debate.status}`,
      );
    }

    const incomplete = this.rounds
      .listByDebate(debateId)
      .filter((round) => round.status !== 'completed');
    if (incomplete.length > 0) {
      throw new OrchestratorError(
        `cannot finalize debate ${debateId} while rounds are incomplete`,
      );
    }

    this.debates.update(
      Object.freeze({
        ...debate,
        status: 'completed',
      }),
    );

    return Object.freeze({
      type: 'finalize-debate',
      debateId,
      body,
      status: 'completed',
    });
  }

  #requireCoordinator(coordinatorId: AgentId): Agent {
    const agent = this.agents.getById(asAgentId(coordinatorId));
    if (agent === undefined) {
      throw new OrchestratorError(`unknown coordinator: ${coordinatorId}`);
    }
    if (agent.role !== 'coordinator') {
      throw new OrchestratorError(
        `trusted sender ${agent.id} has role ${agent.role}, not coordinator`,
      );
    }
    return agent;
  }

  #requireDebate(debateId: DebateId): Debate {
    const debate = this.debates.getById(asDebateId(debateId));
    if (debate === undefined) {
      throw new OrchestratorError(`unknown debate: ${debateId}`);
    }
    return debate;
  }
}
