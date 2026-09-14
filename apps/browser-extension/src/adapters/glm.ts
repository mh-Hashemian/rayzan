import {
  DEFAULT_RESPONSE_TIMEOUT_MS,
  setComposerValue,
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

export function glmAssistantTurns(root: ParentNode = document): Element[] {
  return Array.from(root.querySelectorAll('.chat-assistant'));
}

export function glmStopControl(
  root: ParentNode = document,
): Element | undefined {
  const stop = root.querySelector(
    [
      '#stop-message-button',
      'button[aria-label="Stop"]',
      'button[aria-label="Stop generating"]',
      '.stopGeneratingButton',
    ].join(', '),
  );
  if (stop === null || stop.nodeType !== 1) {
    return undefined;
  }
  return stop as Element;
}

export function glmTurnAfterSnapshot(
  previousCount: number,
  root: ParentNode = document,
): Element | undefined {
  const turns = glmAssistantTurns(root);
  const newer = turns.slice(previousCount);
  for (let index = newer.length - 1; index >= 0; index -= 1) {
    const turn = newer[index];
    if (turn !== undefined && glmExtract(turn).length > 0) {
      return turn;
    }
  }
  return newer.at(-1) ?? turns.at(-1);
}

export function glmIsGenerating(root: ParentNode = document): boolean {
  if (glmStopControl(root) !== undefined) {
    return true;
  }
  const send = root.querySelector('#send-message-button');
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

function input(): HTMLTextAreaElement | undefined {
  const element = document.querySelector('#chat-input');
  return element instanceof HTMLTextAreaElement ? element : undefined;
}

function sendButton(): HTMLButtonElement | undefined {
  const send = document.querySelector('#send-message-button');
  return send instanceof HTMLButtonElement ? send : undefined;
}

export const glmAdapter: BrowserAdapter = {
  id: 'glm',
  providerLabel: 'GLM',
  canHandle(url: string): boolean {
    return /^https:\/\/chat\.z\.ai\//.test(url);
  },
  snapshotConversation(): ConversationSnapshot {
    const turns = glmAssistantTurns();
    return {
      assistantTurnCount: turns.length,
      lastAssistantText: glmExtract(turns.at(-1)),
    };
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
  async waitForResponse(
    context: ResponseWaitContext,
  ): Promise<CapturedResponse> {
    const timeoutMs = context.timeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS;
    await waitUntil(
      () => {
        if (glmAssistantTurns().length > context.snapshot.assistantTurnCount) {
          return true;
        }
        const last = glmExtract(glmAssistantTurns().at(-1));
        if (
          last.length > 0 &&
          last !== (context.snapshot.lastAssistantText ?? '')
        ) {
          return true;
        }
        return undefined;
      },
      {
        timeoutMs,
        message: 'GLM new assistant turn did not appear.',
      },
    );
    const turn = () =>
      glmTurnAfterSnapshot(context.snapshot.assistantTurnCount);
    await waitUntil(() => (glmExtract(turn()).length > 0 ? true : undefined), {
      timeoutMs,
      message: 'GLM assistant response text did not appear.',
    });
    const text = await waitForStableText(() => glmExtract(turn()), {
      timeoutMs,
      isBusy: () => glmStopControl() !== undefined,
      message: 'GLM assistant response did not stabilize.',
    });
    if (text.length === 0) {
      throw new Error('GLM assistant response was empty.');
    }
    return { text };
  },
  async captureLatestResponse(): Promise<string> {
    const text = glmExtract(glmAssistantTurns().at(-1));
    if (text.length === 0) {
      throw new Error('GLM assistant response was not found.');
    }
    return text;
  },
  diagnostics(): AdapterDiagnostics {
    const turns = glmAssistantTurns();
    return {
      provider: 'GLM',
      inputFound: input() !== undefined,
      sendFound: sendButton() !== undefined,
      assistantTurns: turns.length,
      generating: glmIsGenerating(),
      currentTrackedTurn: glmExtract(turns.at(-1)).slice(0, 80) || undefined,
    };
  },
};
