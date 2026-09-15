import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { app } from 'electron';

function resolveElectronSqlite(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const isolated = [
    path.join(here, 'node_modules', 'better-sqlite3'),
    path.join(here, '..', '.electron-native', 'node_modules', 'better-sqlite3'),
  ];
  const packaged = path.join(here, '..', 'node_modules', 'better-sqlite3');
  const candidates = app.isPackaged ? [packaged, ...isolated] : [...isolated];
  for (const candidate of candidates) {
    if (
      existsSync(path.join(candidate, 'package.json')) &&
      existsSync(path.join(candidate, 'build', 'Release', 'better_sqlite3.node'))
    ) {
      return candidate;
    }
  }
  return undefined;
}

const resolved = resolveElectronSqlite();
if (resolved !== undefined) {
  process.env.RAYZAN_BETTER_SQLITE3 = resolved;
}
