import type { RayzanDesktopStatus } from './api.js';
import type { DesktopInfo } from './desktop.js';

function mark(ok: boolean): string {
  return ok ? '●' : '○';
}

function recoveryLabel(status: RayzanDesktopStatus | undefined): string {
  if (status === undefined) {
    return 'Unavailable';
  }
  if (status.recovery.replayStatus === 'RESTORED_WITH_WARNINGS') {
    return 'Restored with warnings';
  }
  if (status.recovery.status === 'fresh') {
    return 'Fresh';
  }
  if (status.recovery.status === 'failed') {
    return 'Failed';
  }
  return 'Restored';
}

export function HomeScreen(input: {
  readonly info?: DesktopInfo;
  readonly status?: RayzanDesktopStatus;
  readonly error?: string;
  readonly onRetry: () => void;
  readonly onOpenWorkspace: () => void;
}) {
  const ready = input.status !== undefined && input.error === undefined;
  const portBusy = input.error?.includes('already in use') === true;

  return (
    <main className="shell">
      <header className="top">
        <h1>RAYZAN</h1>
        <p className={ready ? 'ok' : 'warn'}>
          {mark(ready)} {ready ? 'Ready' : 'Not ready'}
        </p>
      </header>

      <section>
        <h2>Welcome to Rayzan</h2>
        <p className="lede">
          Desktop foundation. The existing Rayzan runtime, SQLite event log, and
          browser-extension bridge run behind this window.
        </p>
      </section>

      {portBusy ? (
        <section className="error-panel">
          <h2>Rayzan Runtime</h2>
          <p>{input.error}</p>
          <button type="button" onClick={input.onRetry}>
            Retry
          </button>
        </section>
      ) : null}

      {input.error && !portBusy ? (
        <section className="error-panel">
          <p>{input.error}</p>
          <button type="button" onClick={input.onRetry}>
            Retry
          </button>
        </section>
      ) : null}

      <section>
        <h2>System</h2>
        <ul className="status-list">
          <li>
            Runtime{' '}
            <strong>
              {mark(ready)} {ready ? 'Running' : 'Stopped'}
            </strong>
          </li>
          <li>
            Database{' '}
            <strong>
              {mark(input.status?.database === 'connected')}{' '}
              {input.status?.database === 'connected'
                ? 'Connected'
                : input.status?.database === 'memory'
                  ? 'Memory'
                  : 'Unavailable'}
            </strong>
          </li>
          <li>
            Recovery{' '}
            <strong>
              {mark(ready)} {recoveryLabel(input.status)}
            </strong>
          </li>
          <li>
            Browser Bridge{' '}
            <strong>
              {mark(input.status?.browserBridge === 'ready')}{' '}
              {input.status?.browserBridge === 'ready' ? 'Ready' : 'Unavailable'}
            </strong>
          </li>
        </ul>
      </section>

      <section>
        <h2>Agents</h2>
        <p>
          {input.status ? `${input.status.agents} restored` : 'Unavailable'}
        </p>
      </section>

      <section>
        <h2>Current Debate</h2>
        <p>
          {input.status?.activeDebate
            ? `${input.status.activeDebate.topic} — ${input.status.activeDebate.status}`
            : 'None'}
        </p>
      </section>

      <section>
        <h2>Previous Debates</h2>
        <p>
          {input.status
            ? String(input.status.debateHistory.length)
            : 'Unavailable'}
        </p>
      </section>

      <section className="actions">
        <button
          type="button"
          onClick={input.onOpenWorkspace}
          disabled={!ready}
        >
          Open Workspace
        </button>
      </section>

      <section className="debug-meta">
        <h2>System information</h2>
        <p>User data: {input.info?.userDataPath ?? '…'}</p>
        <p>SQLite: {input.status?.databasePath ?? input.info?.databasePath ?? '…'}</p>
        <p>Bridge: http://127.0.0.1:{input.info?.port ?? 8787}</p>
        <p>Debug UI: /debug</p>
      </section>
    </main>
  );
}
