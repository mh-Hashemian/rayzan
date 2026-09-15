import { mkdirSync } from 'node:fs';
import path from 'node:path';

import {
  copyEvent,
  createEvent,
  EventError,
  type Event,
  type EventStore,
  type EventType,
} from '@rayzan/events';
import type { DebateId } from '@rayzan/protocol';
import Database from 'better-sqlite3';

export const EVENT_SCHEMA_VERSION = 1;

interface EventRow {
  id: string;
  type: string;
  debate_id: string | null;
  round_id: string | null;
  agent_id: string | null;
  timestamp: string;
  payload_json: string;
}

interface InsertParams {
  id: string;
  type: string;
  debate_id: string | null;
  round_id: string | null;
  agent_id: string | null;
  timestamp: string;
  payload_json: string;
}

export class SqliteEventStore implements EventStore {
  readonly path: string;
  readonly #db: Database.Database;
  readonly #insert: Database.Statement<[InsertParams]>;
  readonly #getById: Database.Statement<[string], EventRow>;
  readonly #listAll: Database.Statement<[], EventRow>;
  readonly #listByDebate: Database.Statement<[string], EventRow>;

  constructor(filePath: string) {
    if (filePath.trim().length === 0) {
      throw new EventError('sqlite event store path cannot be empty');
    }
    this.path = path.resolve(filePath);
    mkdirSync(path.dirname(this.path), { recursive: true });
    this.#db = new Database(this.path);
    this.#db.pragma('journal_mode = WAL');
    this.#initialize();
    this.#insert = this.#db.prepare(`
      INSERT INTO events (
        id, type, debate_id, round_id, agent_id, timestamp, payload_json
      ) VALUES (
        @id, @type, @debate_id, @round_id, @agent_id, @timestamp, @payload_json
      )
    `);
    this.#getById = this.#db.prepare(`
      SELECT id, type, debate_id, round_id, agent_id, timestamp, payload_json
      FROM events
      WHERE id = ?
    `);
    this.#listAll = this.#db.prepare(`
      SELECT id, type, debate_id, round_id, agent_id, timestamp, payload_json
      FROM events
      ORDER BY sequence ASC
    `);
    this.#listByDebate = this.#db.prepare(`
      SELECT id, type, debate_id, round_id, agent_id, timestamp, payload_json
      FROM events
      WHERE debate_id = ?
      ORDER BY sequence ASC
    `);
  }

  close(): void {
    if (this.#db.open) {
      this.#db.close();
    }
  }

  append(event: Event): void {
    const stored = copyEvent(event);
    try {
      this.#insert.run({
        id: stored.id,
        type: stored.type,
        debate_id: stored.debateId ?? null,
        round_id: stored.roundId ?? null,
        agent_id: stored.agentId ?? null,
        timestamp: stored.timestamp.toISOString(),
        payload_json: JSON.stringify(stored.payload),
      });
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new EventError(`duplicate event id: ${stored.id}`);
      }
      throw error;
    }
  }

  getById(id: string): Event | undefined {
    const row = this.#getById.get(id);
    return row === undefined ? undefined : rowToEvent(row);
  }

  listByDebate(debateId: DebateId): Event[] {
    return this.#listByDebate.all(debateId).map(rowToEvent);
  }

  listAll(): Event[] {
    return this.#listAll.all().map(rowToEvent);
  }

  #initialize(): void {
    const version = Number(this.#db.pragma('user_version', { simple: true }));
    if (version === 0) {
      this.#db.exec(`
        CREATE TABLE IF NOT EXISTS events (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          id TEXT NOT NULL UNIQUE,
          type TEXT NOT NULL,
          debate_id TEXT,
          round_id TEXT,
          agent_id TEXT,
          timestamp TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );
      `);
      this.#db.pragma(`user_version = ${EVENT_SCHEMA_VERSION}`);
      return;
    }
    if (version !== EVENT_SCHEMA_VERSION) {
      throw new EventError(`unsupported event schema version: ${version}`);
    }
  }
}

function rowToEvent(row: EventRow): Event {
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload_json) as unknown;
  } catch {
    throw new EventError(`event ${row.id} has invalid payload JSON`);
  }
  return createEvent({
    id: row.id,
    type: row.type as EventType,
    timestamp: new Date(row.timestamp),
    ...(row.debate_id !== null ? { debateId: row.debate_id } : {}),
    ...(row.round_id !== null ? { roundId: row.round_id } : {}),
    ...(row.agent_id !== null ? { agentId: row.agent_id } : {}),
    payload,
  });
}

function isUniqueConstraint(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  const code = (error as { code: unknown }).code;
  return code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT';
}
