import { adapterFor } from '../adapters/index.js';
import { bridgeGet, bridgePost, type AgentSummary } from '../bridge-client.js';

const errorEl = document.getElementById('error');
const bridgeEl = document.getElementById('bridge');
const pageEl = document.getElementById('page');
const currentBindingEl = document.getElementById('current-binding');
const agentSelect = document.getElementById('agent') as HTMLSelectElement;
const bindPanel = document.getElementById('bind-panel');
const boundPanel = document.getElementById('bound-panel');
const bindingEl = document.getElementById('binding');
const statusEl = document.getElementById('status');

async function currentTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !tab.url) {
    throw new Error('no active tab');
  }
  return tab;
}

function providerFor(url: string): string {
  try {
    return adapterFor(url).providerLabel;
  } catch {
    return 'unsupported page';
  }
}

async function refresh(): Promise<void> {
  if (errorEl) {
    errorEl.textContent = '';
  }
  try {
    const tab = await currentTab();
    const providerLabel = providerFor(tab.url ?? '');
    if (pageEl) {
      pageEl.textContent = `Detected Provider\n${providerLabel}`;
    }

    const agents = await bridgeGet<AgentSummary[]>('/api/agents');
    if (bridgeEl) {
      bridgeEl.textContent = 'Local Bridge\nConnected ✓';
    }
    agentSelect.replaceChildren();
    for (const agent of agents.filter((item) => item.role !== 'operator')) {
      const option = document.createElement('option');
      option.value = agent.id;
      option.textContent = `${agent.name} — ${agent.role}`;
      agentSelect.append(option);
    }

    const stored = await chrome.storage.local.get([
      'bindings',
      'lastAdapterError',
    ]);
    const bindings = (stored.bindings ?? {}) as Record<
      string,
      { agentId: string; role: string; name: string }
    >;
    const binding = bindings[String(tab.id)];
    if (currentBindingEl) {
      currentBindingEl.textContent = binding
        ? `Current Binding\n${binding.name}`
        : 'Current Binding\nNot bound';
    }
    if (binding) {
      bindPanel?.setAttribute('hidden', '');
      boundPanel?.removeAttribute('hidden');
      if (bindingEl) {
        bindingEl.textContent = `Bound to\n${binding.name} — ${binding.role}`;
      }
      if (statusEl) {
        statusEl.textContent = stored.lastAdapterError
          ? `Status:\n${String(stored.lastAdapterError)}`
          : 'Status:\nWaiting for Rayzan delivery';
      }
    } else {
      boundPanel?.setAttribute('hidden', '');
      bindPanel?.removeAttribute('hidden');
    }
    if (stored.lastAdapterError && errorEl) {
      errorEl.textContent = String(stored.lastAdapterError);
    }
  } catch (error) {
    if (bridgeEl) {
      bridgeEl.textContent = 'Local Bridge: Disconnected';
    }
    if (errorEl) {
      errorEl.textContent =
        error instanceof Error ? error.message : String(error);
    }
  }
}

document.getElementById('bind')?.addEventListener('click', () => {
  void (async () => {
    const tab = await currentTab();
    const option = agentSelect.selectedOptions[0];
    if (!option || tab.id === undefined) {
      throw new Error(
        'no Agent selected; register Agents on the dashboard first',
      );
    }
    const label = option.textContent ?? '';
    const role = /—\s*(\S+)\s*$/.exec(label)?.[1] ?? '';
    const name = label.replace(/\s*—\s*\S+\s*$/, '');
    const stored = await chrome.storage.local.get('bindings');
    const bindings = {
      ...((stored.bindings ?? {}) as Record<string, unknown>),
      [String(tab.id)]: {
        agentId: option.value,
        name,
        role,
      },
    };
    await chrome.storage.local.set({ bindings, lastAdapterError: '' });
    await bridgePost('/api/bindings', {
      agentId: option.value,
      provider: providerFor(tab.url ?? ''),
      tabId: String(tab.id),
      available: true,
    });
    await refresh();
  })().catch((error: unknown) => {
    if (errorEl) {
      errorEl.textContent =
        error instanceof Error ? error.message : String(error);
    }
  });
});

document.getElementById('unbind')?.addEventListener('click', () => {
  void (async () => {
    const tab = await currentTab();
    const stored = await chrome.storage.local.get('bindings');
    const bindings = {
      ...((stored.bindings ?? {}) as Record<string, unknown>),
    };
    const existing = bindings[String(tab.id)] as
      { agentId: string } | undefined;
    delete bindings[String(tab.id)];
    await chrome.storage.local.set({ bindings });
    if (existing) {
      await bridgePost('/api/bindings', {
        agentId: existing.agentId,
        available: false,
        error: 'tab unbound',
      });
    }
    await refresh();
  })();
});

document.getElementById('retry-capture')?.addEventListener('click', () => {
  void sendToTab('retry-capture');
});
document.getElementById('manual-capture')?.addEventListener('click', () => {
  void sendToTab('manual-capture');
});

async function sendToTab(
  type: 'retry-capture' | 'manual-capture',
): Promise<void> {
  try {
    const tab = await currentTab();
    if (tab.id === undefined) {
      throw new Error('no active tab');
    }
    const result = (await chrome.tabs.sendMessage(tab.id, { type })) as
      { ok?: boolean; error?: string } | undefined;
    if (result?.ok === false) {
      throw new Error(result.error ?? type);
    }
    await refresh();
  } catch (error) {
    if (errorEl) {
      errorEl.textContent =
        error instanceof Error ? error.message : String(error);
    }
  }
}

void refresh();
