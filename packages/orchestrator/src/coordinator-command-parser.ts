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
  CHECKPOINT_RECOMMENDATIONS,
  COORDINATOR_ACTION_MODES,
  COORDINATOR_COMMAND_PROTOCOL_VERSION,
  type AskOperatorCommand,
  type CheckpointCommand,
  type CheckpointRecommendation,
  type CompleteRoundCommand,
  type CoordinatorActionMode,
  type CoordinatorCommand,
  type CoordinatorCommandBatch,
  type DispatchCommand,
  type FinalizeDebateCommand,
  type ForwardCommand,
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
      'coordinator command batch commands must be an array',
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

  assertExclusiveActionSemantics(commands);

  return Object.freeze({
    version: COORDINATOR_COMMAND_PROTOCOL_VERSION,
    commands,
  });
}

function assertExclusiveActionSemantics(
  commands: readonly CoordinatorCommand[],
): void {
  const modes = new Set<CoordinatorActionMode>();
  for (const command of commands) {
    if (
      (COORDINATOR_ACTION_MODES as readonly string[]).includes(command.type)
    ) {
      modes.add(command.type as CoordinatorActionMode);
    }
  }

  if (modes.size > 1) {
    throw new OrchestratorError(
      `a Coordinator step may contain only one action mode; found ${[...modes].join(' + ')}`,
    );
  }

  const mode = [...modes][0];
  if (mode === 'checkpoint') {
    if (commands.length !== 1) {
      throw new OrchestratorError(
        'checkpoint must be the only command in the batch',
      );
    }
  }
  if (mode === 'ask_operator') {
    if (commands.length !== 1) {
      throw new OrchestratorError(
        'ask_operator must be the only command in the batch',
      );
    }
  }
}

function parseCommand(value: unknown, field: string): CoordinatorCommand {
  const command = requirePlainObject(value, field);
  const type = requireString(command.type, `${field}.type`);

  if (type === 'dispatch') {
    return parseDispatchCommand(command, field);
  }
  if (type === 'forward') {
    return parseForwardCommand(command, field);
  }
  if (type === 'ask_operator') {
    return parseAskOperatorCommand(command, field);
  }
  if (type === 'checkpoint') {
    return parseCheckpointCommand(command, field);
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

  const messageId = optionalId(
    command.messageId,
    `${field}.messageId`,
    asMessageId,
    'pending-message',
  );
  const debateId = optionalId(
    command.debateId,
    `${field}.debateId`,
    asDebateId,
    'pending-debate',
  );

  const parsed: DispatchCommand = {
    type: 'dispatch',
    messageId,
    debateId,
    recipients: parseRecipients(command.recipients, `${field}.recipients`),
    kind: Object.hasOwn(command, 'kind')
      ? parseMessageKind(command.kind, `${field}.kind`)
      : 'query',
    body: requireNonEmptyBody(command.body, `${field}.body`),
    referencedMessageIds: parseReferencedMessageIds(
      command.referencedMessageIds,
      `${field}.referencedMessageIds`,
    ),
  };

  if (Object.hasOwn(command, 'roundId') && command.roundId !== undefined) {
    return Object.freeze({
      ...parsed,
      roundId: requireId(command.roundId, `${field}.roundId`, asRoundId),
    });
  }

  return Object.freeze(parsed);
}

function parseForwardCommand(
  command: Record<string, unknown>,
  field: string,
): ForwardCommand {
  rejectUnknownKeys(
    command,
    [
      'type',
      'messageId',
      'debateId',
      'roundId',
      'recipients',
      'sourceRefs',
      'sourceMessageIds',
      'instruction',
    ],
    field,
  );

  const sourceRefs = parseStringList(
    command.sourceRefs,
    `${field}.sourceRefs`,
    true,
  );
  const sourceMessageIds = parseReferencedMessageIds(
    command.sourceMessageIds,
    `${field}.sourceMessageIds`,
  );
  if (sourceRefs.length === 0 && sourceMessageIds.length === 0) {
    throw new OrchestratorError(
      `${field} requires sourceRefs or sourceMessageIds`,
    );
  }

  let instruction: string | undefined;
  if (Object.hasOwn(command, 'instruction') && command.instruction !== undefined) {
    instruction = requireNonEmptyBody(
      command.instruction,
      `${field}.instruction`,
    );
  }

  const parsed: ForwardCommand = {
    type: 'forward',
    messageId: optionalId(
      command.messageId,
      `${field}.messageId`,
      asMessageId,
      'pending-message',
    ),
    debateId: optionalId(
      command.debateId,
      `${field}.debateId`,
      asDebateId,
      'pending-debate',
    ),
    recipients: parseRecipients(command.recipients, `${field}.recipients`),
    sourceRefs,
    sourceMessageIds,
    ...(instruction !== undefined ? { instruction } : {}),
  };

  if (Object.hasOwn(command, 'roundId') && command.roundId !== undefined) {
    return Object.freeze({
      ...parsed,
      roundId: requireId(command.roundId, `${field}.roundId`, asRoundId),
    });
  }

  return Object.freeze(parsed);
}

function parseAskOperatorCommand(
  command: Record<string, unknown>,
  field: string,
): AskOperatorCommand {
  rejectUnknownKeys(
    command,
    ['type', 'debateId', 'roundId', 'question'],
    field,
  );

  return Object.freeze({
    type: 'ask_operator',
    debateId: optionalId(
      command.debateId,
      `${field}.debateId`,
      asDebateId,
      'pending-debate',
    ),
    roundId: optionalId(
      command.roundId,
      `${field}.roundId`,
      asRoundId,
      'pending-round',
    ),
    question: requireNonEmptyBody(command.question, `${field}.question`),
  });
}

function parseCheckpointCommand(
  command: Record<string, unknown>,
  field: string,
): CheckpointCommand {
  rejectUnknownKeys(
    command,
    ['type', 'debateId', 'roundId', 'content', 'body', 'recommendation'],
    field,
  );

  const contentRaw = Object.hasOwn(command, 'content')
    ? command.content
    : command.body;
  const recommendationRaw = requireString(
    command.recommendation,
    `${field}.recommendation`,
  ).trim();
  const recommendation = normalizeRecommendation(recommendationRaw, field);

  return Object.freeze({
    type: 'checkpoint',
    debateId: optionalId(
      command.debateId,
      `${field}.debateId`,
      asDebateId,
      'pending-debate',
    ),
    roundId: optionalId(
      command.roundId,
      `${field}.roundId`,
      asRoundId,
      'pending-round',
    ),
    content: requireNonEmptyBody(contentRaw, `${field}.content`),
    recommendation,
  });
}

function normalizeRecommendation(
  value: string,
  field: string,
): CheckpointRecommendation {
  const lower = value.toLowerCase();
  if ((CHECKPOINT_RECOMMENDATIONS as readonly string[]).includes(lower)) {
    return lower as CheckpointRecommendation;
  }
  if (lower === 'finish' || /^finish\b/i.test(value)) {
    return 'finish';
  }
  if (lower === 'continue' || /^continue\b/i.test(value)) {
    return 'continue';
  }
  throw new OrchestratorError(
    `${field}.recommendation must be FINISH or CONTINUE`,
  );
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
  if (value === undefined || value === null) {
    return Object.freeze([]);
  }
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

function parseStringList(
  value: unknown,
  field: string,
  optional: boolean,
): readonly string[] {
  if (value === undefined || value === null) {
    if (optional) {
      return Object.freeze([]);
    }
    throw new OrchestratorError(`${field} must be an array`);
  }
  if (!Array.isArray(value)) {
    throw new OrchestratorError(`${field} must be an array`);
  }
  const items = value.map((item, index) => {
    const text = requireString(item, `${field}[${index}]`).trim();
    if (text.length === 0) {
      throw new OrchestratorError(`${field}[${index}] cannot be empty`);
    }
    return text;
  });
  if (new Set(items).size !== items.length) {
    throw new OrchestratorError(`duplicate ${field} values`);
  }
  return Object.freeze(items);
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

function optionalId<T extends string>(
  value: unknown,
  field: string,
  asId: (value: string) => T,
  placeholder: string,
): T {
  if (value === undefined || value === null || value === '') {
    return asId(placeholder);
  }
  return requireId(value, field, asId);
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
