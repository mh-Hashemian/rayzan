import { useCallback, useEffect, useState } from 'react';

import type {
  ManagedProviderId,
  ProviderConnectionStatus,
  ProviderStatus,
} from '../../desktop.js';
import { ProviderLogo } from '../providers/ProviderLogo.js';

function statusLabel(status: ProviderConnectionStatus): string {
  switch (status) {
    case 'connected':
      return 'Connected';
    case 'connecting':
      return 'Connecting…';
    case 'restoring':
      return 'Restoring session…';
    case 'needs_attention':
      return 'Needs attention';
    default:
      return 'Not connected';
  }
}

export function AiProvidersPanel() {
  const [providers, setProviders] = useState<readonly ProviderStatus[]>([]);
  const [busyId, setBusyId] = useState<ManagedProviderId | undefined>();
  const [error, setError] = useState<string | undefined>();
  const available = window.rayzanDesktop?.listProviders !== undefined;

  const refresh = useCallback(async () => {
    if (window.rayzanDesktop?.refreshProviders === undefined) {
      setProviders([]);
      return;
    }
    try {
      const next = await window.rayzanDesktop.refreshProviders();
      setProviders(next);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Poll quickly so Connect → Connected flips without a second Connect click.
    const timer = setInterval(() => {
      void refresh();
    }, 1500);
    return () => clearInterval(timer);
  }, [refresh]);

  async function connect(id: ManagedProviderId) {
    setBusyId(id);
    setError(undefined);
    try {
      await window.rayzanDesktop?.connectProvider?.(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(undefined);
    }
  }

  async function open(id: ManagedProviderId) {
    setError(undefined);
    try {
      await window.rayzanDesktop?.openProvider?.(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function reconnect(id: ManagedProviderId) {
    setBusyId(id);
    setError(undefined);
    try {
      await window.rayzanDesktop?.reconnectProvider?.(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(undefined);
    }
  }

  if (!available) {
    return (
      <section className="ai-providers">
        <h2>AI Providers</h2>
        <p className="lede">
          Managed provider sessions require the Rayzan Desktop app.
        </p>
      </section>
    );
  }

  return (
    <section className="ai-providers">
      <h2>AI Providers</h2>
      <p className="lede">
        Connect your AI services once. Rayzan restores saved sessions on launch
        and creates a fresh conversation for each new Decision.
      </p>
      {providers.some((provider) => provider.status === 'restoring') ? (
        <p className="provider-restore-banner" role="status">
          Restoring saved AI sessions…
        </p>
      ) : null}
      {error ? <p className="provider-error">{error}</p> : null}
      <ul className="provider-list">
        {providers.map((provider) => (
          <li key={provider.id} className="provider-row">
            <div className="provider-identity">
              <ProviderLogo name={provider.label} size={28} />
              <div>
                <strong>{provider.label}</strong>
                <p
                  className={`provider-status status-${provider.status}`}
                >
                  <span className="provider-dot" aria-hidden="true" />
                  {statusLabel(provider.status)}
                  {provider.detail ? ` — ${provider.detail}` : ''}
                </p>
              </div>
            </div>
            <div className="provider-actions">
              {provider.status === 'connected' ? (
                <>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void open(provider.id)}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busyId === provider.id}
                    onClick={() => void reconnect(provider.id)}
                  >
                    Reconnect
                  </button>
                </>
              ) : provider.status === 'connecting' ||
                provider.status === 'restoring' ? (
                <>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void open(provider.id)}
                  >
                    Open window
                  </button>
                  <button
                    type="button"
                    className="btn primary"
                    disabled
                  >
                    {provider.status === 'restoring'
                      ? 'Restoring…'
                      : 'Waiting for sign-in…'}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn primary"
                  disabled={busyId === provider.id}
                  onClick={() => void connect(provider.id)}
                >
                  {busyId === provider.id ? 'Connecting…' : 'Connect'}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
