import { useCallback, useEffect, useState } from 'react';

import {
  changeCoordinator,
  debateTitle,
  fetchDesktopStatus,
  openRuntimeEventStream,
  setWatcherParticipation,
  type RayzanDesktopStatus,
} from './api.js';
import {
  DebateWorkspace,
  type ActiveDecisionLaunch,
} from './components/debate/index.js';
import { DebatesView } from './components/DebatesView.js';
import { DecisionWizard } from './components/decision/DecisionWizard.js';
import { HomeView } from './components/HomeView.js';
import { LibraryView } from './components/LibraryView.js';
import { SettingsView } from './components/SettingsView.js';
import { Sidebar } from './components/Sidebar.js';
import type { DesktopInfo } from './desktop.js';
import type { ProductPage } from './navigation.js';

type Hydration = 'loading' | 'ready' | 'error';

function launchFromStatus(status: RayzanDesktopStatus): ActiveDecisionLaunch {
  const debate = status.activeDebate;
  return {
    question: debate ? debateTitle(debate.topic) : 'Active decision',
    coordinatorName:
      status.team.find((agent) => agent.role === 'coordinator')?.name ??
      'Coordinator',
    watcherNames: status.team
      .filter((agent) => agent.role === 'watcher' && agent.enabled)
      .map((agent) => agent.name),
  };
}

export function App() {
  const [page, setPage] = useState<ProductPage>('home');
  const [info, setInfo] = useState<DesktopInfo | undefined>();
  const [status, setStatus] = useState<RayzanDesktopStatus | undefined>();
  const [hydration, setHydration] = useState<Hydration>('loading');
  const [statusError, setStatusError] = useState<string | undefined>();
  const [liveTick, setLiveTick] = useState(0);
  const [launch, setLaunch] = useState<ActiveDecisionLaunch | undefined>();

  const hydrate = useCallback(async (mode: 'initial' | 'live') => {
    const nextInfo = await window.rayzanDesktop?.getInfo();
    setInfo(nextInfo);
    if (nextInfo?.runtimeError) {
      setStatus(undefined);
      setStatusError(nextInfo.runtimeError);
      setHydration('error');
      return;
    }
    try {
      const nextStatus = await fetchDesktopStatus();
      setStatus(nextStatus);
      setStatusError(undefined);
      setHydration('ready');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'runtime unreachable';
      setStatusError(message);
      if (mode === 'initial') {
        setStatus(undefined);
        setHydration('error');
      }
    }
  }, []);

  useEffect(() => {
    void hydrate('initial');
  }, [hydrate]);

  useEffect(() => {
    if (hydration !== 'ready') {
      return;
    }
    return openRuntimeEventStream(() => {
      void hydrate('live');
      setLiveTick((tick) => tick + 1);
    });
  }, [hydrate, hydration]);

  async function retry() {
    setHydration('loading');
    if (window.rayzanDesktop !== undefined) {
      const nextInfo = await window.rayzanDesktop.retryRuntime();
      setInfo(nextInfo);
    }
    await hydrate('initial');
  }

  const ready = hydration === 'ready' && status !== undefined;

  return (
    <div className="app-shell">
      <Sidebar
        page={page}
        runtimeReady={ready}
        connecting={hydration === 'loading'}
        onNavigate={setPage}
      />
      <div className="workspace">
        <header className="operator-bar">
          <p className="operator-context">Decision intelligence workspace</p>
          <div className="operator-meta">
            <span
              className={
                hydration === 'ready'
                  ? 'ok'
                  : hydration === 'loading'
                    ? ''
                    : 'warn'
              }
            >
              {hydration === 'loading'
                ? 'Loading'
                : hydration === 'ready'
                  ? 'Ready'
                  : 'Not ready'}
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
          {hydration === 'loading' ? (
            <section className="page">
              <h1>Loading Rayzan...</h1>
              <p className="lede">Waiting for a confirmed runtime snapshot.</p>
            </section>
          ) : null}
          {hydration === 'error' ? (
            <section className="page">
              <div className="error-panel">
                <p>{statusError ?? 'Rayzan runtime is unavailable.'}</p>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    void retry();
                  }}
                >
                  Retry
                </button>
              </div>
            </section>
          ) : null}
          {ready && page === 'home' && status !== undefined ? (
            <HomeView
              status={status}
              onNavigate={(next) => {
                if (next === 'active-decision' && status.activeDebate) {
                  setLaunch(launchFromStatus(status));
                  setLiveTick((tick) => tick + 1);
                }
                setPage(next);
              }}
              onChangeCoordinator={async (agentId) => {
                const next = await changeCoordinator(agentId);
                setStatus(next);
              }}
              onSetWatcherParticipation={async (agentId, enabled) => {
                const next = await setWatcherParticipation(agentId, enabled);
                setStatus(next);
              }}
            />
          ) : null}
          {ready && page === 'new-decision' && status !== undefined ? (
            <DecisionWizard
              team={status.team}
              onBackHome={() => {
                setPage('home');
              }}
              onChangeCoordinator={async (agentId) => {
                const next = await changeCoordinator(agentId);
                setStatus(next);
              }}
              onSetWatcherParticipation={async (agentId, enabled) => {
                const next = await setWatcherParticipation(agentId, enabled);
                setStatus(next);
              }}
              onDecisionStarted={(nextLaunch) => {
                setLaunch(nextLaunch);
                setLiveTick((tick) => tick + 1);
                setPage('active-decision');
              }}
            />
          ) : null}
          {ready &&
          page === 'active-decision' &&
          (launch !== undefined || status?.activeDebate) ? (
            <DebateWorkspace
              launch={
                launch ??
                (status !== undefined
                  ? launchFromStatus(status)
                  : {
                      question: 'Active decision',
                      coordinatorName: 'Coordinator',
                      watcherNames: [],
                    })
              }
              liveTick={liveTick}
              onBackHome={() => {
                setLaunch(undefined);
                setLiveTick((tick) => tick + 1);
                void hydrate('live');
                setPage('home');
              }}
            />
          ) : null}
          {ready &&
          page === 'active-decision' &&
          launch === undefined &&
          status?.activeDebate == null ? (
            <section className="page">
              <h1>Active Decision</h1>
              <p className="lede">
                Start a decision from New Decision to open this workspace.
              </p>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  setPage('new-decision');
                }}
              >
                New Decision
              </button>
            </section>
          ) : null}
          {ready && page === 'debates' ? (
            <DebatesView
              debates={status?.debateHistory ?? []}
              activeDebate={status?.activeDebate ?? null}
              onOpenActive={() => {
                if (status?.activeDebate) {
                  setLaunch(launchFromStatus(status));
                  setLiveTick((tick) => tick + 1);
                  setPage('active-decision');
                }
              }}
            />
          ) : null}
          {ready && page === 'library' ? <LibraryView /> : null}
          {ready && page === 'settings' ? (
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
