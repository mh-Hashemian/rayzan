import { mkdirSync } from 'node:fs';
import path from 'node:path';

import type Database from 'better-sqlite3';

import { betterSqlite3 } from './better-sqlite3.js';
import type { SettingsStore } from './settings-store.js';

interface SettingRow {
  value: string;
}

/**
 * Operator settings live in the same SQLite file as the event history, so a
 * single user-data directory keeps events and preferences together.
 */
export class SqliteSettingsStore implements SettingsStore {
  readonly path: string;
  readonly #db: Database.Database;
  readonly #get: Database.Statement<[string], SettingRow>;
  readonly #set: Database.Statement<[{ key: string; value: string }], void>;
  readonly #remove: Database.Statement<[string], void>;

  constructor(filePath: string) {
    if (filePath.trim().length === 0) {
      throw new Error('settings database path cannot be empty');
    }
    this.path = path.resolve(filePath);
    mkdirSync(path.dirname(this.path), { recursive: true });
    this.#db = new (betterSqlite3())(this.path);
    this.#db.pragma('journal_mode = WAL');
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.#get = this.#db.prepare('SELECT value FROM settings WHERE key = ?');
    this.#set = this.#db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (@key, @value, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);
    this.#remove = this.#db.prepare('DELETE FROM settings WHERE key = ?');
  }

  close(): void {
    if (this.#db.open) {
      this.#db.close();
    }
  }

  get(key: string): string | undefined {
    const row = this.#get.get(key);
    return row === undefined ? undefined : row.value;
  }

  set(key: string, value: string): void {
    this.#set.run({ key, value });
  }

  remove(key: string): void {
    this.#remove.run(key);
  }
}
