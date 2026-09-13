import type { Debate } from '../debate.js';
import type { DebateId } from '../ids.js';
import { ProtocolError } from '../validate.js';

export interface DebateStore {
  create(debate: Debate): Debate;
  getById(id: DebateId): Debate | undefined;
  list(): readonly Debate[];
  update(debate: Debate): Debate;
}

export class InMemoryDebateStore implements DebateStore {
  readonly #debates = new Map<DebateId, Debate>();

  create(debate: Debate): Debate {
    if (this.#debates.has(debate.id)) {
      throw new ProtocolError(`debate id already exists: ${debate.id}`);
    }

    this.#debates.set(debate.id, debate);
    return debate;
  }

  getById(id: DebateId): Debate | undefined {
    return this.#debates.get(id);
  }

  list(): readonly Debate[] {
    return [...this.#debates.values()];
  }

  update(debate: Debate): Debate {
    if (!this.#debates.has(debate.id)) {
      throw new ProtocolError(`debate not found: ${debate.id}`);
    }

    this.#debates.set(debate.id, debate);
    return debate;
  }
}
