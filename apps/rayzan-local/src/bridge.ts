import type { IncomingMessage, ServerResponse } from 'node:http';

import { AGENT_ROLES, type AgentRole } from '@rayzan/protocol';

import {
  COORDINATOR_PROFILE_MAX_CHARS,
  RayzanRuntime,
} from './runtime.js';
import { desktopStatus, type TeamAgentView } from './status.js';
import { attachEventStream } from './event-stream.js';

export interface BridgeContext {
  readonly databasePath?: string;
}

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
  context: BridgeContext = {},
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
    if (request.method === 'GET' && url.pathname === '/api/events/stream') {
      attachEventStream(runtime, request, response);
      return true;
    }
    if (request.method === 'GET' && url.pathname === '/api/status') {
      write(response, 200, desktopStatus(runtime, context));
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
    if (request.method === 'GET' && url.pathname === '/api/debug/providers') {
      write(response, 200, runtime.debugProviders());
      return true;
    }
    if (request.method === 'POST' && url.pathname === '/api/debug/managed-state') {
      const body = await readJson(request);
      runtime.noteManagedDebugState(body);
      write(response, 200, { ok: true });
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
        capture: body.capture,
      });
      write(response, 200, { ok: true });
      return true;
    }
    if (request.method === 'POST' && url.pathname === '/api/bindings') {
      const body = await readJson(request);
      runtime.noteBinding({
        agentId: String(body.agentId ?? ''),
        provider: typeof body.provider === 'string' ? body.provider : undefined,
        tabId: typeof body.tabId === 'string' ? body.tabId : undefined,
        available: body.available !== false,
        error: typeof body.error === 'string' ? body.error : undefined,
      });
      write(response, 200, { ok: true });
      return true;
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/api/session/test-send'
    ) {
      const body = await readJson(request);
      runtime.sendTestMessage(
        String(body.agentId ?? ''),
        String(body.body ?? ''),
      );
      write(response, 200, runtime.snapshot());
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
      assertStartableTeam(runtime, context);
      runtime.createRound1(String(body.problem ?? ''));
      write(response, 200, runtime.snapshot());
      return true;
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/api/session/run-live-round'
    ) {
      const body = await readJson(request);
      assertStartableTeam(runtime, context);
      runtime.runLiveRound1(String(body.problem ?? ''));
      write(response, 200, runtime.snapshot());
      return true;
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/api/session/start-round'
    ) {
      const body = await readJson(request);
      assertStartableTeam(runtime, context);
      runtime.runLiveRound1(String(body.problem ?? ''));
      write(response, 200, runtime.snapshot());
      return true;
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/api/session/retry-coordinator-dispatch'
    ) {
      runtime.retryCoordinatorDispatch();
      write(response, 200, runtime.snapshot());
      return true;
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/api/session/continue-debate'
    ) {
      const body = await readJson(request);
      runtime.continueDebate(
        typeof body.guidance === 'string' ? body.guidance : undefined,
      );
      write(response, 200, runtime.snapshot());
      return true;
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/api/session/finish-debate'
    ) {
      runtime.finishDebate();
      write(response, 200, runtime.snapshot());
      return true;
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/api/session/answer-operator-question'
    ) {
      const body = await readJson(request);
      runtime.answerOperatorQuestion(String(body.answer ?? ''));
      write(response, 200, runtime.snapshot());
      return true;
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/api/session/change-coordinator'
    ) {
      const body = await readJson(request);
      runtime.changeCoordinator(String(body.agentId ?? ''));
      write(response, 200, desktopStatus(runtime, context));
      return true;
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/api/session/set-watcher-participation'
    ) {
      const body = await readJson(request);
      runtime.setWatcherParticipation(
        String(body.agentId ?? ''),
        body.enabled !== false,
      );
      write(response, 200, desktopStatus(runtime, context));
      return true;
    }
    if (
      request.method === 'POST' &&
      (url.pathname === '/api/session/archive-debate' ||
        url.pathname === '/api/session/end-debate')
    ) {
      runtime.archiveActiveDebate();
      write(response, 200, runtime.snapshot());
      return true;
    }

    if (request.method === 'GET' && url.pathname === '/api/coordinator-profile') {
      write(response, 200, {
        profile: runtime.getCoordinatorProfile() ?? null,
        maxCharacters: COORDINATOR_PROFILE_MAX_CHARS,
      });
      return true;
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/api/coordinator-profile'
    ) {
      const body = await readJson(request);
      const profile = runtime.setCoordinatorProfile({
        filename: String(body.filename ?? ''),
        content: String(body.content ?? ''),
      });
      write(response, 200, { profile: profile ?? null });
      return true;
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/api/coordinator-profile/remove'
    ) {
      runtime.clearCoordinatorProfile();
      write(response, 200, { profile: null });
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
      const agentId = String(body.agentId ?? '');
      const text = String(body.body ?? '');
      if (body.salvage === true || body.provenance === 'operator-visible-response') {
        runtime.salvageVisibleResponse(agentId, deliveryId, text);
      } else {
        runtime.submitCapturedResponse(agentId, deliveryId, text);
      }
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

/**
 * Server-side gate for starting a debate. The desktop UI disables Start for the
 * same conditions, but the HTTP routes are reachable directly, so the team is
 * re-checked here against live binding state. Resuming an existing debate is
 * left to the runtime's own guards.
 */
function assertStartableTeam(
  runtime: RayzanRuntime,
  context: BridgeContext,
): void {
  const status = desktopStatus(runtime, context);
  if (status.activeDebate !== null) {
    return;
  }
  const coordinators = status.team.filter(
    (agent) => agent.role === 'coordinator',
  );
  if (coordinators.length !== 1) {
    throw new Error('register exactly one Coordinator before starting a debate');
  }
  assertReachable(coordinators[0]!);
  const watchers = status.team.filter(
    (agent) => agent.role === 'watcher' && agent.enabled,
  );
  if (watchers.length === 0) {
    throw new Error('include at least one Watcher in the next debate');
  }
  for (const watcher of watchers) {
    assertReachable(watcher);
  }
}

/**
 * A provider-managed agent only reaches its model through a live browser
 * binding. Agents without a provider are plain HTTP pollers, which the runtime
 * serves without any binding, so they stay startable.
 */
function assertReachable(agent: TeamAgentView): void {
  if (agent.provider === undefined || agent.connection === 'connected') {
    return;
  }
  throw new Error(
    `${agent.name} is not connected. Reconnect it in Settings → AI Providers before starting a decision.`,
  );
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
