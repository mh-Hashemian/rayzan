import {
  asAgentId,
  asDebateId,
  asMessageId,
  asRoundId,
  MESSAGE_KINDS,
  type MessageId,
  type MessageKind,
} from '@rayzan/protocol';

import {
  COORDINATOR_COMMAND_PROTOCOL_VERSION,
  type CompleteRoundCommand,
  type CoordinatorCommand,
  type CoordinatorCommandBatch,
  type DispatchCommand,
  type FinalizeDebateCommand,
} from './coordinator-command.js';
import type { RecipientSelector } from './dispatch-plan.js';
import { OrchestratorError } from './error.js';

export function parseCoordinatorCommandBatch(
  text: string,
): CoordinatorCommandBatch {
  if (typeof text !== 'string') {
    throw new OrchestratorError('coordinator command batch must be a string');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new OrchestratorError('coordinator command batch is not valid JSON');
  }

  const root = requirePlainObject(parsed, 'coordinator command batch');
  rejectUnknownKeys(root, ['version', 'commands'], 'coordinator command batch');

  if (!Object.hasOwn(root, 'version')) {
    throw new OrchestratorError('coordinator command batch is missing version');
  }
  if (root.version !== COORDINATOR_COMMAND_PROTOCOL_VERSION) {
    throw new OrchestratorError(
      `unsupported coordinator command protocol version: ${stringifyValue(root.version)}`,
    );
  }

  if (!Object.hasOwn(root, 'commands')) {
    throw new OrchestratorError(
      'coordinator command batch is missing commands',
    );
  }
  if (!Array.isArray(root.commands)) {
    throw new OrchestratorError(
      'coordinator command batch commands must be an array',
    );
  }
  if (root.commands.length === 0) {
    throw new OrchestratorError(
      'coordinator command batch commands cannot be empty',
    );
  }

  const commands = Object.freeze(
    root.commands.map((command, index) =>
      parseCommand(command, `commands[${index}]`),
    ),
  );

  return Object.freeze({
    version: COORDINATOR_COMMAND_PROTOCOL_VERSION,
    commands,
  });
}

function parseCommand(value: unknown, field: string): CoordinatorCommand {
  const command = requirePlainObject(value, field);
  const type = requireString(command.type, `${field}.type`);

  if (type === 'dispatch') {
    return parseDispatchCommand(command, field);
  }
  if (type === 'complete-round') {
    return parseCompleteRoundCommand(command, field);
  }
  if (type === 'finalize-debate') {
    return parseFinalizeDebateCommand(command, field);
  }

  throw new OrchestratorError(`unknown command type: ${type}`);
}

function parseDispatchCommand(
  command: Record<string, unknown>,
  field: string,
): DispatchCommand {
  rejectUnknownKeys(
    command,
    [
      'type',
      'messageId',
      'debateId',
      'roundId',
      'recipients',
      'kind',
      'body',
      'referencedMessageIds',
    ],
    field,
  );

  const parsed: DispatchCommand = {
    type: 'dispatch',
    messageId: requireId(command.messageId, `${field}.messageId`, asMessageId),
    debateId: requireId(command.debateId, `${field}.debateId`, asDebateId),
    recipients: parseRecipients(command.recipients, `${field}.recipients`),
    kind: parseMessageKind(command.kind, `${field}.kind`),
    body: requireNonEmptyBody(command.body, `${field}.body`),
    referencedMessageIds: parseReferencedMessageIds(
      command.referencedMessageIds,
      `${field}.referencedMessageIds`,
    ),
  };

  if (Object.hasOwn(command, 'roundId')) {
    return Object.freeze({
      ...parsed,
      roundId: requireId(command.roundId, `${field}.roundId`, asRoundId),
    });
  }

  return Object.freeze(parsed);
}

function parseCompleteRoundCommand(
  command: Record<string, unknown>,
  field: string,
): CompleteRoundCommand {
  rejectUnknownKeys(command, ['type', 'debateId', 'roundId'], field);

  return Object.freeze({
    type: 'complete-round',
    debateId: requireId(command.debateId, `${field}.debateId`, asDebateId),
    roundId: requireId(command.roundId, `${field}.roundId`, asRoundId),
  });
}

function parseFinalizeDebateCommand(
  command: Record<string, unknown>,
  field: string,
): FinalizeDebateCommand {
  rejectUnknownKeys(command, ['type', 'debateId', 'body'], field);

  return Object.freeze({
    type: 'finalize-debate',
    debateId: requireId(command.debateId, `${field}.debateId`, asDebateId),
    body: requireNonEmptyBody(command.body, `${field}.body`),
  });
}

function parseRecipients(value: unknown, field: string): RecipientSelector {
  const recipients = requirePlainObject(value, field);
  const type = requireString(recipients.type, `${field}.type`);

  if (type === 'round-watchers') {
    rejectUnknownKeys(recipients, ['type'], field);
    return Object.freeze({ type: 'round-watchers' });
  }

  if (type !== 'explicit-agents') {
    throw new OrchestratorError(
      `recipient selector type is not a recognized value: ${type}`,
    );
  }

  rejectUnknownKeys(recipients, ['type', 'agentIds'], field);

  if (!Array.isArray(recipients.agentIds) || recipients.agentIds.length === 0) {
    throw new OrchestratorError('explicit-agents list cannot be empty');
  }

  const agentIds = recipients.agentIds.map((agentId, index) =>
    requireId(agentId, `${field}.agentIds[${index}]`, asAgentId),
  );

  if (new Set(agentIds).size !== agentIds.length) {
    throw new OrchestratorError('duplicate explicit recipient ids');
  }

  return Object.freeze({
    type: 'explicit-agents',
    agentIds: Object.freeze(agentIds),
  });
}

function parseReferencedMessageIds(
  value: unknown,
  field: string,
): readonly MessageId[] {
  if (!Array.isArray(value)) {
    throw new OrchestratorError(`${field} must be an array`);
  }

  const referencedMessageIds = value.map((id, index) =>
    requireId(id, `${field}[${index}]`, asMessageId),
  );

  if (new Set(referencedMessageIds).size !== referencedMessageIds.length) {
    throw new OrchestratorError('duplicate referenced message ids');
  }

  return Object.freeze(referencedMessageIds);
}

function parseMessageKind(value: unknown, field: string): MessageKind {
  const kind = requireString(value, field);
  if (!(MESSAGE_KINDS as readonly string[]).includes(kind)) {
    throw new OrchestratorError(`${field} is not a recognized value`);
  }
  return kind as MessageKind;
}

function requirePlainObject(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new OrchestratorError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new OrchestratorError(`${field} must be a string`);
  }
  return value;
}

function requireNonEmptyBody(value: unknown, field: string): string {
  const body = requireString(value, field).trim();
  if (body.length === 0) {
    throw new OrchestratorError(`${field} cannot be empty`);
  }
  return body;
}

function requireId<T extends string>(
  value: unknown,
  field: string,
  asId: (value: string) => T,
): T {
  const id = requireString(value, field);
  try {
    return asId(id);
  } catch {
    throw new OrchestratorError(`${field} cannot be empty`);
  }
}

function rejectUnknownKeys(
  object: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(object)) {
    if (!allowedKeys.has(key)) {
      throw new OrchestratorError(`unknown field ${field}.${key}`);
    }
  }
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value);
}
