import { createServer, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { EventStore } from '@rayzan/events';
import { InMemoryEventStore, SqliteEventStore } from '@rayzan/storage';

import { handleBridgeRequest, type BridgeContext } from './bridge.js';
import { LOCAL_BRIDGE_PORT } from './demo-ids.js';
import { resolveEventDatabasePath } from './event-database.js';
import { RayzanRuntime } from './runtime.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultPublicDir = path.join(here, '../public');

export interface CreateRayzanServerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly databasePath?: string;
  readonly events?: EventStore;
  readonly publicDir?: string;
}

export interface RayzanServer {
  readonly runtime: RayzanRuntime;
  readonly server: Server;
  readonly events: EventStore;
  readonly databasePath?: string;
  readonly host: string;
  readonly port: number;
  listen(): Promise<void>;
  close(): Promise<void>;
}

export function startRayzanLocal(
  port = LOCAL_BRIDGE_PORT,
  options: { events?: EventStore } = {},
): { runtime: RayzanRuntime; server: Server } {
  const events = options.events ?? new InMemoryEventStore();
  const runtime = new RayzanRuntime(events);
  const server = createHttpServer(runtime, {}, port, defaultPublicDir);
  return { runtime, server };
}

export function createRayzanServer(
  options: CreateRayzanServerOptions = {},
): RayzanServer {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? LOCAL_BRIDGE_PORT;
  const ownsEvents = options.events === undefined;
  const publicDir = options.publicDir ?? defaultPublicDir;
  const events =
    options.events ??
    new SqliteEventStore(resolveEventDatabasePath(options.databasePath));
  const databasePath =
    events instanceof SqliteEventStore ? events.path : options.databasePath;
  const runtime = new RayzanRuntime(events);
  runtime.ensureDefaultTeam();
  const context: BridgeContext = {
    ...(databasePath !== undefined ? { databasePath } : {}),
  };
  const server = createHttpServer(runtime, context, port, publicDir);

  return {
    runtime,
    server,
    events,
    ...(databasePath !== undefined ? { databasePath } : {}),
    host,
    port,
    listen() {
      return listen(server, port, host);
    },
    async close() {
      await closeHttpServer(server);
      if (ownsEvents && events instanceof SqliteEventStore) {
        events.close();
      }
    },
  };
}

function createHttpServer(
  runtime: RayzanRuntime,
  context: BridgeContext,
  port: number,
  publicDir: string,
): Server {
  return createServer(async (request, response) => {
    const host = request.headers.host ?? `127.0.0.1:${port}`;
    const url = new URL(request.url ?? '/', `http://${host}`);

    try {
      if (await handleBridgeRequest(runtime, request, response, url, context)) {
        return;
      }

      if (
        request.method === 'GET' &&
        (url.pathname === '/' ||
          url.pathname === '/dashboard' ||
          url.pathname === '/debug')
      ) {
        await serveFile(
          response,
          publicDir,
          'dashboard.html',
          'text/html; charset=utf-8',
        );
        return;
      }
      if (request.method === 'GET' && url.pathname === '/fixture-chat') {
        await serveFile(
          response,
          publicDir,
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
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      reject(error);
    };
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    server.close((error) => {
      if (
        error &&
        (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING'
      ) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function serveFile(
  response: ServerResponse,
  publicDir: string,
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
