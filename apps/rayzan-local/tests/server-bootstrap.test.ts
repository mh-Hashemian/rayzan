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
    assert.equal(status.activeDebate, null);
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
      await fetch(`${base}/api/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'DeepSeek Coordinator',
          role: 'coordinator',
        }),
      });
      const before = (await fetch(`${base}/api/status`).then((response) =>
        response.json(),
      )) as RayzanDesktopStatus;
      assert.equal(before.database, 'connected');
      assert.equal(before.databasePath, first.databasePath);
      assert.equal(before.agents, 1);
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
      assert.equal(afterRestart.agents, 1);
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
