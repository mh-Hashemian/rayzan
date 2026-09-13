import type { DebateId, MessageId } from '../ids.js';
import type { MessageEnvelope } from '../message.js';
import { ProtocolError } from '../validate.js';

export interface MessageStore {
  store(message: MessageEnvelope): MessageEnvelope;
  getById(id: MessageId): MessageEnvelope | undefined;
  listByDebate(debateId: DebateId): readonly MessageEnvelope[];
}

export class InMemoryMessageStore implements MessageStore {
  readonly #messages = new Map<MessageId, MessageEnvelope>();

  store(message: MessageEnvelope): MessageEnvelope {
    if (message.recipientIds.length === 0) {
      throw new ProtocolError('recipient list cannot be empty');
    }

    if (this.#messages.has(message.id)) {
      throw new ProtocolError(`message id already exists: ${message.id}`);
    }

    this.#messages.set(message.id, message);
    return message;
  }

  getById(id: MessageId): MessageEnvelope | undefined {
    return this.#messages.get(id);
  }

  listByDebate(debateId: DebateId): readonly MessageEnvelope[] {
    return [...this.#messages.values()].filter(
      (message) => message.debateId === debateId,
    );
  }
}
