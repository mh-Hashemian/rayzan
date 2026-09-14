export const DEFAULT_RESPONSE_TIMEOUT_MS = 180_000;
export const STABILITY_WINDOW_MS = 2_000;

export function visibleText(element: Element | null | undefined): string {
  if (element === null || element === undefined) {
    return '';
  }
  const html = element as Element & { innerText?: string };
  return (html.innerText ?? element.textContent ?? '').trim();
}

export function setComposerValue(
  element: HTMLTextAreaElement,
  text: string,
): void {
  element.focus();
  element.select();
  const inserted = document.execCommand('insertText', false, text);
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
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        data: text,
        inputType: 'insertText',
      }),
    );
  }
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
    const observer = new MutationObserver(tick);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    const timer = setInterval(tick, 120);
    tick();
  });
}

export function trackedTurn(
  turns: readonly Element[],
  previousCount: number,
): Element | undefined {
  return turns[previousCount] ?? turns.at(-1);
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
      if (current !== last || busy) {
        last = current;
        lastChange = Date.now();
      }
      if (!busy && current.length > 0 && Date.now() - lastChange >= windowMs) {
        finish(undefined, current);
        return;
      }
      if (Date.now() - started >= options.timeoutMs) {
        finish(new Error(options.message));
      }
    };
    const observer = new MutationObserver(tick);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    const timer = setInterval(tick, 80);
    tick();
  });
}
