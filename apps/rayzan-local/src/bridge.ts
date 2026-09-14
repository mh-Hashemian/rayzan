import type { IncomingMessage, ServerResponse } from 'node:http';

import { AGENT_ROLES, type AgentRole } from '@rayzan/protocol';

import { RayzanRuntime } from './runtime.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Private-Network': 'true',
};

export async function handleBridgeRequest(
  runtime: RayzanRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/')) {
    return false;
  }

  if (request.method === 'OPTIONS') {
    write(response, 204, {});
    return true;
  }

  try {
    if (request.method === 'GET' && url.pathname === '/api/health') {
      write(response, 200, { ok: true });
      return true;
    }
    if (request.method === 'GET' && url.pathname === '/api/agents') {
      write(
        response,
        200,
        runtime.listAgents().map((agent) => ({
          id: agent.id,
          name: agent.name,
          role: agent.role,
        })),
      );
      return true;
    }
    if (request.method === 'POST' && url.pathname === '/api/agents') {
      const body = await readJson(request);
      const role = String(body.role ?? '');
      if (!(AGENT_ROLES as readonly string[]).includes(role)) {
        write(response, 400, { error: 'role is not a recognized value' });
        return true;
      }
      const agent = runtime.registerAgent(
        String(body.name ?? ''),
        role as AgentRole,
      );
      write(response, 200, {
        id: agent.id,
        name: agent.name,
        role: agent.role,
      });
      return true;
    }
    if (request.method === 'GET' && url.pathname === '/api/state') {
      write(response, 200, runtime.snapshot());
      return true;
    }
    if (request.method === 'POST' && url.pathname === '/api/presence') {
      const body = await readJson(request);
      runtime.notePresence({
        agentId: String(body.agentId ?? ''),
        provider: typeof body.provider === 'string' ? body.provider : undefined,
        phase: typeof body.phase === 'string' ? body.phase : undefined,
        error: typeof body.error === 'string' ? body.error : undefined,
        diagnostics: body.diagnostics,
      });
      write(response, 200, { ok: true });
      return true;
    }
    if (
      request.method === 'GET' &&
      url.pathname === '/api/deliveries/pending'
    ) {
      const agentId = url.searchParams.get('agentId');
      if (!agentId) {
        write(response, 400, { error: 'agentId is required' });
        return true;
      }
      write(response, 200, {
        job: runtime.nextPendingForAgent(agentId) ?? null,
      });
      return true;
    }
    if (
      request.method === 'GET' &&
      url.pathname === '/api/deliveries/awaiting'
    ) {
      const agentId = url.searchParams.get('agentId');
      if (!agentId) {
        write(response, 400, { error: 'agentId is required' });
        return true;
      }
      write(response, 200, {
        job: runtime.awaitingResponseForAgent(agentId) ?? null,
      });
      return true;
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/api/session/create-round'
    ) {
      const body = await readJson(request);
      runtime.createRound1(String(body.problem ?? ''));
      write(response, 200, runtime.snapshot());
      return true;
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/api/session/start-round'
    ) {
      const body = await readJson(request);
      runtime.startRound1(String(body.problem ?? ''));
      write(response, 200, runtime.snapshot());
      return true;
    }

    const ackMatch = /^\/api\/deliveries\/([^/]+)\/ack$/.exec(url.pathname);
    if (request.method === 'POST' && ackMatch) {
      const body = await readJson(request);
      const deliveryId = decodeURIComponent(ackMatch[1] ?? '');
      runtime.acknowledgeDelivery(String(body.agentId ?? ''), deliveryId);
      write(response, 200, { ok: true });
      return true;
    }

    const responseMatch = /^\/api\/deliveries\/([^/]+)\/response$/.exec(
      url.pathname,
    );
    if (request.method === 'POST' && responseMatch) {
      const body = await readJson(request);
      const deliveryId = decodeURIComponent(responseMatch[1] ?? '');
      runtime.submitCapturedResponse(
        String(body.agentId ?? ''),
        deliveryId,
        String(body.body ?? ''),
      );
      write(response, 200, runtime.snapshot());
      return true;
    }

    write(response, 404, { error: `unknown API route ${url.pathname}` });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    write(response, 400, { error: message });
    return true;
  }
}

async function readJson(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (raw.length === 0) {
    return {};
  }
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON body must be an object');
  }
  return parsed as Record<string, unknown>;
}

function write(response: ServerResponse, status: number, body: unknown): void {
  const payload = status === 204 ? '' : JSON.stringify(body);
  response.writeHead(status, {
    ...CORS_HEADERS,
    ...(status === 204
      ? {}
      : {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(payload),
        }),
  });
  response.end(payload);
}
