import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type {
  DebateConversationOwnership,
  ManagedProviderId,
  ProviderConversationRef,
} from './types.js';

interface StoreFile {
  readonly version: 1;
  readonly ownerships: DebateConversationOwnership[];
}

export class ConversationStore {
  readonly #path: string;
  #ownerships: DebateConversationOwnership[] = [];

  constructor(userDataPath: string) {
    const dir = path.join(userDataPath, 'managed-providers');
    mkdirSync(dir, { recursive: true });
    this.#path = path.join(dir, 'conversations.json');
    this.#load();
  }

  list(): readonly DebateConversationOwnership[] {
    return this.#ownerships;
  }

  forDebate(debateId: string): readonly DebateConversationOwnership[] {
    return this.#ownerships.filter((item) => item.debateId === debateId);
  }

  forAgentDebate(
    debateId: string,
    agentId: string,
  ): DebateConversationOwnership | undefined {
    return this.#ownerships.find(
      (item) => item.debateId === debateId && item.agentId === agentId,
    );
  }

  upsert(input: {
    readonly debateId: string;
    readonly agentId: string;
    readonly providerId: ManagedProviderId;
    readonly conversation: ProviderConversationRef;
    readonly status?: DebateConversationOwnership['status'];
  }): DebateConversationOwnership {
    const next: DebateConversationOwnership = {
      debateId: input.debateId,
      agentId: input.agentId,
      providerId: input.providerId,
      conversation: input.conversation,
      status: input.status ?? 'active',
      createdAt: new Date().toISOString(),
    };
    this.#ownerships = [
      ...this.#ownerships.filter(
        (item) =>
          !(item.debateId === input.debateId && item.agentId === input.agentId),
      ),
      next,
    ];
    this.#save();
    return next;
  }

  markStatus(
    debateId: string,
    agentId: string,
    status: DebateConversationOwnership['status'],
  ): void {
    this.#ownerships = this.#ownerships.map((item) =>
      item.debateId === debateId && item.agentId === agentId
        ? { ...item, status }
        : item,
    );
    this.#save();
  }

  #load(): void {
    if (!existsSync(this.#path)) {
      this.#ownerships = [];
      return;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.#path, 'utf8')) as StoreFile;
      this.#ownerships = Array.isArray(parsed.ownerships)
        ? parsed.ownerships
        : [];
    } catch {
      this.#ownerships = [];
    }
  }

  #save(): void {
    const payload: StoreFile = {
      version: 1,
      ownerships: this.#ownerships,
    };
    writeFileSync(this.#path, JSON.stringify(payload, null, 2), 'utf8');
  }
}
