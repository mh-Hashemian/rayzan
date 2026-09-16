import {
  clickControl,
  isVisible,
  pressEnter,
  queryAll,
  queryFirst,
  richComposerText,
  setRichComposerValue,
  submitFilledComposer,
  visibleText,
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

const STOP_ARIA = /stop|توقف|لغو|abort|halt|cancel generating/i;
const SEND_ARIA = /send|submit|ارسال|envoyer|senden|enviar/i;

export function grokAssistantTurns(root?: ParentNode): Element[] {
  return queryAll('[data-testid="assistant-message"]', root);
}

export function grokStopControl(root?: ParentNode): Element | undefined {
  return queryAll(
    [
      'button[data-testid="chat-submit"]',
      'button[data-testid*="stop" i]',
      'button[aria-label*="Stop" i]',
      'button[aria-label*="توقف"]',
      'button[aria-label*="لغو"]',
    ].join(', '),
    root,
  ).find((element) => {
    if (!isVisible(element)) {
      return false;
    }
    const testId = (element.getAttribute('data-testid') ?? '').toLowerCase();
    if (testId.includes('stop')) {
      return true;
    }
    const aria = element.getAttribute('aria-label') ?? '';
    if (STOP_ARIA.test(aria)) {
      return true;
    }
    return false;
  });
}

export function grokSendControl(root?: ParentNode): HTMLElement | undefined {
  const send = queryFirst('button[data-testid="chat-submit"]', root);
  if (send === undefined || send.tagName !== 'BUTTON') {
    return undefined;
  }
  const button = send as HTMLButtonElement;
  if (button.disabled || send.getAttribute('aria-disabled') === 'true') {
    return undefined;
  }
  if (!isVisible(send)) {
    return undefined;
  }
  const aria = send.getAttribute('aria-label') ?? '';
  if (STOP_ARIA.test(aria)) {
    return undefined;
  }
  // Empty composer swaps submit for voice; only treat as Send when labeled as such
  // or when the localized send label is present (aria may be "ارسال", "Send", …).
  if (aria.length > 0 && !SEND_ARIA.test(aria) && !STOP_ARIA.test(aria)) {
    // Still accept unlabeled/unknown locales if type=submit and testid matches.
    if (button.getAttribute('type') !== 'submit') {
      return undefined;
    }
  }
  return send as HTMLElement;
}

export function grokIsGenerating(root?: ParentNode): boolean {
  if (grokStopControl(root) !== undefined) {
    return true;
  }
  const last = grokAssistantTurns(root).at(-1);
  if (last === undefined) {
    return false;
  }
  const markdown = last.querySelector('.response-content-markdown');
  const thinking = last.querySelector('.thinking-container');
  const thinkingText = visibleText(thinking);
  // Thinking with an empty answer body means the stream has started.
  // Do not treat a missing Send button as generating (Grok swaps Submit for
  // Voice when the composer is empty).
  return thinkingText.length > 0 && visibleText(markdown).length === 0;
}

export function grokExtract(turn: Element | undefined): string {
  if (turn === undefined) {
    return '';
  }
  const clone = turn.cloneNode(true);
  if (clone.nodeType !== 1) {
    return visibleText(turn);
  }
  const cloneElement = clone as Element;
  for (const thinking of Array.from(
    cloneElement.querySelectorAll('.thinking-container'),
  )) {
    thinking.remove();
  }
  const markdown = cloneElement.querySelector('.response-content-markdown');
  if (markdown) {
    return visibleText(markdown);
  }
  return visibleText(cloneElement);
}

export function grokListTurns(root?: ParentNode): AssistantTurn[] {
  return grokAssistantTurns(root).map((element, index) => {
    const thinking = element.querySelector('.thinking-container');
    const finalText = grokExtract(element);
    const hasFinalAnswer = finalText.length > 0;
    return {
      element,
      identity: turnIdentity(element, index),
      hasFinalAnswer,
      thinkingOnly: Boolean(thinking) && !hasFinalAnswer,
      finalText,
    };
  });
}

function composer(): HTMLElement | undefined {
  const element =
    queryFirst(
      '[data-testid="chat-input"] [contenteditable="true"].query-bar-editor',
    ) ??
    queryFirst('[data-testid="chat-input"] [contenteditable="true"]') ??
    queryFirst('[contenteditable="true"][aria-label*="Grok" i]');
  if (
    element instanceof HTMLElement &&
    element.getAttribute('contenteditable') === 'true'
  ) {
    return element;
  }
  return undefined;
}

function sendButton(): HTMLElement | undefined {
  return grokSendControl();
}

function grokSubmitAccepted(
  field: HTMLElement,
  snapshot: ConversationSnapshot,
): boolean {
  if (richComposerText(field).length === 0) {
    return true;
  }
  if (grokIsGenerating()) {
    return true;
  }
  return grokListTurns().length > snapshot.assistantTurnCount;
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

export const grokAdapter: BrowserAdapter = {
  id: 'grok',
  providerLabel: 'Grok',
  canHandle(url: string): boolean {
    return /^https:\/\/grok\.com(?:\/|$)/.test(url);
  },
  listAssistantTurns(): readonly AssistantTurn[] {
    return grokListTurns();
  },
  isGenerating(): boolean {
    return grokIsGenerating();
  },
  snapshotLive() {
    return liveSnapshotFromTurns(grokListTurns());
  },
  snapshotConversation(): ConversationSnapshot {
    return conversationFromLive(this.snapshotLive());
  },
  async sendPrompt(text: string): Promise<PromptSendResult> {
    const snapshot = this.snapshotConversation();
    const field = composer();
    if (!field) {
      throw new Error(
        'Grok input was not found ([data-testid="chat-input"] contenteditable).',
      );
    }
    setRichComposerValue(field, text);
    await submitFilledComposer({
      field,
      findSend: () => sendButton(),
      clickSend: (send) => {
        // TipTap composer submits via the form; prefer a real DOM click over
        // a synthetic React onClick so type=submit reaches form.onSubmit.
        try {
          send.click();
        } catch {
          clickControl(send);
        }
        const form = send.closest('form');
        if (form instanceof HTMLFormElement && richComposerText(field).length > 0) {
          try {
            if (typeof form.requestSubmit === 'function') {
              form.requestSubmit(
                send instanceof HTMLButtonElement ? send : undefined,
              );
            }
          } catch {
            // Already clicked; ignore requestSubmit failures.
          }
        }
      },
    });
    const accepted = () =>
      grokSubmitAccepted(field, snapshot) ? true : undefined;
    try {
      await waitUntil(accepted, {
        timeoutMs: 2000,
        message: 'Grok send click did not submit.',
      });
    } catch {
      const retry = sendButton();
      if (retry) {
        try {
          retry.click();
        } catch {
          clickControl(retry);
        }
      }
      pressEnter(field);
      await waitUntil(accepted, {
        timeoutMs: 2500,
        message:
          'Grok send control was activated but the composer did not submit.',
      });
    }
    return { snapshot };
  },
  async captureLatestResponse(): Promise<string> {
    const last = grokListTurns().at(-1);
    if (!last || last.finalText.length === 0) {
      throw new Error('Grok assistant response was not found.');
    }
    return last.finalText;
  },
  diagnostics(): AdapterDiagnostics {
    const turns = grokListTurns();
    return {
      provider: 'Grok',
      inputFound: composer() !== undefined,
      sendFound: sendButton() !== undefined,
      assistantTurns: turns.length,
      generating: grokIsGenerating(),
      currentTrackedTurn: turns.at(-1)?.finalText.slice(0, 80) || undefined,
    };
  },
};
