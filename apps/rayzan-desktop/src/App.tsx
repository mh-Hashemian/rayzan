import { useCallback, useEffect, useState } from 'react';

import { fetchDesktopStatus, type RayzanDesktopStatus } from './api.js';
import type { DesktopInfo } from './desktop.js';
import { HomeScreen } from './HomeScreen.js';

export function App() {
  const [info, setInfo] = useState<DesktopInfo | undefined>();
  const [status, setStatus] = useState<RayzanDesktopStatus | undefined>();
  const [statusError, setStatusError] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    const nextInfo = await window.rayzanDesktop.getInfo();
    setInfo(nextInfo);
    if (nextInfo.runtimeError) {
      setStatus(undefined);
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
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function retry() {
    const nextInfo = await window.rayzanDesktop.retryRuntime();
    setInfo(nextInfo);
    await refresh();
  }

  return (
    <HomeScreen
      info={info}
      status={status}
      error={statusError}
      onRetry={() => {
        void retry();
      }}
      onOpenWorkspace={() => {
        void window.rayzanDesktop.openDebug();
      }}
    />
  );
}
