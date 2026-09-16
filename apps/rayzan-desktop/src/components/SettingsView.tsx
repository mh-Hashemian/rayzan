import type { DesktopInfo } from '../desktop.js';
import type { RayzanDesktopStatus } from '../api.js';

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

export function SettingsView(input: {
  readonly ready: boolean;
  readonly info?: DesktopInfo;
  readonly status?: RayzanDesktopStatus;
  readonly error?: string;
  readonly onRetry: () => void;
  readonly onOpenDebug: () => void;
}) {
  return (
    <section className="page">
      <h1>Settings</h1>
      <p className="lede">
        Runtime, database, and the engineering debug dashboard stay here — not
        on the home screen.
      </p>

      {input.error ? (
        <div className="error-panel">
          <p>{input.error}</p>
          <button type="button" className="btn" onClick={input.onRetry}>
            Retry
          </button>
        </div>
      ) : null}

      <ul className="status-list">
        <li>
          Runtime
          <strong>{input.ready ? 'Running' : 'Stopped'}</strong>
        </li>
        <li>
          Database
          <strong>
            {input.status?.database === 'connected'
              ? 'Connected'
              : input.status?.database === 'memory'
                ? 'Memory'
                : 'Unavailable'}
          </strong>
        </li>
        <li>
          Recovery
          <strong>{recoveryLabel(input.status)}</strong>
        </li>
        <li>
          Browser Bridge
          <strong>
            {input.status?.browserBridge === 'ready' ? 'Ready' : 'Unavailable'}
          </strong>
        </li>
      </ul>

      <div className="debug-meta">
        <p>User data: {input.info?.userDataPath ?? '…'}</p>
        <p>
          SQLite:{' '}
          {input.status?.databasePath ?? input.info?.databasePath ?? '…'}
        </p>
        <p>Bridge: http://127.0.0.1:{input.info?.port ?? 8787}</p>
        <p>Debug UI: /debug</p>
      </div>

      <button
        type="button"
        className="btn primary"
        onClick={input.onOpenDebug}
        disabled={!input.ready}
      >
        Open debug workspace
      </button>
    </section>
  );
}
