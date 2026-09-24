/** Shared DOM helpers for provider page adapters (extension + managed). */

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
      // Cross-origin iframe.
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

export function isDocumentHidden(): boolean {
  return (
    typeof document !== 'undefined' &&
    (document.visibilityState === 'hidden' || document.hidden === true)
  );
}

export async function waitForPaint(timeoutMs = 50): Promise<void> {
  const hidden =
    typeof document !== 'undefined' &&
    (document.visibilityState === 'hidden' || document.hidden);
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
