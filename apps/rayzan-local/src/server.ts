import { createServer, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { EventStore } from '@rayzan/events';
import { InMemoryEventStore, SqliteEventStore } from '@rayzan/storage';

import { handleBridgeRequest } from './bridge.js';
import { LOCAL_BRIDGE_PORT } from './demo-ids.js';
import { defaultEventDatabasePath } from './event-database.js';
import { RayzanRuntime } from './runtime.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '../public');

export function startRayzanLocal(
  port = LOCAL_BRIDGE_PORT,
  options: { events?: EventStore } = {},
) {
  const runtime = new RayzanRuntime(
    options.events ?? new InMemoryEventStore(),
  );
  const server = createServer(async (request, response) => {
    const host = request.headers.host ?? `127.0.0.1:${port}`;
    const url = new URL(request.url ?? '/', `http://${host}`);

    try {
      if (await handleBridgeRequest(runtime, request, response, url)) {
        return;
      }

      if (
        request.method === 'GET' &&
        (url.pathname === '/' || url.pathname === '/dashboard')
      ) {
        await serveFile(response, 'dashboard.html', 'text/html; charset=utf-8');
        return;
      }
      if (request.method === 'GET' && url.pathname === '/fixture-chat') {
        await serveFile(
          response,
          'fixture-chat.html',
          'text/html; charset=utf-8',
        );
        return;
      }

      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('Not found');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.writeHead(500, { 'Content-Type': 'text/plain' });
      response.end(message);
    }
  });

  return { runtime, server };
}

async function serveFile(
  response: ServerResponse,
  fileName: string,
  contentType: string,
) {
  const filePath = path.join(publicDir, fileName);
  const body = await readFile(filePath);
  response.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': body.length,
  });
  response.end(body);
}

const launchedDirectly =
  path.resolve(fileURLToPath(import.meta.url)) ===
  path.resolve(process.argv[1] ?? '');

if (launchedDirectly) {
  const events = new SqliteEventStore(defaultEventDatabasePath());
  const { server } = startRayzanLocal(LOCAL_BRIDGE_PORT, { events });
  server.listen(LOCAL_BRIDGE_PORT, '127.0.0.1', () => {
    process.stdout.write(
      `Rayzan local bridge http://127.0.0.1:${LOCAL_BRIDGE_PORT}\n` +
        `Event database ${events.path}\n`,
    );
  });
  const shutdown = () => {
    events.close();
    server.close(() => {
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
