import type { DebateId, RoundId } from '../ids.js';
import type { Round } from '../round.js';
import { ProtocolError } from '../validate.js';

export interface RoundStore {
  create(round: Round): Round;
  getById(id: RoundId): Round | undefined;
  listByDebate(debateId: DebateId): readonly Round[];
  update(round: Round): Round;
}

export class InMemoryRoundStore implements RoundStore {
  readonly #rounds = new Map<RoundId, Round>();

  create(round: Round): Round {
    if (this.#rounds.has(round.id)) {
      throw new ProtocolError(`round id already exists: ${round.id}`);
    }

    this.#rounds.set(round.id, round);
    return round;
  }

  getById(id: RoundId): Round | undefined {
    return this.#rounds.get(id);
  }

  listByDebate(debateId: DebateId): readonly Round[] {
    return [...this.#rounds.values()].filter(
      (round) => round.debateId === debateId,
    );
  }

  update(round: Round): Round {
    if (!this.#rounds.has(round.id)) {
      throw new ProtocolError(`round not found: ${round.id}`);
    }

    this.#rounds.set(round.id, round);
    return round;
  }
}
