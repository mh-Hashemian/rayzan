import type { DebateId, RoundId } from '../ids.js';
import type { CoordinatorCheckpoint } from '../coordinator-checkpoint.js';
import { ProtocolError } from '../validate.js';

export interface CheckpointStore {
  store(checkpoint: CoordinatorCheckpoint): CoordinatorCheckpoint;
  getByRoundId(roundId: RoundId): CoordinatorCheckpoint | undefined;
  listByDebate(debateId: DebateId): readonly CoordinatorCheckpoint[];
}

export class InMemoryCheckpointStore implements CheckpointStore {
  readonly #byRound = new Map<RoundId, CoordinatorCheckpoint>();

  store(checkpoint: CoordinatorCheckpoint): CoordinatorCheckpoint {
    if (this.#byRound.has(checkpoint.roundId)) {
      throw new ProtocolError(`checkpoint already exists for round: ${checkpoint.roundId}`);
    }
    this.#byRound.set(checkpoint.roundId, checkpoint);
    return checkpoint;
  }

  getByRoundId(roundId: RoundId): CoordinatorCheckpoint | undefined {
    return this.#byRound.get(roundId);
  }

  listByDebate(debateId: DebateId): readonly CoordinatorCheckpoint[] {
    return [...this.#byRound.values()].filter(
      (checkpoint) => checkpoint.debateId === debateId,
    );
  }
}
