import {
  DEFAULT_RESPONSE_TIMEOUT_MS,
  setComposerValue,
  trackedTurn,
  visibleText,
  waitForStableText,
  waitUntil,
} from './observe.js';
import type {
  AdapterDiagnostics,
  BrowserAdapter,
  CapturedResponse,
  ConversationSnapshot,
  PromptSendResult,
  ResponseWaitContext,
} from './types.js';

export function qwenAssistantTurns(root: ParentNode = document): Element[] {
  return Array.from(root.querySelectorAll('.qwen-chat-message-assistant'));
}

export function qwenIsGenerating(root: ParentNode = document): boolean {
  return (
    root.querySelector(
      '.stop-button, button[aria-label="Stop"], button[aria-label*="Stop" i]',
    ) !== null
  );
}

export function qwenExtract(turn: Element | undefined): string {
  if (turn === undefined) {
    return '';
  }
  const answer = turn.querySelector('.response-message-content.phase-answer');
  return visibleText(answer ?? turn);
}

function input(): HTMLTextAreaElement | undefined {
  const element = document.querySelector('textarea.message-input-textarea');
  return element instanceof HTMLTextAreaElement ? element : undefined;
}

function sendButton(): HTMLElement | undefined {
  const send = document.querySelector(
    'button.send-button, button[aria-label="Send"]',
  );
  return send instanceof HTMLElement ? send : undefined;
}

export const qwenAdapter: BrowserAdapter = {
  id: 'qwen',
  providerLabel: 'Qwen',
  canHandle(url: string): boolean {
    return /^https:\/\/chat\.qwen\.ai\//.test(url);
  },
  snapshotConversation(): ConversationSnapshot {
    return { assistantTurnCount: qwenAssistantTurns().length };
  },
  async sendPrompt(text: string): Promise<PromptSendResult> {
    const snapshot = this.snapshotConversation();
    const field = input();
    if (!field) {
      throw new Error(
        'Qwen input was not found (textarea.message-input-textarea).',
      );
    }
    setComposerValue(field, text);
    const send = sendButton();
    if (!send) {
      throw new Error('Qwen send control was not found (button.send-button).');
    }
    send.click();
    return { snapshot };
  },
  async waitForResponse(
    context: ResponseWaitContext,
  ): Promise<CapturedResponse> {
    const timeoutMs = context.timeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS;
    await waitUntil(
      () => qwenAssistantTurns().length > context.snapshot.assistantTurnCount,
      {
        timeoutMs,
        message: 'Qwen new assistant turn did not appear.',
      },
    );
    const turn = () =>
      trackedTurn(qwenAssistantTurns(), context.snapshot.assistantTurnCount);
    await waitUntil(
      () =>
        !qwenIsGenerating() && qwenExtract(turn()).length > 0
          ? true
          : undefined,
      {
        timeoutMs,
        message:
          'Qwen generation did not complete (Stop button stayed visible).',
      },
    );
    const text = await waitForStableText(() => qwenExtract(turn()), {
      timeoutMs,
      isBusy: () => qwenIsGenerating(),
      message: 'Qwen assistant response did not stabilize.',
    });
    if (text.length === 0) {
      throw new Error('Qwen assistant response was empty.');
    }
    return { text };
  },
  async captureLatestResponse(): Promise<string> {
    const text = qwenExtract(qwenAssistantTurns().at(-1));
    if (text.length === 0) {
      throw new Error('Qwen assistant response was not found.');
    }
    return text;
  },
  diagnostics(): AdapterDiagnostics {
    const turns = qwenAssistantTurns();
    return {
      provider: 'Qwen',
      inputFound: input() !== undefined,
      sendFound: sendButton() !== undefined,
      assistantTurns: turns.length,
      generating: qwenIsGenerating(),
      currentTrackedTurn: qwenExtract(turns.at(-1)).slice(0, 80) || undefined,
    };
  },
};
