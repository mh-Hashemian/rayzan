import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import {
  copyEvent,
  createEvent,
  EventError,
  LEGACY_EVENT_SCHEMA_VERSION,
  validateCausalReference,
  type Event,
  type EventStore,
  type EventType,
} from '@rayzan/events';
import type { DebateId } from '@rayzan/protocol';
import type Database from 'better-sqlite3';

function loadBetterSqlite3(): typeof Database {
  const override = process.env.RAYZAN_BETTER_SQLITE3;
  if (override !== undefined && override.length > 0) {
    return createRequire(path.join(override, 'package.json'))(
      'better-sqlite3',
    ) as typeof Database;
  }
  return createRequire(import.meta.url)('better-sqlite3') as typeof Database;
}

let sqlite3: typeof Database | undefined;

function betterSqlite3(): typeof Database {
  if (sqlite3 === undefined) {
    sqlite3 = loadBetterSqlite3();
  }
  return sqlite3;
}

/** SQLite `PRAGMA user_version`. Independent of Event.schemaVersion. */
export const EVENT_SCHEMA_VERSION = 2;

interface EventRow {
  id: string;
  type: string;
  schema_version: number | null;
  debate_id: string | null;
  round_id: string | null;
  agent_id: string | null;
  causation_event_id: string | null;
  correlation_id: string | null;
  timestamp: string;
  payload_json: string;
}

interface InsertParams {
  id: string;
  type: string;
  schema_version: number;
  debate_id: string | null;
  round_id: string | null;
  agent_id: string | null;
  causation_event_id: string | null;
  correlation_id: string | null;
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
    this.#db = new (betterSqlite3())(this.path);
    this.#db.pragma('journal_mode = WAL');
    this.#initialize();
    this.#insert = this.#db.prepare(`
      INSERT INTO events (
        id, type, schema_version, debate_id, round_id, agent_id,
        causation_event_id, correlation_id, timestamp, payload_json
      ) VALUES (
        @id, @type, @schema_version, @debate_id, @round_id, @agent_id,
        @causation_event_id, @correlation_id, @timestamp, @payload_json
      )
    `);
    this.#getById = this.#db.prepare(`
      SELECT id, type, schema_version, debate_id, round_id, agent_id,
             causation_event_id, correlation_id, timestamp, payload_json
      FROM events
      WHERE id = ?
    `);
    this.#listAll = this.#db.prepare(`
      SELECT id, type, schema_version, debate_id, round_id, agent_id,
             causation_event_id, correlation_id, timestamp, payload_json
      FROM events
      ORDER BY sequence ASC
    `);
    this.#listByDebate = this.#db.prepare(`
      SELECT id, type, schema_version, debate_id, round_id, agent_id,
             causation_event_id, correlation_id, timestamp, payload_json
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
    validateCausalReference(stored, (id) => this.getById(id));
    try {
      this.#insert.run({
        id: stored.id,
        type: stored.type,
        schema_version: stored.schemaVersion,
        debate_id: stored.debateId ?? null,
        round_id: stored.roundId ?? null,
        agent_id: stored.agentId ?? null,
        causation_event_id: stored.causationEventId ?? null,
        correlation_id: stored.correlationId ?? null,
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
          schema_version INTEGER,
          debate_id TEXT,
          round_id TEXT,
          agent_id TEXT,
          causation_event_id TEXT,
          correlation_id TEXT,
          timestamp TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );
      `);
      this.#db.pragma(`user_version = ${EVENT_SCHEMA_VERSION}`);
      return;
    }
    if (version === 1) {
      this.#migrateFromV1();
      return;
    }
    if (version === EVENT_SCHEMA_VERSION) {
      return;
    }
    throw new EventError(`unsupported event schema version: ${version}`);
  }

  #migrateFromV1(): void {
    const migrate = this.#db.transaction(() => {
      const columns = this.#db.pragma('table_info(events)') as Array<{
        name: string;
      }>;
      const names = new Set(columns.map((column) => column.name));
      if (!names.has('schema_version')) {
        this.#db.exec('ALTER TABLE events ADD COLUMN schema_version INTEGER');
      }
      if (!names.has('causation_event_id')) {
        this.#db.exec('ALTER TABLE events ADD COLUMN causation_event_id TEXT');
      }
      if (!names.has('correlation_id')) {
        this.#db.exec('ALTER TABLE events ADD COLUMN correlation_id TEXT');
      }
      this.#db.pragma(`user_version = ${EVENT_SCHEMA_VERSION}`);
    });
    migrate();
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
    schemaVersion:
      row.schema_version === null
        ? LEGACY_EVENT_SCHEMA_VERSION
        : row.schema_version,
    timestamp: new Date(row.timestamp),
    ...(row.debate_id !== null ? { debateId: row.debate_id } : {}),
    ...(row.round_id !== null ? { roundId: row.round_id } : {}),
    ...(row.agent_id !== null ? { agentId: row.agent_id } : {}),
    ...(row.causation_event_id !== null
      ? { causationEventId: row.causation_event_id }
      : {}),
    ...(row.correlation_id !== null
      ? { correlationId: row.correlation_id }
      : {}),
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
