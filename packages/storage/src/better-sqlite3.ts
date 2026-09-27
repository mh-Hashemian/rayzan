import { createRequire } from 'node:module';
import path from 'node:path';

import type Database from 'better-sqlite3';

let sqlite3: typeof Database | undefined;

/**
 * Electron ships its own ABI build of better-sqlite3, so callers point this
 * override at that directory instead of the plain Node copy.
 */
export function betterSqlite3(): typeof Database {
  if (sqlite3 === undefined) {
    const override = process.env.RAYZAN_BETTER_SQLITE3;
    sqlite3 =
      override !== undefined && override.length > 0
        ? (createRequire(path.join(override, 'package.json'))(
            'better-sqlite3',
          ) as typeof Database)
        : (createRequire(import.meta.url)('better-sqlite3') as typeof Database);
  }
  return sqlite3;
}
