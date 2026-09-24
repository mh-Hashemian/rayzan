import { isVisible, queryAll, queryFirst, waitUntil } from './dom.js';
import {
  clickControl,
  pressEnter,
  richComposerText,
  setRichComposerValue,
  submitFilledComposer,
} from './rich-composer.js';

export interface ChatGptSendStages {
  readonly fillStartedMs: number;
  readonly fillCompletedMs: number;
  readonly submitTriggeredMs: number;
  readonly submissionAcceptedMs: number;
  readonly insertVia: string;
  readonly submitVia: string;
}

export interface ChatGptSendResult {
  readonly ok: true;
  readonly stages: ChatGptSendStages;
  readonly preSendAssistantTurnCount: number;
}

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

export function chatgptAssistantTurnElements(root?: ParentNode): Element[] {
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

export function chatgptComposer(): HTMLElement | undefined {
  const element = queryFirst('#prompt-textarea');
  if (
    element &&
    element.nodeType === 1 &&
    (element as Element).getAttribute('contenteditable') === 'true'
  ) {
    return element as HTMLElement;
  }
  return undefined;
}

export function chatgptSubmitAccepted(
  field: HTMLElement,
  preSendAssistantTurnCount: number,
): boolean {
  if (richComposerText(field).length === 0) {
    return true;
  }
  if (chatgptIsGenerating()) {
    return true;
  }
  return chatgptAssistantTurnElements().length > preSendAssistantTurnCount;
}

export type ChatGptSendProgress =
  | { readonly phase: 'fill_started' }
  | { readonly phase: 'fill_completed'; readonly insertVia: string }
  | { readonly phase: 'submit_triggered'; readonly submitVia: string }
  | { readonly phase: 'submission_accepted' };

/**
 * Extension-semantics ChatGPT send: fill → submit → wait until DOM accepts.
 */
export async function sendChatGptPrompt(
  text: string,
  options?: {
    readonly onProgress?: (event: ChatGptSendProgress) => void;
  },
): Promise<ChatGptSendResult> {
  const t0 = performance.now();
  const mark = (): number => Math.round(performance.now() - t0);
  const onProgress = options?.onProgress;

  const field = chatgptComposer();
  if (!field) {
    throw new Error(
      'ChatGPT input was not found (div#prompt-textarea[contenteditable=true]).',
    );
  }

  const preSendAssistantTurnCount = chatgptAssistantTurnElements().length;
  onProgress?.({ phase: 'fill_started' });
  const fillStartedMs = mark();

  const before = richComposerText(field);
  setRichComposerValue(field, text);
  const after = richComposerText(field);
  const insertVia =
    after === text.trim() && before !== after
      ? 'setRichComposerValue'
      : 'setRichComposerValue';
  onProgress?.({ phase: 'fill_completed', insertVia });
  const fillCompletedMs = mark();

  let submitVia = 'enter';
  await submitFilledComposer({
    field,
    findSend: () => chatgptSendControl(),
    clickSend: (send) => {
      submitVia = 'click';
      clickControl(send);
    },
  });
  onProgress?.({ phase: 'submit_triggered', submitVia });
  const submitTriggeredMs = mark();

  const accepted = () =>
    chatgptSubmitAccepted(field, preSendAssistantTurnCount) ? true : undefined;

  try {
    await waitUntil(accepted, {
      timeoutMs: 2000,
      message: 'ChatGPT send click did not submit.',
    });
  } catch {
    const retry = chatgptSendControl();
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

  onProgress?.({ phase: 'submission_accepted' });
  const submissionAcceptedMs = mark();

  return {
    ok: true,
    preSendAssistantTurnCount,
    stages: {
      fillStartedMs,
      fillCompletedMs,
      submitTriggeredMs,
      submissionAcceptedMs,
      insertVia,
      submitVia,
    },
  };
}
