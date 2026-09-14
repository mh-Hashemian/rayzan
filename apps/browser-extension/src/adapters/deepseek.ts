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

export function deepSeekAssistantTurns(root: ParentNode = document): Element[] {
  return Array.from(root.querySelectorAll('.ds-message')).filter(
    (element) =>
      element.querySelector(
        '.ds-assistant-message-main-content, .ds-think-content',
      ) !== null,
  );
}

export function deepSeekIsGenerating(root: ParentNode = document): boolean {
  const last = deepSeekAssistantTurns(root).at(-1);
  const hasMain = last?.querySelector('.ds-assistant-message-main-content');
  const thinking = last?.querySelector('.ds-think-content');
  return Boolean(thinking && !hasMain);
}

export function deepSeekExtract(turn: Element | undefined): string {
  if (turn === undefined) {
    return '';
  }
  const main = turn.querySelector('.ds-assistant-message-main-content');
  return visibleText(main ?? turn);
}

function input(): HTMLTextAreaElement | undefined {
  const element =
    document.querySelector('textarea[placeholder="Message DeepSeek"]') ??
    document.querySelector('textarea[name="search"]');
  return element instanceof HTMLTextAreaElement ? element : undefined;
}

function sendButton(): HTMLElement | undefined {
  const send = document.querySelector(
    '.ds-button.ds-button--primary.ds-button--circle',
  );
  return send instanceof HTMLElement ? send : undefined;
}

export const deepSeekAdapter: BrowserAdapter = {
  id: 'deepseek',
  providerLabel: 'DeepSeek',
  canHandle(url: string): boolean {
    return /^https:\/\/chat\.deepseek\.com\//.test(url);
  },
  snapshotConversation(): ConversationSnapshot {
    return { assistantTurnCount: deepSeekAssistantTurns().length };
  },
  async sendPrompt(text: string): Promise<PromptSendResult> {
    const snapshot = this.snapshotConversation();
    const field = input();
    if (!field) {
      throw new Error(
        'DeepSeek input was not found (textarea[placeholder="Message DeepSeek"]).',
      );
    }
    setComposerValue(field, text);
    const send = await waitUntil(
      () => {
        const button = sendButton();
        return button && !button.classList.contains('ds-button--disabled')
          ? button
          : undefined;
      },
      {
        timeoutMs: 4000,
        message:
          'DeepSeek send button stayed disabled after filling the input.',
      },
    );
    send.click();
    return { snapshot };
  },
  async waitForResponse(
    context: ResponseWaitContext,
  ): Promise<CapturedResponse> {
    const timeoutMs = context.timeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS;
    await waitUntil(
      () =>
        deepSeekAssistantTurns().length > context.snapshot.assistantTurnCount,
      {
        timeoutMs,
        message: 'DeepSeek new assistant turn did not appear.',
      },
    );
    const turn = () =>
      trackedTurn(
        deepSeekAssistantTurns(),
        context.snapshot.assistantTurnCount,
      );
    await waitUntil(
      () =>
        deepSeekExtract(turn()).length > 0 && !deepSeekIsGenerating()
          ? true
          : undefined,
      {
        timeoutMs,
        message: 'DeepSeek generation completion was not detected.',
      },
    );
    const text = await waitForStableText(() => deepSeekExtract(turn()), {
      timeoutMs,
      isBusy: () => deepSeekIsGenerating(),
      message: 'DeepSeek assistant response did not stabilize.',
    });
    if (text.length === 0) {
      throw new Error('DeepSeek assistant response was empty.');
    }
    return { text };
  },
  async captureLatestResponse(): Promise<string> {
    const text = deepSeekExtract(deepSeekAssistantTurns().at(-1));
    if (text.length === 0) {
      throw new Error('DeepSeek assistant response was not found.');
    }
    return text;
  },
  diagnostics(): AdapterDiagnostics {
    const turns = deepSeekAssistantTurns();
    return {
      provider: 'DeepSeek',
      inputFound: input() !== undefined,
      sendFound: sendButton() !== undefined,
      assistantTurns: turns.length,
      generating: deepSeekIsGenerating(),
      currentTrackedTurn:
        deepSeekExtract(turns.at(-1)).slice(0, 80) || undefined,
    };
  },
};
