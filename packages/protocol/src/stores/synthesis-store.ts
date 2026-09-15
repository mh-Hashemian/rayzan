import type { DebateId } from '../ids.js';
import type { DebateSynthesis } from '../synthesis.js';
import { ProtocolError } from '../validate.js';

export interface SynthesisStore {
  store(synthesis: DebateSynthesis): DebateSynthesis;
  getByDebateId(debateId: DebateId): DebateSynthesis | undefined;
}

export class InMemorySynthesisStore implements SynthesisStore {
  readonly #byDebate = new Map<DebateId, DebateSynthesis>();

  store(synthesis: DebateSynthesis): DebateSynthesis {
    if (this.#byDebate.has(synthesis.debateId)) {
      throw new ProtocolError(
        `synthesis already exists for debate: ${synthesis.debateId}`,
      );
    }
    this.#byDebate.set(synthesis.debateId, synthesis);
    return synthesis;
  }

  getByDebateId(debateId: DebateId): DebateSynthesis | undefined {
    return this.#byDebate.get(debateId);
  }
}
