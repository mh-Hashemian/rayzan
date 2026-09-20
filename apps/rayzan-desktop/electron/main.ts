import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import net from 'node:net';

import { app, BrowserWindow, ipcMain, Menu } from 'electron';

import './native-sqlite.js';
import {
  createRayzanServer,
  LOCAL_BRIDGE_PORT,
  type RayzanServer,
} from '@rayzan/local';
import {
  ManagedProviderManager,
  type ManagedAttachAgent,
  type ManagedProviderId,
} from './managed-provider/index.js';

const BRIDGE_ORIGIN = `http://127.0.0.1:${LOCAL_BRIDGE_PORT}`;

export interface DesktopInfo {
  readonly userDataPath: string;
  readonly databasePath: string;
  readonly port: number;
  readonly ownsRuntime: boolean;
  readonly runtimeError?: string;
}

let mainWindow: BrowserWindow | undefined;
let debugWindow: BrowserWindow | undefined;
let rayzan: RayzanServer | undefined;
let ownsRuntime = false;
let runtimeError: string | undefined;
let quitting = false;
let managedProviders: ManagedProviderManager | undefined;

function here(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

function databasePath(): string {
  return path.join(app.getPath('userData'), 'rayzan.sqlite');
}

function localPublicDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'local-public');
  }
  return path.join(here(), '../../rayzan-local/public');
}

function appIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'rayzan-app-icon.ico')
    : path.join(here(), '../resources/rayzan-app-icon.ico');
}

function desktopInfo(): DesktopInfo {
  return {
    userDataPath: app.getPath('userData'),
    databasePath: databasePath(),
    port: LOCAL_BRIDGE_PORT,
    ownsRuntime,
    ...(runtimeError !== undefined ? { runtimeError } : {}),
  };
}

function ensureManagedProviders(): ManagedProviderManager {
  if (managedProviders === undefined) {
    managedProviders = new ManagedProviderManager({
      userDataPath: app.getPath('userData'),
      appIcon: appIconPath(),
    });
  }
  return managedProviders;
}

function portOccupied(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => {
      resolve(false);
    });
  });
}

async function probeRayzan(): Promise<boolean> {
  try {
    const response = await fetch(`${BRIDGE_ORIGIN}/api/health`);
    const body = (await response.json()) as { ok?: boolean };
    return response.ok && body.ok === true;
  } catch {
    return false;
  }
}

async function waitUntilReady(timeoutMs = 8000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await probeRayzan()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Rayzan runtime did not become ready');
}

async function startOwnedRuntime(): Promise<void> {
  const next = createRayzanServer({
    host: '127.0.0.1',
    port: LOCAL_BRIDGE_PORT,
    databasePath: databasePath(),
    publicDir: localPublicDir(),
  });
  await next.listen();
  rayzan = next;
  ownsRuntime = true;
  await waitUntilReady();
}

async function ensureRuntime(): Promise<void> {
  runtimeError = undefined;
  if (await probeRayzan()) {
    ownsRuntime = false;
    return;
  }
  if (await portOccupied(LOCAL_BRIDGE_PORT, '127.0.0.1')) {
    runtimeError = `Cannot start: Port ${LOCAL_BRIDGE_PORT} is already in use.`;
    ownsRuntime = false;
    return;
  }
  try {
    await startOwnedRuntime();
  } catch (error) {
    runtimeError = error instanceof Error ? error.message : String(error);
    ownsRuntime = false;
    if (rayzan !== undefined) {
      await rayzan.close().catch(() => undefined);
      rayzan = undefined;
    }
  }
}

function preloadPath(): string {
  const dir = here();
  for (const name of ['preload.cjs', 'preload.js', 'preload.mjs']) {
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return path.join(dir, 'preload.mjs');
}

function createMainWindow(): void {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    title: 'Rayzan',
    icon: appIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  const rawDevUrl =
    process.env.VITE_DEV_SERVER_URL ?? process.env.ELECTRON_RENDERER_URL;
  const devUrl =
    rawDevUrl === undefined
      ? undefined
      : rawDevUrl.replace('://localhost', '://127.0.0.1');
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(path.join(here(), '../dist/index.html'));
  }
  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
}

function openDebugWindow(): void {
  if (runtimeError !== undefined) {
    return;
  }
  if (debugWindow !== undefined) {
    debugWindow.focus();
    return;
  }
  debugWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    title: 'Rayzan Debug',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void debugWindow.loadURL(`${BRIDGE_ORIGIN}/debug`);
  debugWindow.on('closed', () => {
    debugWindow = undefined;
  });
}

async function shutdownRuntime(): Promise<void> {
  if (!ownsRuntime || rayzan === undefined) {
    rayzan = undefined;
    ownsRuntime = false;
    return;
  }
  const current = rayzan;
  rayzan = undefined;
  ownsRuntime = false;
  await current.close();
}

function registerManagedProviderIpc(): void {
  ipcMain.handle('providers:list', async () => {
    return ensureManagedProviders().listProviderStatuses();
  });
  ipcMain.handle('providers:refresh', async () => {
    const manager = ensureManagedProviders();
    if (manager.isRestoring()) {
      return manager.listProviderStatuses();
    }
    return manager.refreshAll();
  });
  ipcMain.handle('providers:restoring', async () => {
    return ensureManagedProviders().isRestoring();
  });
  ipcMain.handle(
    'providers:connect',
    async (_event, providerId: ManagedProviderId) => {
      return ensureManagedProviders().connect(providerId);
    },
  );
  ipcMain.handle(
    'providers:open',
    async (_event, providerId: ManagedProviderId) => {
      await ensureManagedProviders().open(providerId);
    },
  );
  ipcMain.handle(
    'providers:reconnect',
    async (_event, providerId: ManagedProviderId) => {
      return ensureManagedProviders().reconnect(providerId);
    },
  );
  ipcMain.handle(
    'providers:attach-debate',
    async (
      _event,
      payload: {
        readonly debateId: string;
        readonly agents: readonly ManagedAttachAgent[];
      },
    ) => {
      return ensureManagedProviders().attachDebate(payload);
    },
  );
  ipcMain.handle(
    'providers:debate-ownership',
    async (_event, debateId: string) => {
      return ensureManagedProviders().ownershipsForDebate(debateId);
    },
  );
  ipcMain.handle('providers:stop-debate', async (_event, debateId: string) => {
    ensureManagedProviders().stopDebate(debateId);
  });
}

app.whenReady().then(async () => {
  ipcMain.handle('desktop:info', () => desktopInfo());
  ipcMain.handle('desktop:retry', async () => {
    await shutdownRuntime();
    await ensureRuntime();
    return desktopInfo();
  });
  ipcMain.handle('desktop:open-debug', () => {
    openDebugWindow();
  });
  registerManagedProviderIpc();
  await ensureRuntime();
  // Start session restore before the UI mounts so Home/Settings see Restoring.
  ensureManagedProviders();
  createMainWindow();
  void resumeManagedDebateIfAny();
});

async function resumeManagedDebateIfAny(): Promise<void> {
  try {
    const response = await fetch(`${BRIDGE_ORIGIN}/api/status`);
    if (!response.ok) {
      return;
    }
    const status = (await response.json()) as {
      activeDebate?: { id: string } | null;
    };
    const debateId = status.activeDebate?.id;
    if (debateId) {
      ensureManagedProviders().resumeDebate(debateId);
    }
  } catch {
    // Runtime may still be starting.
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (quitting) {
    return;
  }
  managedProviders?.dispose();
  managedProviders = undefined;
  if (!ownsRuntime) {
    return;
  }
  event.preventDefault();
  quitting = true;
  void shutdownRuntime().finally(() => {
    app.exit(0);
  });
});
