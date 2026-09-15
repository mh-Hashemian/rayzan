import {
  clickControl,
  isVisible,
  pressEnter,
  queryAll,
  queryFirst,
  setComposerValue,
  syncReactComposer,
  visibleText,
  waitForPaint,
  waitUntil,
} from './observe.js';
import type {
  AdapterDiagnostics,
  BrowserAdapter,
  ConversationSnapshot,
  PromptSendResult,
} from './types.js';
import type { AssistantTurn } from '../capture/types.js';
import { liveSnapshotFromTurns, turnIdentity } from '../capture/turns.js';

export function qwenAssistantTurns(root?: ParentNode): Element[] {
  return queryAll(
    '.qwen-chat-message-assistant, [class*="qwen-chat-message-assistant"]',
    root,
  );
}

export function qwenIsGenerating(root?: ParentNode): boolean {
  return queryAll(
    '.stop-button, button[aria-label="Stop"], button[aria-label*="Stop" i]',
    root,
  ).some(isVisible);
}

export function qwenExtract(turn: Element | undefined): string {
  if (turn === undefined) {
    return '';
  }
  const answer = turn.querySelector('.response-message-content.phase-answer');
  return visibleText(answer ?? turn);
}

export function qwenListTurns(root?: ParentNode): AssistantTurn[] {
  return qwenAssistantTurns(root).map((element, index) => {
    const answer = element.querySelector(
      '.response-message-content.phase-answer',
    );
    const answerText = visibleText(answer);
    const generating = qwenIsGenerating(root);
    const fallback = visibleText(element);
    const hasFinalAnswer =
      answerText.length > 0 || (!generating && !answer && fallback.length > 0);
    return {
      element,
      identity: turnIdentity(element, index),
      hasFinalAnswer,
      thinkingOnly: !hasFinalAnswer,
      finalText: hasFinalAnswer ? answerText || fallback : '',
    };
  });
}

export function qwenSendControl(root?: ParentNode): HTMLElement | undefined {
  const send = queryFirst(
    '.message-input-right-button-send button.send-button[aria-label="Send"], button.send-button[aria-label="Send"], button[aria-label="Send"]',
    root,
  );
  if (
    send !== undefined &&
    send.tagName === 'BUTTON' &&
    send.getAttribute('aria-label') === 'Send' &&
    isVisible(send)
  ) {
    return send as HTMLElement;
  }
  return undefined;
}

function input(): HTMLTextAreaElement | undefined {
  const element = queryFirst(
    'textarea.message-input-textarea, textarea[placeholder*="Message" i], textarea[placeholder*="Ask Qwen" i]',
  );
  return element instanceof HTMLTextAreaElement ? element : undefined;
}

function sendButton(): HTMLElement | undefined {
  return qwenSendControl();
}

function sendButtonReady(): HTMLElement | undefined {
  const button = sendButton();
  if (button === undefined) {
    return undefined;
  }
  if ((button as HTMLButtonElement).disabled) {
    return undefined;
  }
  return button;
}

function qwenSubmitAccepted(
  field: HTMLTextAreaElement,
  snapshot: ConversationSnapshot,
): boolean {
  if (field.value.trim().length === 0) {
    return true;
  }
  if (qwenIsGenerating()) {
    return true;
  }
  return qwenListTurns().length > snapshot.assistantTurnCount;
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

export const qwenAdapter: BrowserAdapter = {
  id: 'qwen',
  providerLabel: 'Qwen',
  canHandle(url: string): boolean {
    return /^https:\/\/chat\.qwen\.ai\//.test(url);
  },
  listAssistantTurns(): readonly AssistantTurn[] {
    return qwenListTurns();
  },
  isGenerating(): boolean {
    return qwenIsGenerating();
  },
  snapshotLive() {
    return liveSnapshotFromTurns(qwenListTurns());
  },
  snapshotConversation(): ConversationSnapshot {
    return conversationFromLive(this.snapshotLive());
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
    syncReactComposer(field);
    const send = await waitUntil(() => sendButtonReady(), {
      timeoutMs: 4000,
      message:
        'Qwen send button did not appear after filling the input (Voice control was still showing).',
    });
    await waitForPaint();
    clickControl(send);
    const accepted = () =>
      qwenSubmitAccepted(field, snapshot) ? true : undefined;
    try {
      await waitUntil(accepted, {
        timeoutMs: 2000,
        message: 'Qwen send click did not submit.',
      });
    } catch {
      const retry = sendButtonReady() ?? send;
      clickControl(retry);
      pressEnter(field);
      await waitUntil(accepted, {
        timeoutMs: 2500,
        message:
          'Qwen send control was activated but the composer did not submit.',
      });
    }
    return { snapshot };
  },
  async captureLatestResponse(): Promise<string> {
    const last = qwenListTurns().at(-1);
    const text = last?.hasFinalAnswer
      ? last.finalText
      : qwenExtract(last?.element);
    if (!text || text.length === 0) {
      throw new Error('Qwen assistant response was not found.');
    }
    return text;
  },
  diagnostics(): AdapterDiagnostics {
    const turns = qwenListTurns();
    return {
      provider: 'Qwen',
      inputFound: input() !== undefined,
      sendFound: sendButton() !== undefined,
      assistantTurns: turns.length,
      generating: qwenIsGenerating(),
      currentTrackedTurn: turns.at(-1)?.finalText.slice(0, 80) || undefined,
    };
  },
};
