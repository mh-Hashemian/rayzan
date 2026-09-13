import type { AgentId, DebateId, ExposureId, RoundId } from '../ids.js';
import type { ExposureRecord } from '../exposure.js';
import { ProtocolError } from '../validate.js';

export interface ExposureLedgerStore {
  record(exposure: ExposureRecord): ExposureRecord;
  getById(id: ExposureId): ExposureRecord | undefined;
  listByAgent(agentId: AgentId): readonly ExposureRecord[];
  listByDebate(debateId: DebateId): readonly ExposureRecord[];
  listByAgentInRound(
    agentId: AgentId,
    roundId: RoundId,
  ): readonly ExposureRecord[];
}

export class InMemoryExposureLedgerStore implements ExposureLedgerStore {
  readonly #records = new Map<ExposureId, ExposureRecord>();

  record(exposure: ExposureRecord): ExposureRecord {
    if (this.#records.has(exposure.id)) {
      throw new ProtocolError(`exposure id already exists: ${exposure.id}`);
    }

    this.#records.set(exposure.id, exposure);
    return exposure;
  }

  getById(id: ExposureId): ExposureRecord | undefined {
    return this.#records.get(id);
  }

  listByAgent(agentId: AgentId): readonly ExposureRecord[] {
    return [...this.#records.values()].filter(
      (record) => record.agentId === agentId,
    );
  }

  listByDebate(debateId: DebateId): readonly ExposureRecord[] {
    return [...this.#records.values()].filter(
      (record) => record.debateId === debateId,
    );
  }

  listByAgentInRound(
    agentId: AgentId,
    roundId: RoundId,
  ): readonly ExposureRecord[] {
    return this.listByAgent(agentId).filter(
      (record) => record.roundId === roundId,
    );
  }
}
