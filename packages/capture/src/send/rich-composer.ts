import {
  isDocumentHidden,
  waitForPaint,
  waitUntil,
} from './dom.js';

type PageWrapped<T> = T & { wrappedJSObject?: T };

type ReactLikeProps = {
  onChange?: (event: unknown) => void;
  onClick?: (event: unknown) => void;
  onKeyDown?: (event: unknown) => void;
};

function unwrapPageNode<T extends object>(node: T): T {
  return (node as PageWrapped<T>).wrappedJSObject ?? node;
}

function propertyNames(value: object): string[] {
  const names = new Set<string>();
  for (const name of Object.keys(value)) {
    names.add(name);
  }
  try {
    for (const name of Object.getOwnPropertyNames(value)) {
      names.add(name);
    }
  } catch {
    // Firefox Xray wrappers can throw.
  }
  for (const name in value) {
    names.add(name);
  }
  return [...names];
}

export function reactPropsOf(element: Element): ReactLikeProps | undefined {
  for (const node of [element, unwrapPageNode(element)]) {
    const key = propertyNames(node).find((name) =>
      name.startsWith('__reactProps$'),
    );
    if (key === undefined) {
      continue;
    }
    return (node as unknown as Record<string, ReactLikeProps>)[key];
  }
  return undefined;
}

function reactHandlerEvent(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    preventDefault() {},
    stopPropagation() {},
    nativeEvent: { isComposing: false },
    ...extra,
  };
}

function notifyRichComposerInput(element: HTMLElement, text: string): void {
  const events: Event[] = [];
  try {
    events.push(
      new InputEvent('input', {
        bubbles: true,
        data: text,
        inputType: 'insertText',
      }),
    );
  } catch {
    try {
      events.push(new Event('input', { bubbles: true }));
    } catch {
      // Ignore constructor failures.
    }
  }
  for (const event of events) {
    try {
      element.dispatchEvent(event);
    } catch {
      // Firefox Xray: native execCommand already notified.
    }
  }
}

export function richComposerText(element: HTMLElement | undefined): string {
  if (element === undefined) {
    return '';
  }
  return (element.innerText ?? element.textContent ?? '').trim();
}

/**
 * Bulk-fill a contenteditable composer (ChatGPT). Prefer native insertText so
 * React sees a real edit; fall back to DOM replace + InputEvent.
 */
export function setRichComposerValue(element: HTMLElement, text: string): void {
  element.focus();
  let inserted = false;
  try {
    document.execCommand('selectAll', false);
    inserted = document.execCommand('insertText', false, text);
  } catch {
    // Firefox may deny execCommand; fall through to a DOM replace.
  }
  if (!inserted || richComposerText(element) !== text.trim()) {
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
    const paragraph = element.ownerDocument.createElement('p');
    paragraph.textContent = text;
    element.append(paragraph);
    notifyRichComposerInput(element, text);
  }
}

export function clickControl(element: HTMLElement): void {
  const onClick = reactPropsOf(element)?.onClick;
  if (typeof onClick === 'function') {
    try {
      onClick(reactHandlerEvent());
      return;
    } catch {
      // Fall through to a DOM click.
    }
  }
  try {
    element.click();
  } catch {
    // Firefox may deny untrusted event property access.
  }
}

export function pressEnter(element: HTMLElement): void {
  const onKeyDown = reactPropsOf(element)?.onKeyDown;
  if (typeof onKeyDown === 'function') {
    try {
      onKeyDown(reactHandlerEvent({ key: 'Enter', shiftKey: false }));
      return;
    } catch {
      // Fall through to a DOM keydown.
    }
  }
  try {
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    );
  } catch {
    // Firefox Xray.
  }
}

/**
 * Submit after filling the composer. In background/hidden views, Send often
 * stays disabled until paint — prefer Enter rather than hanging on the button.
 */
export async function submitFilledComposer(input: {
  readonly field: HTMLElement;
  readonly findSend: () => HTMLElement | undefined;
  readonly clickSend?: (send: HTMLElement) => void;
  readonly foregroundTimeoutMs?: number;
}): Promise<void> {
  const click =
    input.clickSend ??
    ((send: HTMLElement) => {
      clickControl(send);
    });
  const hidden = isDocumentHidden();
  let send = input.findSend();
  if (send === undefined && !hidden) {
    try {
      send = await waitUntil(() => input.findSend(), {
        timeoutMs: input.foregroundTimeoutMs ?? 4000,
        message: 'Send control did not become ready after filling the input.',
      });
    } catch {
      send = input.findSend();
    }
  }
  await waitForPaint(hidden ? 0 : 50);
  send = send ?? input.findSend();
  if (send !== undefined) {
    click(send);
  } else {
    pressEnter(input.field);
  }
}
