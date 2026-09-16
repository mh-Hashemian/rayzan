export const DEFAULT_RESPONSE_TIMEOUT_MS = 180_000;
export const STABILITY_WINDOW_MS = 2_000;

export function searchRoots(root?: ParentNode): ParentNode[] {
  const scope =
    root ?? (typeof document === 'undefined' ? undefined : document);
  if (scope === undefined) {
    return [];
  }
  if (typeof document === 'undefined' || scope !== document) {
    return [scope];
  }
  const roots: ParentNode[] = [document];
  for (const iframe of Array.from(document.querySelectorAll('iframe'))) {
    try {
      const doc = (iframe as HTMLIFrameElement).contentDocument;
      if (doc) {
        roots.push(doc);
      }
    } catch {
      // Cross-origin iframe; a separate content script may handle it.
    }
  }
  return roots;
}

export function isVisible(element: Element | null | undefined): boolean {
  if (element === null || element === undefined) {
    return false;
  }
  if (element.getAttribute('hidden') !== null) {
    return false;
  }
  if (element.getAttribute('aria-hidden') === 'true') {
    return false;
  }
  const html = element as HTMLElement;
  if (html.hidden) {
    return false;
  }
  const view = element.ownerDocument.defaultView;
  if (view && typeof view.getComputedStyle === 'function') {
    const style = view.getComputedStyle(element);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0'
    ) {
      return false;
    }
  }
  return true;
}

function collectInRoot(selector: string, root: ParentNode): Element[] {
  const matches: Element[] = [];
  const seen = new Set<Element>();
  const visit = (node: ParentNode) => {
    for (const element of Array.from(node.querySelectorAll(selector))) {
      if (!seen.has(element)) {
        seen.add(element);
        matches.push(element);
      }
    }
    for (const element of Array.from(node.querySelectorAll('*'))) {
      if (element.shadowRoot) {
        visit(element.shadowRoot);
      }
    }
  };
  visit(root);
  return matches;
}

export function queryAll(selector: string, root?: ParentNode): Element[] {
  return searchRoots(root).flatMap((item) => collectInRoot(selector, item));
}

export function queryFirst(
  selector: string,
  root?: ParentNode,
): Element | undefined {
  return queryAll(selector, root)[0];
}

function observeRoots(observer: MutationObserver, root?: ParentNode): void {
  for (const item of searchRoots(root)) {
    const node =
      item instanceof Document
        ? item.documentElement
        : item instanceof Element
          ? item
          : undefined;
    if (node === undefined || node === null) {
      continue;
    }
    try {
      observer.observe(node, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
    } catch {
      // Detached or inert root.
    }
  }
}

export function visibleText(element: Element | null | undefined): string {
  if (element === null || element === undefined) {
    return '';
  }
  const html = element as Element & { innerText?: string };
  return (html.innerText ?? element.textContent ?? '').trim();
}

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

function notifyComposerInput(element: HTMLTextAreaElement, text: string): void {
  const events: Event[] = [];
  try {
    events.push(new Event('input', { bubbles: true }));
  } catch {
    // Ignore constructor failures.
  }
  try {
    events.push(
      new InputEvent('input', {
        bubbles: true,
        data: text,
        inputType: 'insertText',
      }),
    );
  } catch {
    // Ignore constructor failures.
  }
  try {
    events.push(new Event('change', { bubbles: true }));
  } catch {
    // Ignore constructor failures.
  }
  for (const event of events) {
    try {
      element.dispatchEvent(event);
    } catch {
      // Firefox Xray: page React cannot read currentTarget on
      // content-script Events. Native execCommand already notified.
    }
  }
}

export function setComposerValue(
  element: HTMLTextAreaElement,
  text: string,
): void {
  element.focus();
  element.select();
  let inserted = false;
  try {
    inserted = document.execCommand('insertText', false, text);
  } catch {
    // Firefox may deny execCommand; fall through to the value setter.
  }
  if (!inserted || element.value !== text) {
    const prototype = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )?.set;
    if (prototype) {
      prototype.call(element, text);
    } else {
      element.value = text;
    }
    notifyComposerInput(element, text);
  }
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
      // Firefox Xray: page React cannot read currentTarget on
      // content-script Events. Native execCommand already notified.
    }
  }
}

export function richComposerText(element: HTMLElement | undefined): string {
  if (element === undefined) {
    return '';
  }
  return (element.innerText ?? element.textContent ?? '').trim();
}

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

export function syncReactComposer(element: HTMLTextAreaElement): void {
  const onChange = reactPropsOf(element)?.onChange;
  if (typeof onChange !== 'function') {
    return;
  }
  try {
    const value = element.value;
    onChange(
      reactHandlerEvent({
        target: { value },
        currentTarget: { value },
      }),
    );
  } catch {
    // Firefox Xray: do not pass DOM nodes into page handlers.
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

export function isDocumentHidden(): boolean {
  return (
    typeof document !== 'undefined' &&
    (document.visibilityState === 'hidden' || document.hidden === true)
  );
}

/**
 * Submit after filling the composer. In background tabs ChatGPT/DeepSeek/Qwen
 * often leave Send disabled until the tab paints — waiting for that button
 * hangs until the user focuses the tab. Prefer an immediate Enter when hidden.
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
 * Yield briefly so React/layout can enable the send control after composer
 * input. Must not rely solely on requestAnimationFrame: Chrome suspends rAF
 * in background tabs, which previously blocked sendPrompt until the tab was
 * focused (and left sendInFlight stuck in the content script).
 */
export async function waitForPaint(timeoutMs = 50): Promise<void> {
  const hidden =
    typeof document !== 'undefined' &&
    (document.visibilityState === 'hidden' || document.hidden);
  // Do not await timers in background tabs — Chrome may delay them until focus,
  // which made sendPrompt appear to "only work when the tab is focused".
  if (hidden || timeoutMs <= 0) {
    return;
  }
  const fallback = new Promise<void>((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
  const raf = globalThis.requestAnimationFrame;
  if (typeof raf !== 'function') {
    await fallback;
    return;
  }
  await Promise.race([
    new Promise<void>((resolve) => {
      raf(() => raf(() => resolve()));
    }),
    fallback,
  ]);
}

export async function waitUntil<T>(
  probe: () => T | undefined | false,
  options: {
    timeoutMs: number;
    message: string;
  },
): Promise<T> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, value?: T) => {
      if (settled) {
        return;
      }
      settled = true;
      observer.disconnect();
      clearInterval(timer);
      clearTimeout(deadline);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible);
      }
      if (error) {
        reject(error);
      } else {
        resolve(value as T);
      }
    };
    const tick = () => {
      const value = probe();
      if (value !== undefined && value !== false) {
        finish(undefined, value);
        return;
      }
      if (Date.now() - started >= options.timeoutMs) {
        finish(new Error(options.message));
      }
    };
    const onVisible = () => {
      tick();
    };
    const observer = new MutationObserver(tick);
    observeRoots(observer);
    const timer = setInterval(tick, 120);
    const deadline = setTimeout(tick, options.timeoutMs);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisible);
    }
    tick();
  });
}

export function trackedTurn(
  turns: readonly Element[],
  previousCount: number,
): Element | undefined {
  if (turns.length <= previousCount) {
    return undefined;
  }
  return turns[previousCount];
}

export function turnAfterSnapshot(
  turns: readonly Element[],
  previousCount: number,
  lastAssistantText: string | undefined,
  extract: (turn: Element | undefined) => string,
): Element | undefined {
  if (turns.length > previousCount) {
    return trackedTurn(turns, previousCount);
  }
  const last = turns.at(-1);
  if (last !== undefined && extract(last) !== (lastAssistantText ?? '')) {
    return last;
  }
  return undefined;
}

export async function waitForStableText(
  read: () => string,
  options: {
    timeoutMs: number;
    windowMs?: number;
    isBusy?: () => boolean;
    message: string;
  },
): Promise<string> {
  const windowMs = options.windowMs ?? STABILITY_WINDOW_MS;
  const started = Date.now();
  let last = read();
  let lastChange = Date.now();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, value?: string) => {
      if (settled) {
        return;
      }
      settled = true;
      observer.disconnect();
      clearInterval(timer);
      if (error) {
        reject(error);
      } else {
        resolve(value ?? '');
      }
    };
    const tick = () => {
      const current = read();
      const busy = options.isBusy?.() === true;
      if (current !== last) {
        last = current;
        lastChange = Date.now();
      }
      const stableFor = Date.now() - lastChange;
      const finishedCleanly =
        !busy && current.length > 0 && stableFor >= windowMs;
      const generatingFlagStuck =
        busy && current.length > 0 && stableFor >= windowMs * 2;
      if (finishedCleanly || generatingFlagStuck) {
        finish(undefined, current);
        return;
      }
      if (Date.now() - started >= options.timeoutMs) {
        if (current.length > 0) {
          finish(undefined, current);
          return;
        }
        finish(new Error(options.message));
      }
    };
    const observer = new MutationObserver(tick);
    observeRoots(observer);
    const timer = setInterval(tick, 80);
    tick();
  });
}
