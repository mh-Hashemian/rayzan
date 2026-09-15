import {
  clickControl,
  pressEnter,
  queryAll,
  queryFirst,
  setComposerValue,
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

export function deepSeekAssistantTurns(root?: ParentNode): Element[] {
  return queryAll('.ds-message', root).filter(
    (element) =>
      element.querySelector(
        '.ds-assistant-message-main-content, .ds-think-content',
      ) !== null,
  );
}

export function deepSeekIsGenerating(root?: ParentNode): boolean {
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
  return visibleText(main);
}

export function deepSeekListTurns(root?: ParentNode): AssistantTurn[] {
  return deepSeekAssistantTurns(root).map((element, index) => {
    const mainText = visibleText(
      element.querySelector('.ds-assistant-message-main-content'),
    );
    const thinking = element.querySelector('.ds-think-content');
    const hasFinalAnswer = mainText.length > 0;
    return {
      element,
      identity: turnIdentity(element, index),
      hasFinalAnswer,
      thinkingOnly: Boolean(thinking) && !hasFinalAnswer,
      finalText: mainText,
    };
  });
}

function input(): HTMLTextAreaElement | undefined {
  const element =
    queryFirst('textarea[placeholder="Message DeepSeek"]') ??
    queryFirst('textarea[placeholder*="DeepSeek" i]') ??
    queryFirst('textarea[name="search"]');
  return element instanceof HTMLTextAreaElement ? element : undefined;
}

function sendButton(): HTMLElement | undefined {
  const send = queryFirst('.ds-button.ds-button--primary.ds-button--circle');
  return send instanceof HTMLElement ? send : undefined;
}

function sendButtonReady(): HTMLElement | undefined {
  const button = sendButton();
  if (
    button === undefined ||
    button.classList.contains('ds-button--disabled')
  ) {
    return undefined;
  }
  return button;
}

function deepSeekSubmitAccepted(
  field: HTMLTextAreaElement,
  snapshot: ConversationSnapshot,
): boolean {
  if (field.value.trim().length === 0) {
    return true;
  }
  if (deepSeekIsGenerating()) {
    return true;
  }
  return deepSeekListTurns().length > snapshot.assistantTurnCount;
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

export const deepSeekAdapter: BrowserAdapter = {
  id: 'deepseek',
  providerLabel: 'DeepSeek',
  canHandle(url: string): boolean {
    return /^https:\/\/chat\.deepseek\.com\//.test(url);
  },
  listAssistantTurns(): readonly AssistantTurn[] {
    return deepSeekListTurns();
  },
  isGenerating(): boolean {
    return deepSeekIsGenerating();
  },
  snapshotLive() {
    return liveSnapshotFromTurns(deepSeekListTurns());
  },
  snapshotConversation(): ConversationSnapshot {
    return conversationFromLive(this.snapshotLive());
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
    const send = await waitUntil(() => sendButtonReady(), {
      timeoutMs: 4000,
      message: 'DeepSeek send button stayed disabled after filling the input.',
    });
    await waitForPaint();
    send.click();
    const accepted = () =>
      deepSeekSubmitAccepted(field, snapshot) ? true : undefined;
    try {
      await waitUntil(accepted, {
        timeoutMs: 2000,
        message: 'DeepSeek send click did not submit.',
      });
    } catch {
      clickControl(sendButtonReady() ?? send);
      pressEnter(field);
      await waitUntil(accepted, {
        timeoutMs: 2500,
        message:
          'DeepSeek send control was activated but the composer did not submit.',
      });
    }
    return { snapshot };
  },
  async captureLatestResponse(): Promise<string> {
    const last = deepSeekListTurns().at(-1);
    if (!last || last.finalText.length === 0) {
      throw new Error('DeepSeek assistant response was not found.');
    }
    return last.finalText;
  },
  diagnostics(): AdapterDiagnostics {
    const turns = deepSeekListTurns();
    return {
      provider: 'DeepSeek',
      inputFound: input() !== undefined,
      sendFound: sendButton() !== undefined,
      assistantTurns: turns.length,
      generating: deepSeekIsGenerating(),
      currentTrackedTurn: turns.at(-1)?.finalText.slice(0, 80) || undefined,
    };
  },
};
