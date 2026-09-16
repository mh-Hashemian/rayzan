import { bridgeFetch } from '../bridge-http.js';

interface Binding {
  agentId: string;
  role: string;
  name: string;
}

type BindingMap = Record<string, Binding>;

const WAKE_ALARM = 'rayzan-wake-bound-tabs';

async function wakeBoundTabs(): Promise<void> {
  const stored = await chrome.storage.local.get('bindings');
  const bindings = (stored.bindings ?? {}) as BindingMap;
  const tabIds = Object.keys(bindings)
    .map((key) => Number(key))
    .filter((id) => Number.isInteger(id));
  await Promise.all(
    tabIds.map(async (tabId) => {
      try {
        await chrome.tabs.sendMessage(tabId, { type: 'wake-poll' });
      } catch {
        // Tab may not have a content script yet.
      }
    }),
  );
}

void chrome.alarms.create(WAKE_ALARM, { periodInMinutes: 0.05 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === WAKE_ALARM) {
    void wakeBoundTabs();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void (async () => {
    try {
      if (message?.type === 'bridge-get') {
        const data = await bridgeFetch(String(message.path), undefined);
        sendResponse({ ok: true, data });
        return;
      }

      if (message?.type === 'bridge-post') {
        const data = await bridgeFetch(String(message.path), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(message.body ?? {}),
        });
        sendResponse({ ok: true, data });
        return;
      }

      const stored = await chrome.storage.local.get('bindings');
      const bindings = (stored.bindings ?? {}) as BindingMap;

      if (message?.type === 'get-binding') {
        const tabId = sender.tab?.id;
        sendResponse(tabId === undefined ? undefined : bindings[String(tabId)]);
        return;
      }

      if (message?.type === 'adapter-error') {
        await chrome.storage.local.set({ lastAdapterError: message.message });
        sendResponse({ ok: true });
      }
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const stored = await chrome.storage.local.get('bindings');
    const bindings = (stored.bindings ?? {}) as BindingMap;
    const binding = bindings[String(tabId)];
    if (binding === undefined) {
      return;
    }
    delete bindings[String(tabId)];
    await chrome.storage.local.set({ bindings });
    try {
      await bridgeFetch('/api/bindings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: binding.agentId,
          available: false,
          error: 'bound tab closed',
        }),
      });
    } catch {
      // Bridge may already be down.
    }
  })();
});
