import type {
  AdapterDiagnostics,
  BrowserAdapter,
  CapturedResponse,
  ConversationSnapshot,
  PromptSendResult,
  ResponseWaitContext,
} from './types.js';

export const fixtureAdapter: BrowserAdapter = {
  id: 'fixture',
  providerLabel: 'Rayzan fixture',
  canHandle(url: string): boolean {
    return /\/fixture-chat(?:\?|$)/.test(url);
  },
  snapshotConversation(): ConversationSnapshot {
    const box = document.getElementById('response-text');
    const filled =
      box instanceof HTMLTextAreaElement && box.value.trim().length > 0;
    return { assistantTurnCount: filled ? 1 : 0 };
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
  async waitForResponse(
    context: ResponseWaitContext,
  ): Promise<CapturedResponse> {
    const started = Date.now();
    const timeoutMs = context.timeoutMs ?? 5000;
    while (Date.now() - started < timeoutMs) {
      const box = document.getElementById('response-text');
      const text = box instanceof HTMLTextAreaElement ? box.value.trim() : '';
      if (text.length > 0) {
        return { text };
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('fixture response box stayed empty');
  },
  async captureLatestResponse(): Promise<string> {
    const box = document.getElementById('response-text');
    if (!(box instanceof HTMLTextAreaElement)) {
      throw new Error('fixture chat response box is missing');
    }
    const text = box.value.trim();
    if (text.length === 0) {
      throw new Error('fixture response box is empty');
    }
    return text;
  },
  diagnostics(): AdapterDiagnostics {
    return {
      provider: 'Rayzan fixture',
      inputFound: document.getElementById('incoming-prompt') !== null,
      sendFound: true,
      assistantTurns: this.snapshotConversation().assistantTurnCount,
      generating: false,
    };
  },
};
