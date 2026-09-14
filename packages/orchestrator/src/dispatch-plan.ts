import {
  asAgentId,
  asDebateId,
  asMessageId,
  asRoundId,
  MESSAGE_KINDS,
  type AgentId,
  type DebateId,
  type MessageId,
  type MessageKind,
  type RoundId,
} from '@rayzan/protocol';

import { OrchestratorError } from './error.js';

export const RECIPIENT_SELECTOR_TYPES = [
  'round-watchers',
  'explicit-agents',
] as const;

export type RecipientSelectorType = (typeof RECIPIENT_SELECTOR_TYPES)[number];

export type RecipientSelector =
  | { readonly type: 'round-watchers' }
  | {
      readonly type: 'explicit-agents';
      readonly agentIds: readonly AgentId[];
    };

export interface DispatchPlan {
  readonly messageId: MessageId;
  readonly debateId: DebateId;
  readonly roundId?: RoundId;
  readonly senderId: AgentId;
  readonly recipients: RecipientSelector;
  readonly kind: MessageKind;
  readonly body: string;
  readonly referencedMessageIds: readonly string[];
}

export function createDispatchPlan(input: {
  messageId: string;
  debateId: string;
  roundId?: string;
  senderId: string;
  recipients: {
    type: string;
    agentIds?: readonly string[];
  };
  kind: MessageKind;
  body: string;
  referencedMessageIds: readonly string[];
}): DispatchPlan {
  const body = input.body.trim();
  if (body.length === 0) {
    throw new OrchestratorError('message body cannot be empty');
  }

  if (!(MESSAGE_KINDS as readonly string[]).includes(input.kind)) {
    throw new OrchestratorError('message kind is not a recognized value');
  }

  const plan: DispatchPlan = {
    messageId: asMessageId(input.messageId),
    debateId: asDebateId(input.debateId),
    senderId: asAgentId(input.senderId),
    recipients: freezeRecipientSelector(input.recipients),
    kind: input.kind,
    body,
    referencedMessageIds: Object.freeze([...input.referencedMessageIds]),
  };

  if (input.roundId !== undefined) {
    return Object.freeze({
      ...plan,
      roundId: asRoundId(input.roundId),
    });
  }

  return Object.freeze(plan);
}

function freezeRecipientSelector(input: {
  type: string;
  agentIds?: readonly string[];
}): RecipientSelector {
  if (input.type === 'round-watchers') {
    if (input.agentIds !== undefined) {
      throw new OrchestratorError(
        'round-watchers selector cannot include agentIds',
      );
    }
    return Object.freeze({ type: 'round-watchers' });
  }

  if (input.type !== 'explicit-agents') {
    throw new OrchestratorError(
      `recipient selector type is not a recognized value: ${input.type}`,
    );
  }

  if (!Array.isArray(input.agentIds) || input.agentIds.length === 0) {
    throw new OrchestratorError('explicit-agents list cannot be empty');
  }

  const agentIds = input.agentIds.map((agentId, index) => {
    if (agentId.trim().length === 0) {
      throw new OrchestratorError(
        `recipients.agentIds[${index}] cannot be empty`,
      );
    }
    return asAgentId(agentId);
  });

  if (new Set(agentIds).size !== agentIds.length) {
    throw new OrchestratorError('duplicate explicit recipient ids');
  }

  return Object.freeze({
    type: 'explicit-agents',
    agentIds: Object.freeze(agentIds),
  });
}
