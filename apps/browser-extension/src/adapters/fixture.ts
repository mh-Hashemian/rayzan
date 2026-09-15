import type {
  AdapterDiagnostics,
  BrowserAdapter,
  ConversationSnapshot,
  PromptSendResult,
} from './types.js';
import type { AssistantTurn } from '../capture/types.js';
import { liveSnapshotFromTurns } from '../capture/turns.js';

function responseBox(): HTMLTextAreaElement | undefined {
  const box = document.getElementById('response-text');
  return box instanceof HTMLTextAreaElement ? box : undefined;
}

function fixtureTurns(): AssistantTurn[] {
  const box = responseBox();
  if (box === undefined) {
    return [];
  }
  const text = box.value.trim();
  if (text.length === 0) {
    return [];
  }
  return [
    {
      element: box,
      identity: 'fixture-response',
      thinkingOnly: false,
      hasFinalAnswer: true,
      finalText: text,
    },
  ];
}

function conversationFromLive(
  live: ReturnType<typeof liveSnapshotFromTurns>,
): ConversationSnapshot {
  return {
    assistantTurnCount: live.assistantTurnCount,
    lastAssistantText: live.lastAssistantText,
    identities: live.identities,
    lastIncomplete: live.lastIncomplete,
  };
}

export const fixtureAdapter: BrowserAdapter = {
  id: 'fixture',
  providerLabel: 'Rayzan fixture',
  canHandle(url: string): boolean {
    return /\/fixture-chat(?:\?|$)/.test(url);
  },
  listAssistantTurns(): readonly AssistantTurn[] {
    return fixtureTurns();
  },
  isGenerating(): boolean {
    return false;
  },
  snapshotLive() {
    return liveSnapshotFromTurns(fixtureTurns());
  },
  snapshotConversation(): ConversationSnapshot {
    return conversationFromLive(this.snapshotLive());
  },
  async sendPrompt(text: string): Promise<PromptSendResult> {
    const snapshot = this.snapshotConversation();
    const prompt = document.getElementById('incoming-prompt');
    if (!prompt) {
      throw new Error('fixture chat prompt element is missing');
    }
    prompt.textContent = text;
    window.dispatchEvent(
      new CustomEvent('rayzan-fixture-prompt', { detail: { text } }),
    );
    return { snapshot };
  },
  async captureLatestResponse(): Promise<string> {
    const last = fixtureTurns()[0];
    if (!last || last.finalText.length === 0) {
      throw new Error('fixture response box is empty');
    }
    return last.finalText;
  },
  diagnostics(): AdapterDiagnostics {
    const turns = fixtureTurns();
    return {
      provider: 'Rayzan fixture',
      inputFound: document.getElementById('incoming-prompt') !== null,
      sendFound: true,
      assistantTurns: turns.length,
      generating: false,
    };
  },
};
