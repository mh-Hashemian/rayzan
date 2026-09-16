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

const THINKING_SELECTORS = [
  '[data-testid="thoughts"]',
  '[data-testid="thought-process"]',
  '[data-testid="reasoning-summary"]',
  '.result-thinking',
].join(', ');

function uniqueElements(elements: Element[]): Element[] {
  const seen = new Set<Element>();
  const unique: Element[] = [];
  for (const element of elements) {
    if (seen.has(element)) {
      continue;
    }
    seen.add(element);
    unique.push(element);
  }
  return unique;
}

export function chatgptAssistantTurns(root?: ParentNode): Element[] {
  const sections = uniqueElements(
    queryAll(
      '[data-turn="assistant"], [data-testid^="conversation-turn-"][data-turn="assistant"]',
      root,
    ).filter((element) => element.getAttribute('data-turn') === 'assistant'),
  );
  if (sections.length > 0) {
    return sections;
  }
  return queryAll('[data-message-author-role="assistant"]', root).filter(
    (element) =>
      element.parentElement?.closest('[data-message-author-role]') === null,
  );
}

export function chatgptStopControl(root?: ParentNode): Element | undefined {
  return queryAll(
    [
      '#composer-submit-button[data-testid="stop-button"]',
      'button[data-testid="stop-button"]',
      'button[aria-label="Stop streaming"]',
      'button[aria-label="Stop generating"]',
      'button[aria-label="Stop"]',
    ].join(', '),
    root,
  ).find((element) => {
    if (!isVisible(element)) {
      return false;
    }
    if (element.getAttribute('data-testid') === 'stop-button') {
      return true;
    }
    const aria = (element.getAttribute('aria-label') ?? '').toLowerCase();
    if (/voice|send/.test(aria)) {
      return false;
    }
    return /stop/.test(aria);
  });
}

export function chatgptSendControl(root?: ParentNode): HTMLElement | undefined {
  const send = queryFirst(
    '#composer-submit-button[data-testid="send-button"], button[data-testid="send-button"][aria-label="Send prompt"], button[aria-label="Send prompt"]',
    root,
  );
  if (send === undefined || send.tagName !== 'BUTTON') {
    return undefined;
  }
  if (send.getAttribute('aria-label') !== 'Send prompt') {
    return undefined;
  }
  const testId = send.getAttribute('data-testid');
  if (testId !== null && testId !== 'send-button') {
    return undefined;
  }
  const button = send as HTMLButtonElement;
  if (button.disabled || send.getAttribute('aria-disabled') === 'true') {
    return undefined;
  }
  if (!isVisible(send)) {
    return undefined;
  }
  return send as HTMLElement;
}

export function chatgptIsGenerating(root?: ParentNode): boolean {
  return chatgptStopControl(root) !== undefined;
}

export function chatgptExtract(turn: Element | undefined): string {
  if (turn === undefined) {
    return '';
  }
  const clone = turn.cloneNode(true);
  if (clone.nodeType !== 1) {
    return visibleText(turn);
  }
  const cloneElement = clone as Element;
  for (const thinking of Array.from(
    cloneElement.querySelectorAll(THINKING_SELECTORS),
  )) {
    thinking.remove();
  }
  const markdown = cloneElement.querySelector('.markdown');
  if (markdown) {
    return visibleText(markdown);
  }
  const role = cloneElement.querySelector(
    '[data-message-author-role="assistant"]',
  );
  return role ? visibleText(role) : '';
}

export function chatgptListTurns(root?: ParentNode): AssistantTurn[] {
  return chatgptAssistantTurns(root).map((element, index) => {
    const thinking = element.querySelector(THINKING_SELECTORS);
    const finalText = chatgptExtract(element);
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
  const element = queryFirst('#prompt-textarea');
  if (
    element instanceof HTMLElement &&
    element.getAttribute('contenteditable') === 'true'
  ) {
    return element;
  }
  return undefined;
}

function sendButton(): HTMLElement | undefined {
  return chatgptSendControl();
}

function chatgptSubmitAccepted(
  field: HTMLElement,
  snapshot: ConversationSnapshot,
): boolean {
  if (richComposerText(field).length === 0) {
    return true;
  }
  if (chatgptIsGenerating()) {
    return true;
  }
  return chatgptListTurns().length > snapshot.assistantTurnCount;
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

export const chatgptAdapter: BrowserAdapter = {
  id: 'chatgpt',
  providerLabel: 'ChatGPT',
  canHandle(url: string): boolean {
    return /^https:\/\/(chatgpt\.com|chat\.openai\.com)(?:\/|$)/.test(url);
  },
  listAssistantTurns(): readonly AssistantTurn[] {
    return chatgptListTurns();
  },
  isGenerating(): boolean {
    return chatgptIsGenerating();
  },
  snapshotLive() {
    return liveSnapshotFromTurns(chatgptListTurns());
  },
  snapshotConversation(): ConversationSnapshot {
    return conversationFromLive(this.snapshotLive());
  },
  async sendPrompt(text: string): Promise<PromptSendResult> {
    const snapshot = this.snapshotConversation();
    const field = composer();
    if (!field) {
      throw new Error(
        'ChatGPT input was not found (div#prompt-textarea[contenteditable=true]).',
      );
    }
    setRichComposerValue(field, text);
    await submitFilledComposer({
      field,
      findSend: () => sendButton(),
    });
    const accepted = () =>
      chatgptSubmitAccepted(field, snapshot) ? true : undefined;
    try {
      await waitUntil(accepted, {
        timeoutMs: 2000,
        message: 'ChatGPT send click did not submit.',
      });
    } catch {
      const retry = sendButton();
      if (retry) {
        clickControl(retry);
      }
      pressEnter(field);
      await waitUntil(accepted, {
        timeoutMs: 2500,
        message:
          'ChatGPT send control was activated but the composer did not submit.',
      });
    }
    return { snapshot };
  },
  async captureLatestResponse(): Promise<string> {
    const last = chatgptListTurns().at(-1);
    if (!last || last.finalText.length === 0) {
      throw new Error('ChatGPT assistant response was not found.');
    }
    return last.finalText;
  },
  diagnostics(): AdapterDiagnostics {
    const turns = chatgptListTurns();
    return {
      provider: 'ChatGPT',
      inputFound: composer() !== undefined,
      sendFound: sendButton() !== undefined,
      assistantTurns: turns.length,
      generating: chatgptIsGenerating(),
      currentTrackedTurn: turns.at(-1)?.finalText.slice(0, 80) || undefined,
    };
  },
};
