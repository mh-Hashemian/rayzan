import type { Event } from '@rayzan/events';
import type { OutboundDelivery } from '@rayzan/transport';

export type ExternalActionKind = 'prompt-dispatch' | 'capture';
export type ExternalActionState = 'IN_DOUBT' | 'confirmed' | 'failed';

export interface ExternalActionRecovery {
  readonly action: ExternalActionKind;
  readonly state: ExternalActionState;
  readonly reason: string;
  readonly requestedEventId: string;
  readonly agentId?: string;
  readonly deliveryId?: string;
  readonly correlationId?: string;
}

const PROMPT_REQUESTED = 'PROMPT_DISPATCH_REQUESTED';
const PROMPT_CONFIRMED = 'PROMPT_DISPATCH_CONFIRMED';
const PROMPT_FAILED = 'PROMPT_DISPATCH_FAILED';
const CAPTURE_REQUESTED = 'CAPTURE_REQUESTED';
const CAPTURE_FAILED = 'CAPTURE_FAILED';
const RESPONSE_CAPTURED = 'RESPONSE_CAPTURED';

/**
 * Classify external side-effect operations from sequence order only.
 * Timestamps are never consulted.
 */
export function classifyExternalActions(
  events: readonly Event[],
  deliveries: readonly OutboundDelivery[] = [],
): readonly ExternalActionRecovery[] {
  const ops = new Map<string, OpenOp>();
  const closed: ExternalActionRecovery[] = [];

  for (const event of events) {
    const deliveryId = payloadDeliveryId(event);
    if (event.type === PROMPT_REQUESTED) {
      openOp(ops, keyFor(event, 'prompt-dispatch', deliveryId), {
        action: 'prompt-dispatch',
        requested: event,
        deliveryId,
      });
      continue;
    }
    if (event.type === CAPTURE_REQUESTED) {
      openOp(ops, keyFor(event, 'capture', deliveryId), {
        action: 'capture',
        requested: event,
        deliveryId,
      });
      continue;
    }
    if (event.type === PROMPT_CONFIRMED) {
      closeOp(ops, closed, event, 'prompt-dispatch', deliveryId, 'confirmed');
      continue;
    }
    if (event.type === PROMPT_FAILED) {
      closeOp(ops, closed, event, 'prompt-dispatch', deliveryId, 'failed');
      continue;
    }
    if (event.type === RESPONSE_CAPTURED) {
      closeOp(ops, closed, event, 'capture', deliveryId, 'confirmed');
      continue;
    }
    if (event.type === CAPTURE_FAILED) {
      closeOp(ops, closed, event, 'capture', deliveryId, 'failed');
    }
  }

  const fromLifecycle: ExternalActionRecovery[] = [
    ...closed,
    ...[...ops.values()].map((op) => inDoubtFrom(op)),
  ];

  const covered = new Set(
    fromLifecycle
      .map((item) => item.deliveryId)
      .filter((id): id is string => id !== undefined),
  );

  const fromLegacy: ExternalActionRecovery[] = [];
  for (const delivery of deliveries) {
    if (covered.has(delivery.id)) {
      continue;
    }
    if (delivery.status === 'responded') {
      continue;
    }
    fromLegacy.push({
      action: delivery.status === 'pending' ? 'prompt-dispatch' : 'capture',
      state: 'IN_DOUBT',
      reason:
        'request was persisted but no confirmed/failed event exists',
      requestedEventId: delivery.id,
      agentId: delivery.recipientId,
      deliveryId: delivery.id,
    });
  }

  return [...fromLifecycle, ...fromLegacy];
}

interface OpenOp {
  readonly action: ExternalActionKind;
  readonly requested: Event;
  readonly deliveryId?: string;
}

function openOp(
  ops: Map<string, OpenOp>,
  key: string,
  op: OpenOp,
): void {
  ops.set(key, op);
}

function closeOp(
  ops: Map<string, OpenOp>,
  closed: ExternalActionRecovery[],
  event: Event,
  action: ExternalActionKind,
  deliveryId: string | undefined,
  state: 'confirmed' | 'failed',
): void {
  const key = keyFor(event, action, deliveryId);
  const op = ops.get(key);
  if (op === undefined) {
    return;
  }
  ops.delete(key);
  closed.push({
    action,
    state,
    reason:
      state === 'failed'
        ? payloadReason(event) ?? 'terminal failed event recorded'
        : 'terminal confirmed event recorded',
    requestedEventId: op.requested.id,
    agentId: op.requested.agentId ?? event.agentId,
    deliveryId: op.deliveryId ?? deliveryId,
    correlationId: op.requested.correlationId ?? event.correlationId,
  });
}

function inDoubtFrom(op: OpenOp): ExternalActionRecovery {
  return {
    action: op.action,
    state: 'IN_DOUBT',
    reason: 'request was persisted but no confirmed/failed event exists',
    requestedEventId: op.requested.id,
    agentId: op.requested.agentId,
    deliveryId: op.deliveryId ?? payloadDeliveryId(op.requested),
    correlationId: op.requested.correlationId,
  };
}

function keyFor(
  event: Event,
  action: ExternalActionKind,
  deliveryId: string | undefined,
): string {
  if (event.correlationId !== undefined) {
    return `${action}:${event.correlationId}`;
  }
  if (deliveryId !== undefined) {
    return `${action}:delivery:${deliveryId}`;
  }
  return `${action}:event:${event.id}`;
}

function payloadDeliveryId(event: Event): string | undefined {
  if (event.payload === null || typeof event.payload !== 'object') {
    return undefined;
  }
  const value = (event.payload as { deliveryId?: unknown }).deliveryId;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function payloadReason(event: Event): string | undefined {
  if (event.payload === null || typeof event.payload !== 'object') {
    return undefined;
  }
  const value = (event.payload as { reason?: unknown }).reason;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
