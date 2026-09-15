import type { Event } from '@rayzan/events';
import {
  AGENT_ROLES,
  asAgentId,
  asDebateId,
  asMessageId,
  createAgent,
  createDebate,
  createDebateSynthesis,
  createExposureRecord,
  createMessageEnvelope,
  createRound,
  DEBATE_STATUSES,
  MESSAGE_KINDS,
  type Agent,
  type AgentRole,
  type Debate,
  type DebateStatus,
  type DebateSynthesis,
  type ExposureRecord,
  type MessageEnvelope,
  type MessageKind,
  type Round,
} from '@rayzan/protocol';
import {
  asDeliveryId,
  type DeliveryStatus,
  type OutboundDelivery,
} from '@rayzan/transport';

export type ReplayStatus =
  | 'FRESH'
  | 'RESTORED'
  | 'RESTORED_WITH_WARNINGS'
  | 'FAILED';

export type ReplayWarningCode =
  | 'historical'
  | 'integrity'
  | 'unresolved-delivery'
  | 'unsupported';

export interface ReplayWarning {
  readonly eventId?: string;
  readonly type?: string;
  readonly code: ReplayWarningCode;
  readonly message: string;
}

export interface ReplayResult {
  readonly appliedEvents: number;
  readonly skippedEvents: number;
  readonly agentsRestored: number;
  readonly debatesRestored: number;
  readonly roundsRestored: number;
  readonly messagesRestored: number;
  readonly exposuresRestored: number;
  readonly synthesesRestored: number;
  readonly unresolvedDeliveries: number;
  readonly warnings: readonly ReplayWarning[];
  readonly status: ReplayStatus;
}

export interface ReplayTarget {
  getAgent(id: string): Agent | undefined;
  registerAgent(agent: Agent): void;
  getDebate(id: string): Debate | undefined;
  createDebate(debate: Debate): void;
  updateDebate(debate: Debate): void;
  getRound(id: string): Round | undefined;
  createRound(round: Round): void;
  updateRound(round: Round): void;
  getMessage(id: string): MessageEnvelope | undefined;
  storeMessage(message: MessageEnvelope): void;
  recordExposure(record: ExposureRecord): void;
  getSynthesis(debateId: string): DebateSynthesis | undefined;
  storeSynthesis(synthesis: DebateSynthesis): void;
  hydrateMessage(message: MessageEnvelope): void;
  hydrateDelivery(delivery: OutboundDelivery): void;
  getDelivery(id: string): OutboundDelivery | undefined;
  setDeliveryStatus(id: string, status: DeliveryStatus): void;
  restoreRoundExecution(
    roundId: string,
    participantIds: readonly string[],
  ): void;
  hasRoundExecution(roundId: string): boolean;
  noteRoundDelivery(
    roundId: string,
    delivery: { id: string; recipientId: string },
  ): void;
  noteRoundConfirmed(roundId: string, deliveryId: string): void;
  noteRoundResponded(roundId: string, deliveryId: string): void;
  restoreRoundCompleted(roundId: string): void;
  restoreDeliveryReferences(
    deliveryId: string,
    referencedMessageIds: readonly string[],
  ): void;
  listDeliveries(): readonly OutboundDelivery[];
}

export function emptyReplayResult(status: ReplayStatus = 'FRESH'): ReplayResult {
  return {
    appliedEvents: 0,
    skippedEvents: 0,
    agentsRestored: 0,
    debatesRestored: 0,
    roundsRestored: 0,
    messagesRestored: 0,
    exposuresRestored: 0,
    synthesesRestored: 0,
    unresolvedDeliveries: 0,
    warnings: [],
    status,
  };
}

export class EventReplayer {
  replay(events: readonly Event[], target: ReplayTarget): ReplayResult {
    let appliedEvents = 0;
    let skippedEvents = 0;
    let agentsRestored = 0;
    let debatesRestored = 0;
    let roundsRestored = 0;
    let messagesRestored = 0;
    let exposuresRestored = 0;
    let synthesesRestored = 0;
    const warnings: ReplayWarning[] = [];
    let failed = false;

    for (const event of events) {
      if (failed) {
        skippedEvents += 1;
        warnings.push({
          eventId: event.id,
          type: event.type,
          code: 'integrity',
          message: `skipped after replay integrity failure: ${event.type}`,
        });
        continue;
      }

      const outcome = this.#apply(event, target);
      if (outcome.kind === 'applied') {
        appliedEvents += 1;
        agentsRestored += outcome.agents ?? 0;
        debatesRestored += outcome.debates ?? 0;
        roundsRestored += outcome.rounds ?? 0;
        messagesRestored += outcome.messages ?? 0;
        exposuresRestored += outcome.exposures ?? 0;
        synthesesRestored += outcome.syntheses ?? 0;
        if (outcome.warning !== undefined) {
          warnings.push({
            eventId: event.id,
            type: event.type,
            ...outcome.warning,
          });
        }
        continue;
      }
      if (outcome.kind === 'skipped') {
        skippedEvents += 1;
        warnings.push({
          eventId: event.id,
          type: event.type,
          code: outcome.code,
          message: outcome.message,
        });
        continue;
      }
      failed = true;
      skippedEvents += 1;
      warnings.push({
        eventId: event.id,
        type: event.type,
        code: 'integrity',
        message: outcome.message,
      });
    }

    const unresolved = target
      .listDeliveries()
      .filter((delivery) => delivery.status !== 'responded');
    for (const delivery of unresolved) {
      warnings.push({
        code: 'unresolved-delivery',
        message: `Delivery ${delivery.id} to ${delivery.recipientId} is ${delivery.status} after restart. Response unknown. Operator attention required. Nothing was resent.`,
      });
    }

    let status: ReplayStatus = 'RESTORED';
    if (failed) {
      status = 'FAILED';
    } else if (warnings.length > 0) {
      status = 'RESTORED_WITH_WARNINGS';
    }

    return {
      appliedEvents,
      skippedEvents,
      agentsRestored,
      debatesRestored,
      roundsRestored,
      messagesRestored,
      exposuresRestored,
      synthesesRestored,
      unresolvedDeliveries: unresolved.length,
      warnings,
      status,
    };
  }

  #apply(event: Event, target: ReplayTarget): ApplyOutcome {
    try {
      switch (event.type) {
        case 'AGENT_REGISTERED':
          return this.#agentRegistered(event, target);
        case 'DEBATE_CREATED':
          return this.#debateCreated(event, target);
        case 'ROUND_CREATED':
          return this.#roundCreated(event, target);
        case 'MESSAGE_CREATED':
          return this.#messageCreated(event, target);
        case 'MESSAGE_DISPATCHED':
          return { kind: 'applied' };
        case 'DELIVERY_CREATED':
          return this.#deliveryCreated(event, target);
        case 'DELIVERY_CONFIRMED':
          return this.#deliveryConfirmed(event, target);
        case 'RESPONSE_CAPTURED':
          return this.#responseCaptured(event, target);
        case 'EXPOSURE_CREATED':
          return this.#exposureCreated(event, target);
        case 'ROUND_COMPLETED':
          return this.#roundCompleted(event, target);
        case 'SYNTHESIS_CREATED':
          return this.#synthesisCreated(event, target);
        case 'OPERATOR_INTERVENTION':
          return {
            kind: 'skipped',
            code: 'unsupported',
            message: 'OPERATOR_INTERVENTION is reserved and not replayed',
          };
        default:
          return {
            kind: 'skipped',
            code: 'unsupported',
            message: `unsupported event type: ${String((event as Event).type)}`,
          };
      }
    } catch (error) {
      return {
        kind: 'integrity',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  #agentRegistered(event: Event, target: ReplayTarget): ApplyOutcome {
    const payload = asPayload(event.payload);
    const id = stringField(payload, 'id') ?? event.agentId;
    const name = stringField(payload, 'name');
    const role = stringField(payload, 'role');
    if (id === undefined || name === undefined || role === undefined) {
      return historical('AGENT_REGISTERED lacks id, name, or role');
    }
    if (!isAgentRole(role)) {
      return integrity(`invalid agent role: ${role}`);
    }
    if (target.getAgent(id) !== undefined) {
      return { kind: 'applied' };
    }
    target.registerAgent(createAgent({ id, name, role }));
    return { kind: 'applied', agents: 1 };
  }

  #debateCreated(event: Event, target: ReplayTarget): ApplyOutcome {
    const payload = asPayload(event.payload);
    const id = event.debateId;
    const topic = stringField(payload, 'topic');
    if (id === undefined || topic === undefined) {
      return historical('DEBATE_CREATED lacks debate id or topic');
    }
    const statusValue = stringField(payload, 'status') ?? 'active';
    if (!isDebateStatus(statusValue)) {
      return integrity(`invalid debate status: ${statusValue}`);
    }
    if (target.getDebate(id) !== undefined) {
      return integrity(`duplicate debate id: ${id}`);
    }
    target.createDebate(createDebate({ id, topic, status: statusValue }));
    return { kind: 'applied', debates: 1 };
  }

  #roundCreated(event: Event, target: ReplayTarget): ApplyOutcome {
    const payload = asPayload(event.payload);
    const id = event.roundId;
    const debateId = event.debateId;
    const number = numberField(payload, 'number');
    if (id === undefined || debateId === undefined || number === undefined) {
      return historical('ROUND_CREATED lacks round id, debate id, or number');
    }
    if (target.getDebate(debateId) === undefined) {
      return integrity(`ROUND_CREATED references unknown debate: ${debateId}`);
    }
    if (target.getRound(id) !== undefined) {
      return integrity(`duplicate round id: ${id}`);
    }
    target.createRound(
      createRound({
        id,
        debateId,
        number,
      }),
    );
    const participantIds = stringList(payload.participantIds);
    if (participantIds.length === 0) {
      return {
        kind: 'applied',
        rounds: 1,
        warning: {
          code: 'historical',
          message:
            'ROUND_CREATED has no participantIds; round row restored, execution is timeline-only',
        },
      };
    }
    target.restoreRoundExecution(id, participantIds);
    return { kind: 'applied', rounds: 1 };
  }

  #messageCreated(event: Event, target: ReplayTarget): ApplyOutcome {
    const payload = asPayload(event.payload);
    const messageId = stringField(payload, 'messageId');
    const senderId = stringField(payload, 'senderId') ?? event.agentId;
    const kind = stringField(payload, 'kind');
    const body = stringField(payload, 'body');
    const debateId = event.debateId;
    const recipientIds = stringList(payload.recipientIds);
    if (
      messageId === undefined ||
      senderId === undefined ||
      kind === undefined ||
      body === undefined ||
      debateId === undefined ||
      recipientIds.length === 0
    ) {
      return historical(
        'MESSAGE_CREATED lacks canonical envelope fields (body required for replay)',
      );
    }
    if (!isMessageKind(kind)) {
      return integrity(`invalid message kind: ${kind}`);
    }
    if (target.getMessage(messageId) !== undefined) {
      return { kind: 'applied' };
    }
    const message = createMessageEnvelope({
      id: messageId,
      debateId,
      ...(event.roundId !== undefined ? { roundId: event.roundId } : {}),
      senderId,
      recipientIds,
      kind,
      body,
    });
    target.storeMessage(message);
    target.hydrateMessage(message);
    return { kind: 'applied', messages: 1 };
  }

  #deliveryCreated(event: Event, target: ReplayTarget): ApplyOutcome {
    const payload = asPayload(event.payload);
    const deliveryId = stringField(payload, 'deliveryId');
    const messageId = stringField(payload, 'messageId');
    const recipientId = stringField(payload, 'recipientId') ?? event.agentId;
    if (
      deliveryId === undefined ||
      messageId === undefined ||
      recipientId === undefined
    ) {
      return historical('DELIVERY_CREATED lacks deliveryId, messageId, or recipientId');
    }
    const message = target.getMessage(messageId);
    const senderId = stringField(payload, 'senderId') ?? message?.senderId;
    const debateId = event.debateId ?? message?.debateId;
    if (senderId === undefined || debateId === undefined) {
      return historical(
        'DELIVERY_CREATED cannot reconstruct sender/debate from payload or message',
      );
    }
    const statusValue = stringField(payload, 'status') ?? 'pending';
    if (!isDeliveryStatus(statusValue)) {
      return integrity(`invalid delivery status: ${statusValue}`);
    }
    if (target.getDelivery(deliveryId) !== undefined) {
      return integrity(`duplicate delivery id: ${deliveryId}`);
    }
    const roundId = event.roundId ?? message?.roundId;
    target.hydrateDelivery(
      Object.freeze({
        id: asDeliveryId(deliveryId),
        messageId: asMessageId(messageId),
        debateId: asDebateId(debateId),
        ...(roundId !== undefined ? { roundId } : {}),
        senderId: asAgentId(senderId),
        recipientId: asAgentId(recipientId),
        status: statusValue,
      }),
    );
    if (message !== undefined) {
      target.hydrateMessage(message);
    }
    const referenced = stringList(payload.referencedMessageIds);
    target.restoreDeliveryReferences(deliveryId, referenced);
    if (roundId !== undefined && target.hasRoundExecution(roundId)) {
      target.noteRoundDelivery(roundId, {
        id: deliveryId,
        recipientId,
      });
    }
    return { kind: 'applied' };
  }

  #deliveryConfirmed(event: Event, target: ReplayTarget): ApplyOutcome {
    const payload = asPayload(event.payload);
    const deliveryId = stringField(payload, 'deliveryId');
    if (deliveryId === undefined) {
      return historical('DELIVERY_CONFIRMED lacks deliveryId');
    }
    if (target.getDelivery(deliveryId) === undefined) {
      return historical(
        `DELIVERY_CONFIRMED for unknown delivery ${deliveryId} (not reconstructed)`,
      );
    }
    target.setDeliveryStatus(deliveryId, 'delivered');
    const roundId = event.roundId ?? target.getDelivery(deliveryId)?.roundId;
    if (roundId !== undefined && target.hasRoundExecution(roundId)) {
      target.noteRoundConfirmed(roundId, deliveryId);
    }
    return { kind: 'applied' };
  }

  #responseCaptured(event: Event, target: ReplayTarget): ApplyOutcome {
    const payload = asPayload(event.payload);
    const deliveryId = stringField(payload, 'deliveryId');
    if (deliveryId === undefined) {
      return historical('RESPONSE_CAPTURED lacks deliveryId');
    }
    if (target.getDelivery(deliveryId) === undefined) {
      return historical(
        `RESPONSE_CAPTURED for unknown delivery ${deliveryId} (not reconstructed)`,
      );
    }
    target.setDeliveryStatus(deliveryId, 'responded');
    const roundId = event.roundId ?? target.getDelivery(deliveryId)?.roundId;
    if (roundId !== undefined && target.hasRoundExecution(roundId)) {
      target.noteRoundResponded(roundId, deliveryId);
    }
    return { kind: 'applied' };
  }

  #exposureCreated(event: Event, target: ReplayTarget): ApplyOutcome {
    const payload = asPayload(event.payload);
    const exposureId = stringField(payload, 'exposureId');
    const messageId = stringField(payload, 'messageId');
    const agentId = stringField(payload, 'agentId') ?? event.agentId;
    const debateId = event.debateId;
    if (
      exposureId === undefined ||
      messageId === undefined ||
      agentId === undefined ||
      debateId === undefined ||
      !('referencedMessageIds' in payload)
    ) {
      return historical(
        'EXPOSURE_CREATED lacks canonical fields (referencedMessageIds required)',
      );
    }
    target.recordExposure(
      createExposureRecord({
        id: exposureId,
        agentId,
        debateId,
        ...(event.roundId !== undefined ? { roundId: event.roundId } : {}),
        messageId,
        referencedMessageIds: stringList(payload.referencedMessageIds),
      }),
    );
    return { kind: 'applied', exposures: 1 };
  }

  #roundCompleted(event: Event, target: ReplayTarget): ApplyOutcome {
    const roundId = event.roundId;
    if (roundId === undefined) {
      return historical('ROUND_COMPLETED lacks round id');
    }
    const round = target.getRound(roundId);
    if (round === undefined) {
      return integrity(`ROUND_COMPLETED references unknown round: ${roundId}`);
    }
    target.restoreRoundCompleted(roundId);
    return { kind: 'applied' };
  }

  #synthesisCreated(event: Event, target: ReplayTarget): ApplyOutcome {
    const payload = asPayload(event.payload);
    const debateId = event.debateId;
    const coordinatorId =
      stringField(payload, 'coordinatorId') ?? event.agentId;
    const body = stringField(payload, 'body');
    const createdAt = stringField(payload, 'createdAt');
    if (
      debateId === undefined ||
      coordinatorId === undefined ||
      body === undefined ||
      createdAt === undefined
    ) {
      return historical(
        'SYNTHESIS_CREATED lacks body/createdAt (historical timeline-only)',
      );
    }
    if (target.getDebate(debateId) === undefined) {
      return integrity(
        `SYNTHESIS_CREATED references unknown debate: ${debateId}`,
      );
    }
    if (target.getSynthesis(debateId) === undefined) {
      target.storeSynthesis(
        createDebateSynthesis({
          debateId,
          coordinatorId,
          body,
          createdAt,
        }),
      );
    }
    const debate = target.getDebate(debateId);
    if (debate !== undefined && debate.status !== 'completed') {
      target.updateDebate(
        createDebate({
          id: debate.id,
          topic: debate.topic,
          status: 'completed',
        }),
      );
    }
    return { kind: 'applied', syntheses: 1 };
  }
}

type ApplyOutcome =
  | {
      kind: 'applied';
      agents?: number;
      debates?: number;
      rounds?: number;
      messages?: number;
      exposures?: number;
      syntheses?: number;
      warning?: { code: ReplayWarningCode; message: string };
    }
  | { kind: 'skipped'; code: ReplayWarningCode; message: string }
  | { kind: 'integrity'; message: string };

function historical(message: string): ApplyOutcome {
  return { kind: 'skipped', code: 'historical', message };
}

function integrity(message: string): ApplyOutcome {
  return { kind: 'integrity', message };
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
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : undefined;
}

function numberField(
  payload: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0,
  );
}

function isAgentRole(value: string): value is AgentRole {
  return (AGENT_ROLES as readonly string[]).includes(value);
}

function isDebateStatus(value: string): value is DebateStatus {
  return (DEBATE_STATUSES as readonly string[]).includes(value);
}

function isMessageKind(value: string): value is MessageKind {
  return (MESSAGE_KINDS as readonly string[]).includes(value);
}

function isDeliveryStatus(value: string): value is DeliveryStatus {
  return value === 'pending' || value === 'delivered' || value === 'responded';
}
