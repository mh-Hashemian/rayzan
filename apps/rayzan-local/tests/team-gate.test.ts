import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';

import { withAgentRole } from '@rayzan/protocol';

import { createRayzanServer, type RayzanServer } from '../src/server.js';
import type { RayzanDesktopStatus } from '../src/status.js';

const WATCHERS = ['chatgpt', 'qwen', 'glm', 'grok'] as const;

async function startServer(): Promise<{
  app: RayzanServer;
  base: string;
  dir: string;
}> {
  const dir = mkdtempSync(path.join(tmpdir(), 'rayzan-team-gate-'));
  const app = createRayzanServer({
    host: '127.0.0.1',
    port: 0,
    databasePath: path.join(dir, 'rayzan.sqlite'),
  });
  await app.listen();
  const address = app.server.address() as AddressInfo;
  return { app, base: `http://127.0.0.1:${address.port}`, dir };
}

async function stop(server: { app: RayzanServer; dir: string }): Promise<void> {
  await server.app.close();
  rmSync(server.dir, { recursive: true, force: true });
}

async function post(
  base: string,
  route: string,
  body: Record<string, unknown> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

async function status(base: string): Promise<RayzanDesktopStatus> {
  const response = await fetch(`${base}/api/status`);
  return (await response.json()) as RayzanDesktopStatus;
}

describe('start-debate team gate', () => {
  it('rejects a direct API start while provider-managed agents are unbound', async () => {
    const server = await startServer();
    try {
      const rejected = await post(server.base, '/api/session/run-live-round', {
        problem: 'Ship the installer this week?',
      });
      assert.equal(rejected.status, 400);
      assert.match(String(rejected.body.error), /not connected/);
      assert.equal((await status(server.base)).activeDebate, null);
    } finally {
      await stop(server);
    }
  });

  it('rejects a start whose only unbound participant is an enabled Watcher', async () => {
    const server = await startServer();
    try {
      const { runtime } = server.app;
      runtime.noteBinding({ agentId: 'deepseek', available: true });
      runtime.noteBinding({ agentId: 'chatgpt', available: true });
      runtime.noteBinding({ agentId: 'qwen', available: true });
      runtime.noteBinding({ agentId: 'glm', available: true });
      // Grok stays unbound but remains an enabled Watcher.
      const rejected = await post(server.base, '/api/session/run-live-round', {
        problem: 'Ship the installer this week?',
      });
      assert.equal(rejected.status, 400);
      assert.match(String(rejected.body.error), /Grok is not connected/);
      assert.equal((await status(server.base)).activeDebate, null);
    } finally {
      await stop(server);
    }
  });

  it('accepts a fully bound team and starts with exactly the enabled Watchers', async () => {
    const server = await startServer();
    try {
      const { runtime } = server.app;
      runtime.noteBinding({ agentId: 'deepseek', available: true });
      runtime.noteBinding({ agentId: 'chatgpt', available: true });
      runtime.noteBinding({ agentId: 'qwen', available: true });
      runtime.setWatcherParticipation('glm', false);
      runtime.setWatcherParticipation('grok', false);

      const started = await post(server.base, '/api/session/run-live-round', {
        problem: 'Ship the installer this week?',
      });
      assert.equal(started.status, 200);
      const after = await status(server.base);
      assert.equal(after.activeDebate?.topic, 'Ship the installer this week?');
      const round1 = started.body.round1 as { id: string } | undefined;
      assert.ok(round1);
      assert.deepEqual(
        [...runtime.workflow.getParticipantIds(round1.id)].sort(),
        ['chatgpt', 'qwen'],
      );
    } finally {
      await stop(server);
    }
  });

  it('rejects a start when the Coordinator disconnects mid-wizard', async () => {
    const server = await startServer();
    try {
      const { runtime } = server.app;
      runtime.noteBinding({ agentId: 'deepseek', available: true });
      runtime.noteBinding({ agentId: 'chatgpt', available: true });
      for (const id of WATCHERS.slice(1)) {
        runtime.setWatcherParticipation(id, false);
      }
      runtime.noteBinding({ agentId: 'deepseek', available: false });
      const rejected = await post(server.base, '/api/session/run-live-round', {
        problem: 'Ship the installer this week?',
      });
      assert.equal(rejected.status, 400);
      assert.match(String(rejected.body.error), /DeepSeek is not connected/);
    } finally {
      await stop(server);
    }
  });

  it('rejects zero Coordinators and multiple Coordinators', async () => {
    const server = await startServer();
    try {
      const { runtime } = server.app;
      runtime.noteBinding({ agentId: 'deepseek', available: true });
      runtime.noteBinding({ agentId: 'chatgpt', available: true });
      for (const id of WATCHERS.slice(1)) {
        runtime.setWatcherParticipation(id, false);
      }

      runtime.registerAgent('Second Lead', 'coordinator');
      const multiple = await post(server.base, '/api/session/run-live-round', {
        problem: 'Ship the installer this week?',
      });
      assert.equal(multiple.status, 400);
      assert.match(
        String(multiple.body.error),
        /register exactly one Coordinator/,
      );

      for (const agent of runtime.agents.list()) {
        if (agent.role === 'coordinator') {
          runtime.agents.replace(withAgentRole(agent, 'watcher'));
        }
      }
      const none = await post(server.base, '/api/session/run-live-round', {
        problem: 'Ship the installer this week?',
      });
      assert.equal(none.status, 400);
      assert.match(
        String(none.body.error),
        /register exactly one Coordinator/,
      );
      assert.equal((await status(server.base)).activeDebate, null);
    } finally {
      await stop(server);
    }
  });

  it('rejects a start with zero included Watchers', async () => {
    const server = await startServer();
    try {
      const { runtime } = server.app;
      runtime.noteBinding({ agentId: 'deepseek', available: true });
      runtime.noteBinding({ agentId: 'chatgpt', available: true });
      for (const id of WATCHERS) {
        runtime.setWatcherParticipation(id, false);
      }
      const rejected = await post(server.base, '/api/session/run-live-round', {
        problem: 'Ship the installer this week?',
      });
      assert.equal(rejected.status, 400);
      assert.match(
        String(rejected.body.error),
        /include at least one Watcher/,
      );
      assert.equal((await status(server.base)).activeDebate, null);
    } finally {
      await stop(server);
    }
  });

  it('does not re-gate a resume of an already active debate', async () => {
    const server = await startServer();
    try {
      const { runtime } = server.app;
      runtime.noteBinding({ agentId: 'deepseek', available: true });
      runtime.noteBinding({ agentId: 'chatgpt', available: true });
      for (const id of WATCHERS.slice(1)) {
        runtime.setWatcherParticipation(id, false);
      }
      const started = await post(server.base, '/api/session/run-live-round', {
        problem: 'Ship the installer this week?',
      });
      assert.equal(started.status, 200);
      // Bindings drop after the debate exists; the runtime's own resume guards
      // stay in charge rather than the start gate.
      runtime.noteBinding({ agentId: 'deepseek', available: false });
      const resumed = await post(server.base, '/api/session/run-live-round', {
        problem: 'Ship the installer this week?',
      });
      assert.equal(resumed.status, 400);
      assert.match(String(resumed.body.error), /active debate already exists/);
    } finally {
      await stop(server);
    }
  });
});
