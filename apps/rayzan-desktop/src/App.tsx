import { useCallback, useEffect, useState } from 'react';

import {
  fetchDesktopStatus,
  fetchRegisteredAgents,
  fetchRuntimeState,
  type AgentView,
  type RayzanDesktopStatus,
} from './api.js';
import { DebatesView } from './components/DebatesView.js';
import { DecisionWizard } from './components/DecisionWizard.js';
import { HomeView } from './components/HomeView.js';
import { LibraryView } from './components/LibraryView.js';
import { SettingsView } from './components/SettingsView.js';
import { Sidebar } from './components/Sidebar.js';
import type { DesktopInfo } from './desktop.js';
import type { ProductPage } from './navigation.js';

export function App() {
  const [page, setPage] = useState<ProductPage>('home');
  const [info, setInfo] = useState<DesktopInfo | undefined>();
  const [status, setStatus] = useState<RayzanDesktopStatus | undefined>();
  const [agents, setAgents] = useState<readonly AgentView[]>([]);
  const [statusError, setStatusError] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    const nextInfo = await window.rayzanDesktop?.getInfo();
    setInfo(nextInfo);
    if (nextInfo?.runtimeError) {
      setStatus(undefined);
      setAgents([]);
      setStatusError(nextInfo.runtimeError);
      return;
    }
    try {
      const nextStatus = await fetchDesktopStatus();
      setStatus(nextStatus);
      setStatusError(undefined);
    } catch (error) {
      setStatus(undefined);
      setStatusError(
        error instanceof Error ? error.message : 'runtime unreachable',
      );
    }
    try {
      const listed = await fetchRegisteredAgents();
      setAgents(listed);
    } catch {
      // Keep the last successful team list.
    }
    try {
      const nextState = await fetchRuntimeState();
      setAgents(nextState.agents);
    } catch {
      // /api/state can be large; team cards already came from /api/agents.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function retry() {
    if (window.rayzanDesktop !== undefined) {
      const nextInfo = await window.rayzanDesktop.retryRuntime();
      setInfo(nextInfo);
    }
    await refresh();
  }

  const ready = status !== undefined && statusError === undefined;

  return (
    <div className="app-shell">
      <Sidebar
        page={page}
        runtimeReady={ready}
        onNavigate={setPage}
      />
      <div className="workspace">
        <header className="operator-bar">
          <p className="operator-context">Decision intelligence workspace</p>
          <div className="operator-meta">
            <span className={ready ? 'ok' : 'warn'}>
              {ready ? 'Ready' : 'Not ready'}
            </span>
            <span className="operator-chip">Operator</span>
            <button
              type="button"
              className="icon-btn"
              aria-label="Settings"
              onClick={() => {
                setPage('settings');
              }}
            >
              ⚙
            </button>
          </div>
        </header>
        <main className="workspace-main">
          {page === 'home' ? (
            <HomeView
              ready={ready}
              error={statusError}
              status={status}
              agents={agents}
              debates={status?.debateHistory ?? []}
              onNavigate={setPage}
              onRetry={() => {
                void retry();
              }}
            />
          ) : null}
          {page === 'new-decision' ? <DecisionWizard /> : null}
          {page === 'debates' ? (
            <DebatesView debates={status?.debateHistory ?? []} />
          ) : null}
          {page === 'library' ? <LibraryView /> : null}
          {page === 'settings' ? (
            <SettingsView
              ready={ready}
              info={info}
              status={status}
              error={statusError}
              onRetry={() => {
                void retry();
              }}
              onOpenDebug={() => {
                void window.rayzanDesktop?.openDebug();
              }}
            />
          ) : null}
        </main>
      </div>
    </div>
  );
}
