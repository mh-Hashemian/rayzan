import {
  asAgentId,
  asDebateId,
  asExposureId,
  asMessageId,
  asRoundId,
  type AgentId,
  type DebateId,
  type ExposureId,
  type MessageId,
  type RoundId,
} from './ids.js';
import { ProtocolError, requireNonEmptyString } from './validate.js';

export interface ExposureRecord {
  readonly id: ExposureId;
  readonly agentId: AgentId;
  readonly debateId: DebateId;
  readonly roundId?: RoundId;
  readonly messageId: MessageId;
  readonly referencedMessageIds: readonly MessageId[];
}

export interface ExposureLedger {
  readonly records: readonly ExposureRecord[];
}

export function createExposureRecord(input: {
  id: string;
  agentId: string;
  debateId: string;
  roundId?: string;
  messageId: string;
  referencedMessageIds?: readonly string[];
}): ExposureRecord {
  const referencedMessageIds = Object.freeze(
    (input.referencedMessageIds ?? []).map((messageId, index) =>
      asMessageId(
        requireNonEmptyString(messageId, `referencedMessageIds[${index}]`),
      ),
    ),
  );

  const record: ExposureRecord = {
    id: asExposureId(input.id),
    agentId: asAgentId(input.agentId),
    debateId: asDebateId(input.debateId),
    messageId: asMessageId(input.messageId),
    referencedMessageIds,
  };

  if (input.roundId !== undefined) {
    return Object.freeze({
      ...record,
      roundId: asRoundId(input.roundId),
    });
  }

  return Object.freeze(record);
}

export function createExposureLedger(
  records: readonly ExposureRecord[] = [],
): ExposureLedger {
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.id)) {
      throw new ProtocolError(`exposure id already exists: ${record.id}`);
    }
    seen.add(record.id);
  }

  return Object.freeze({
    records: Object.freeze([...records]),
  });
}

export function emptyExposureLedger(): ExposureLedger {
  return createExposureLedger();
}

export function recordExposure(
  ledger: ExposureLedger,
  record: ExposureRecord,
): ExposureLedger {
  return createExposureLedger([...ledger.records, record]);
}

export function exposuresForAgent(
  ledger: ExposureLedger,
  agentId: AgentId,
): readonly ExposureRecord[] {
  return ledger.records.filter((record) => record.agentId === agentId);
}
