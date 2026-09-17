import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Event } from '@rayzan/events';

import type { RayzanRuntime } from './runtime.js';

const STREAM_TYPES = new Set([
  'AGENT_REGISTERED',
  'BINDING_CHANGED',
  'COORDINATOR_CHANGED',
  'WATCHER_PARTICIPATION_CHANGED',
  'MESSAGE_DISPATCHED',
  'DELIVERY_CREATED',
  'DELIVERY_CONFIRMED',
  'PROMPT_DISPATCH_REQUESTED',
  'PROMPT_DISPATCH_CONFIRMED',
  'CAPTURE_REQUESTED',
  'RESPONSE_CAPTURED',
  'DEBATE_CREATED',
  'ROUND_CREATED',
  'ROUND_COMPLETED',
  'COORDINATOR_CHECKPOINT_CREATED',
  'OPERATOR_INTERVENTION',
  'DEBATE_CONTINUED',
  'DEBATE_FINISH_REQUESTED',
  'SYNTHESIS_CREATED',
]);

const STREAM_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'Content-Type': 'text/event-stream; charset=utf-8',
};

export function attachEventStream(
  runtime: RayzanRuntime,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  request.socket.setTimeout(0);
  response.writeHead(200, STREAM_HEADERS);
  response.write(': connected\n\n');

  const unsubscribe = runtime.onEvent((event) => {
    if (!STREAM_TYPES.has(event.type)) {
      return;
    }
    writeEvent(response, event);
  });

  const heartbeat = setInterval(() => {
    response.write(': ping\n\n');
  }, 15000);

  const close = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };

  request.on('close', close);
  response.on('close', close);
}

function writeEvent(response: ServerResponse, event: Event): void {
  const data = JSON.stringify({
    id: event.id,
    type: event.type,
    timestamp: event.timestamp.toISOString(),
    ...(event.agentId !== undefined ? { agentId: event.agentId } : {}),
    ...(event.debateId !== undefined ? { debateId: event.debateId } : {}),
  });
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${data}\n\n`);
}
