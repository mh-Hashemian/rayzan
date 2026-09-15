import {
  isVisible,
  queryAll,
  queryFirst,
  setComposerValue,
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

export function glmAssistantTurns(root?: ParentNode): Element[] {
  const exact = queryAll('.chat-assistant', root);
  if (exact.length > 0) {
    return exact;
  }
  return queryAll('[class*="chat-assistant"]', root).filter(
    (element) => !element.closest('.user-message'),
  );
}

export function glmStopControl(root?: ParentNode): Element | undefined {
  return queryAll(
    [
      '#stop-message-button',
      'button[aria-label="Stop"]',
      'button[aria-label="Stop generating"]',
      '.stopGeneratingButton',
    ].join(', '),
    root,
  ).find(isVisible);
}

export function glmTurnAfterSnapshot(
  previousCount: number,
  root?: ParentNode,
): Element | undefined {
  const turns = glmAssistantTurns(root);
  const newer = turns.slice(previousCount);
  for (let index = newer.length - 1; index >= 0; index -= 1) {
    const turn = newer[index];
    if (turn !== undefined && glmExtract(turn).length > 0) {
      return turn;
    }
  }
  return newer[0];
}

export function glmIsGenerating(root?: ParentNode): boolean {
  if (glmStopControl(root) !== undefined) {
    return true;
  }
  const send = queryFirst('#send-message-button', root);
  const sendDisabled = Boolean(
    send && 'disabled' in send && (send as { disabled: boolean }).disabled,
  );
  const last = glmAssistantTurns(root).at(-1);
  return sendDisabled && glmExtract(last).length === 0;
}

export function glmExtract(turn: Element | undefined): string {
  if (turn === undefined) {
    return '';
  }
  const clone = turn.cloneNode(true);
  if (clone.nodeType !== 1) {
    return visibleText(turn);
  }
  const cloneElement = clone as Element;
  for (const thinking of Array.from(
    cloneElement.querySelectorAll('.thinking-chain-container'),
  )) {
    thinking.remove();
  }
  return visibleText(cloneElement);
}

export function glmListTurns(root?: ParentNode): AssistantTurn[] {
  return glmAssistantTurns(root).map((element, index) => {
    const thinking = element.querySelector('.thinking-chain-container');
    const finalText = glmExtract(element);
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

function input(): HTMLTextAreaElement | undefined {
  const element = queryFirst('#chat-input, textarea#chat-input');
  return element instanceof HTMLTextAreaElement ? element : undefined;
}

function sendButton(): HTMLButtonElement | undefined {
  const send = queryFirst('#send-message-button');
  return send instanceof HTMLButtonElement ? send : undefined;
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

export const glmAdapter: BrowserAdapter = {
  id: 'glm',
  providerLabel: 'GLM',
  canHandle(url: string): boolean {
    return /^https:\/\/chat\.z\.ai\//.test(url);
  },
  listAssistantTurns(): readonly AssistantTurn[] {
    return glmListTurns();
  },
  isGenerating(): boolean {
    return glmIsGenerating();
  },
  snapshotLive() {
    return liveSnapshotFromTurns(glmListTurns());
  },
  snapshotConversation(): ConversationSnapshot {
    return conversationFromLive(this.snapshotLive());
  },
  async sendPrompt(text: string): Promise<PromptSendResult> {
    const snapshot = this.snapshotConversation();
    const field = input();
    if (!field) {
      throw new Error('GLM input was not found (textarea#chat-input).');
    }
    setComposerValue(field, text);
    const send = await waitUntil(
      () => {
        const button = sendButton();
        return button && !button.disabled ? button : undefined;
      },
      {
        timeoutMs: 4000,
        message: 'GLM send button stayed disabled after filling the input.',
      },
    );
    send.click();
    return { snapshot };
  },
  async captureLatestResponse(): Promise<string> {
    const last = glmListTurns().at(-1);
    if (!last || last.finalText.length === 0) {
      throw new Error('GLM assistant response was not found.');
    }
    return last.finalText;
  },
  diagnostics(): AdapterDiagnostics {
    const turns = glmListTurns();
    return {
      provider: 'GLM',
      inputFound: input() !== undefined,
      sendFound: sendButton() !== undefined,
      assistantTurns: turns.length,
      generating: glmIsGenerating(),
      currentTrackedTurn: turns.at(-1)?.finalText.slice(0, 80) || undefined,
    };
  },
};
