import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EVENT_DATABASE_RELATIVE_PATH = 'data/rayzan.sqlite';

export function defaultEventDatabasePath(): string {
  const packageRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
  );
  return path.join(packageRoot, EVENT_DATABASE_RELATIVE_PATH);
}
