import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';

import { createRayzanServer, startRayzanLocal } from '../src/server.js';
import type { RayzanDesktopStatus } from '../src/status.js';

describe('desktop status API', () => {
  const { server } = startRayzanLocal(0);
  const started = new Promise<string>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });

  after(() => {
    server.close();
  });

  it('reports ready runtime state for the product shell', async () => {
    const base = await started;
    const status = (await fetch(`${base}/api/status`).then((response) =>
      response.json(),
    )) as RayzanDesktopStatus;
    assert.equal(status.runtime, 'ready');
    assert.equal(status.database, 'memory');
    assert.equal(status.browserBridge, 'ready');
    assert.equal(status.recovery.status, 'fresh');
    assert.equal(status.agents, 0);
    assert.deepEqual(status.team, []);
    assert.equal(status.activeDebate, null);
    assert.deepEqual(status.debateHistory, []);
  });
});

describe('createRayzanServer default team', () => {
  it('seeds fixed providers with distinct product names', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rayzan-default-team-'));
    const filePath = path.join(dir, 'rayzan.sqlite');
    try {
      const app = createRayzanServer({
        host: '127.0.0.1',
        port: 0,
        databasePath: filePath,
      });
      await app.listen();
      const address = app.server.address() as AddressInfo;
      const status = (await fetch(
        `http://127.0.0.1:${address.port}/api/status`,
      ).then((response) => response.json())) as RayzanDesktopStatus;
      assert.equal(status.agents, 5);
      assert.deepEqual(
        status.team.map((agent) => ({
          id: agent.id,
          name: agent.name,
          role: agent.role,
          provider: agent.provider,
        })),
        [
          {
            id: 'deepseek',
            name: 'DeepSeek',
            role: 'coordinator',
            provider: 'DeepSeek',
          },
          {
            id: 'chatgpt',
            name: 'ChatGPT',
            role: 'watcher',
            provider: 'OpenAI',
          },
          {
            id: 'qwen',
            name: 'Qwen',
            role: 'watcher',
            provider: 'Alibaba Cloud',
          },
          {
            id: 'glm',
            name: 'GLM',
            role: 'watcher',
            provider: 'Zhipu AI',
          },
          {
            id: 'grok',
            name: 'Grok',
            role: 'watcher',
            provider: 'xAI',
          },
        ],
      );
      await app.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('createRayzanServer bootstrap', () => {
  it('opens an explicit SQLite path, restores after close, and shuts down cleanly', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rayzan-desktop-boot-'));
    const filePath = path.join(dir, 'rayzan.sqlite');
    try {
      const first = createRayzanServer({
        host: '127.0.0.1',
        port: 0,
        databasePath: filePath,
      });
      await first.listen();
      const address = first.server.address() as AddressInfo;
      const base = `http://127.0.0.1:${address.port}`;
      const before = (await fetch(`${base}/api/status`).then((response) =>
        response.json(),
      )) as RayzanDesktopStatus;
      assert.equal(before.database, 'connected');
      assert.equal(before.databasePath, first.databasePath);
      assert.equal(before.agents, 5);
      assert.equal(before.team.length, 5);
      assert.equal(
        before.team.filter((agent) => agent.role === 'coordinator').length,
        1,
      );
      assert.equal(
        before.team.find((agent) => agent.id === 'chatgpt')?.provider,
        'OpenAI',
      );
      const debug = await fetch(`${base}/debug`);
      assert.equal(debug.status, 200);
      await first.close();

      const second = createRayzanServer({
        host: '127.0.0.1',
        port: 0,
        databasePath: filePath,
      });
      await second.listen();
      const secondAddress = second.server.address() as AddressInfo;
      const afterRestart = (await fetch(
        `http://127.0.0.1:${secondAddress.port}/api/status`,
      ).then((response) => response.json())) as RayzanDesktopStatus;
      assert.equal(afterRestart.recovery.status, 'restored');
      assert.equal(afterRestart.agents, 5);
      assert.equal(
        afterRestart.team.find((agent) => agent.id === 'qwen')?.provider,
        'Alibaba Cloud',
      );
      assert.ok((afterRestart.recovery.eventsRead ?? 0) >= 1);
      await second.close();
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows can keep a short lock on the WAL file after close.
      }
    }
  });

  it('fails listen when the requested port is already bound', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => {
      blocker.listen(0, '127.0.0.1', () => resolve());
    });
    const address = blocker.address() as AddressInfo;
    const dir = mkdtempSync(path.join(tmpdir(), 'rayzan-port-'));
    const filePath = path.join(dir, 'rayzan.sqlite');
    const app = createRayzanServer({
      host: '127.0.0.1',
      port: address.port,
      databasePath: filePath,
    });
    try {
      await assert.rejects(() => app.listen(), /EADDRINUSE/);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
      await app.close().catch(() => undefined);
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });
});
