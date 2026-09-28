import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  glmPageScript,
  qwenPageScript,
} from '../electron/managed-provider/page-scripts.js';

/**
 * Minimal DOM stub sufficient for the page-script snapshot/send paths used in
 * these tests: querySelector(All), cloneNode, appendChild, remove, and an
 * innerText getter that joins block children with newlines (the layout
 * behavior innerText has on attached elements and the exact behavior the GLM
 * fix depends on — a detached clone would fuse the blocks instead).
 */
class StubElement {
  children: StubElement[] = [];
  parent: StubElement | null = null;
  id = '';
  className = '';
  tagName = 'div';
  disabled = false;
  textContent = '';
  style: Record<string, string> = {};
  /** Chromium element node type (1 = ELEMENT_NODE). */
  nodeType = 1;
  /** Open shadow root attached to this element (Chromium: cloneNode skips it). */
  shadowRoot: StubElement | null = null;
  #attached: () => boolean;
  #innerTextBlocks: readonly string[];

  constructor(
    attached: () => boolean,
    innerTextBlocks: readonly string[] = [],
  ) {
    this.#attached = attached;
    this.#innerTextBlocks = innerTextBlocks;
  }

  get childNodes(): StubElement[] {
    return this.children;
  }

  get innerText(): string {
    // Layout semantics only when attached; detached behaves like textContent.
    if (!this.#attached()) {
      return this.textContent;
    }
    if (this.#innerTextBlocks.length > 0) {
      return this.#innerTextBlocks.join('\n');
    }
    // Containers derive innerText from their children's layout — Chromium
    // computes it from the render tree, so child blocks contribute.
    return this.layoutText();
  }

  /**
   * innerText of a container derives from its children: each block child
   * contributes its own innerText on its own line. Nodes with explicit blocks
   * report those; otherwise the recursive child join is used. Shadow-root
   * children render inside the host (composed tree), mirroring Chromium.
   * This mirrors how Chromium computes innerText for attached elements.
   */
  layoutText(): string {
    if (this.nodeType !== 1) {
      return this.textContent;
    }
    if (this.#innerTextBlocks.length > 0) {
      return this.#innerTextBlocks.join('\n');
    }
    const parts: string[] = [];
    for (const child of this.children) {
      const text =
        child.nodeType !== 1
          ? child.textContent // text node
          : child.layoutText();
      if (text.length > 0) {
        parts.push(text);
      }
    }
    if (this.shadowRoot !== null) {
      for (const child of this.shadowRoot.children) {
        const text =
          child.nodeType !== 1
            ? child.textContent // text node
            : child.layoutText();
        if (text.length > 0) {
          parts.push(text);
        }
      }
    }
    if (parts.length === 0) {
      return this.textContent;
    }
    return parts.join('\n');
  }

  replaceChildren(...kids: StubElement[]): void {
    for (const child of this.children) {
      child.parent = null;
    }
    this.children = [];
    for (const kid of kids) {
      this.appendChild(kid);
    }
  }

  querySelectorAll(selector: string): StubElement[] {
    const matches: StubElement[] = [];
    const visit = (node: StubElement): void => {
      for (const child of node.children) {
        if (matchesSelector(child, selector)) {
          matches.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  querySelector(selector: string): StubElement | undefined {
    return this.querySelectorAll(selector)[0];
  }

  closest(selector: string): StubElement | null {
    let node: StubElement | null = this;
    while (node !== null) {
      if (matchesSelector(node, selector)) {
        return node;
      }
      node = node.parent;
    }
    return null;
  }

  appendChild(child: StubElement): StubElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  append(...kids: StubElement[]): void {
    for (const kid of kids) {
      this.appendChild(kid);
    }
  }

  remove(): void {
    if (this.parent !== null) {
      const index = this.parent.children.indexOf(this);
      if (index >= 0) {
        this.parent.children.splice(index, 1);
      }
      this.parent = null;
    }
  }

  focus(): void {}

  dispatchEvent(): void {
    // Accept input/keydown events without behavior.
  }

  click(): void {}

  cloneNode(): StubElement {
    const copy = new StubElement(this.#attached, this.#innerTextBlocks);
    copy.id = this.id;
    copy.className = this.className;
    copy.tagName = this.tagName;
    copy.disabled = this.disabled;
    copy.textContent = this.textContent;
    copy.parent = null;
    // Chromium semantics: cloneNode(true) does NOT copy shadow roots. This is
    // exactly why clone-based extraction reads empty on shadow-DOM variants.
    for (const child of this.children) {
      copy.appendChild(child.cloneNode());
    }
    return copy;
  }

  getClientRects(): unknown[] {
    return [{}];
  }

  /** True when this node is an ancestor of (or is) the given node. */
  contains(node: StubElement | null): boolean {
    let current: StubElement | null = node;
    while (current !== null) {
      if (current === this) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  /**
   * Attach the element's textContent as a text-node child (nodeType 3), the
   * way real DOM represents text. Text-node stubs are leaf objects that only
   * need nodeType + textContent for the capture walk.
   */
  withTextNode(): this {
    if (this.textContent.length > 0 && this.children.length === 0) {
      const textNode = {
        nodeType: 3,
        textContent: this.textContent,
      } as unknown as StubElement;
      textNode.parent = this;
      this.children.push(textNode);
    }
    return this;
  }

  /** Swap the innerText block source (used to model collapse-on-strip). */
  setInnerTextBlocks(blocks: readonly string[]): void {
    this.#innerTextBlocks = blocks;
  }
}

function matchesSelector(node: StubElement, selector: string): boolean {
  const parts = selector.split(',').map((part) => part.trim());
  return parts.some((part) => {
    if (part.startsWith('#')) {
      return node.id === part.slice(1);
    }
    if (part.startsWith('.')) {
      return node.className.split(/\s+/).includes(part.slice(1));
    }
    if (part.startsWith('[')) {
      return false;
    }
    // Compound selectors like "textarea.message-input-textarea" or
    // "button#stop-message-button": tag + class/id constraints.
    const tagMatch = /^([a-zA-Z]+)([.#].*)?$/.exec(part);
    if (tagMatch) {
      const tagOk = node.tagName === tagMatch[1]!.toUpperCase();
      const rest = tagMatch[2];
      if (!tagOk) {
        return false;
      }
      if (rest === undefined || rest.length === 0) {
        return true;
      }
      if (rest.startsWith('.')) {
        return node.className.split(/\s+/).includes(rest.slice(1));
      }
      if (rest.startsWith('#')) {
        return node.id === rest.slice(1);
      }
      return false;
    }
    if (part === 'p' || part === 'textarea' || part === 'button' || part === 'div') {
      return node.tagName === part.toUpperCase();
    }
    return false;
  });
}

interface StubDocument {
  body: StubElement;
  documentElement: StubElement;
  getElementById(id: string): StubElement | undefined;
  querySelector(selector: string): StubElement | undefined;
  querySelectorAll(selector: string): StubElement[];
  createElement(tag: string): StubElement;
}

function makeDocument(): StubDocument & { root: StubElement } {
  const root = new StubElement(() => true);
  const document: StubDocument & { root: StubElement } = {
    root,
    body: root,
    documentElement: root,
    getElementById(id: string) {
      const found = root.querySelectorAll(`#${id}`)[0];
      return found;
    },
    querySelector(selector: string) {
      return root.querySelector(selector);
    },
    querySelectorAll(selector: string) {
      return root.querySelectorAll(selector);
    },
    createElement(tag: string) {
      return new StubElement(() => true);
    },
  };
  return document;
}

/** Evaluate a page script string against the stub globals. */
function loadPageScript(
  script: string,
  document: StubDocument,
): Record<string, any> {
  const factory = new Function(`return (${script});`) as () => Record<
    string,
    any
  >;
  const styleStub = { display: 'block', visibility: 'visible' };
  const getComputedStyle = () => styleStub;
  const globals: Record<string, unknown> = {
    document,
    window: {
      document,
      getComputedStyle,
      HTMLTextAreaElement: { prototype: { value: {} } },
    },
    HTMLTextAreaElement: { prototype: { value: {} } },
    KeyboardEvent: class {
      key: string;
      bubbles: boolean;
      constructor(init: { key: string; bubbles?: boolean } = { key: '' }) {
        this.key = init.key;
        this.bubbles = init.bubbles ?? false;
      }
    },
    Event: class {
      type: string;
      bubbles: boolean;
      constructor(type: string, init: { bubbles?: boolean } = {}) {
        this.type = type;
        this.bubbles = init.bubbles ?? false;
      }
    },
    location: { href: 'https://chat.z.ai/' },
    MutationObserver: class {
      observe(): void {}
      disconnect(): void {}
    },
    requestAnimationFrame: (cb: (t: number) => void) =>
      setTimeout(() => cb(0), 0),
    getComputedStyle,
  };
  for (const [key, value] of Object.entries(globals)) {
    (globalThis as Record<string, unknown>)[key] = value;
  }
  return factory();
}

function el(
  document: StubDocument,
  options: {
    id?: string;
    className?: string;
    tag?: string;
    disabled?: boolean;
    blocks?: readonly string[];
  } = {},
): StubElement {
  const node = new StubElement(
    () => document.body.children.includes(node) || document.body === node,
    options.blocks ?? [],
  );
  node.id = options.id ?? '';
  node.className = options.className ?? '';
  node.tagName = (options.tag ?? 'div').toUpperCase();
  node.disabled = options.disabled ?? false;
  return node;
}

describe('managed page scripts', () => {
  it('are syntactically valid and expose the capture API', () => {
    for (const [name, script] of Object.entries({ glmPageScript, qwenPageScript })) {
      const document = makeDocument();
      const api = loadPageScript(script, document);
      for (const method of [
        'probe',
        'createNewChat',
        'sendPrompt',
        'snapshot',
        'observe',
        'waitForDomChange',
      ]) {
        assert.equal(typeof api[method], 'function', `${name}.${method} exists`);
      }
    }
  });

  it('GLM: exposes per-turn stop tracking state', () => {
    const api = loadPageScript(glmPageScript, makeDocument());
    assert.equal(api.__rayzanTurnCount, -1);
    assert.equal(api.__rayzanSawStop, false);
    assert.equal(api.__rayzanStopAbsentAt, 0);
  });

  it('GLM: keeps generating true right after the Stop control flickers off', async () => {
    const document = makeDocument();
    const api = loadPageScript(glmPageScript, document);

    const stop = el(document, { id: 'stop-message-button', tag: 'button' });
    document.body.appendChild(stop);
    const turn = el(document, {
      className: 'chat-assistant',
      blocks: ['Security Analysis: Hidden Access Paths', 'Summary: backdoors exist'],
    });
    document.body.appendChild(turn);

    // First read: stop visible → sawStop latches true.
    const during = api.snapshot();
    assert.equal(during.generating, true);

    // Stop flickers off while text keeps streaming: still generating.
    stop.remove();
    const flicker = api.snapshot();
    assert.equal(
      flicker.generating,
      true,
      'stop flicker must not end generation within the stable-read interval',
    );

    // After the stable interval the flicker resolves to not-generating.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const after = api.snapshot();
    assert.equal(after.generating, false);
  });

  it('GLM: attached clone preserves block boundaries', () => {
    const document = makeDocument();
    const api = loadPageScript(glmPageScript, document);
    const turn = el(document, {
      className: 'chat-assistant',
      blocks: ['Configurations', 'Summary: ok'],
    });
    document.body.appendChild(turn);

    const snap = api.snapshot();
    assert.match(snap.last, /Configurations\s*\n+\s*Summary:/);
    assert.ok(!snap.last.includes('ConfigurationsSummary:'), 'blocks must not fuse');
  });

  it('GLM: collapse wrapping the whole reply still yields the answer', () => {
    const document = makeDocument();
    const api = loadPageScript(glmPageScript, document);

    // GLM 5.3 shape: .chat-assistant contains ONLY a
    // .thinking-chain-container, which itself holds the reasoning AND the
    // final answer. Stripping the container leaves an empty clone; the
    // unstripped clone carries the answer.
    //
    //   <div class="chat-assistant">
    //     <div class="thinking-chain-container my-4">
    //       <div class="thinking-content">reasoning…</div>
    //       <div class="markdown-prose"><p>The actual answer</p></div>
    //     </div>
    //   </div>
    const turn = el(document, { className: 'chat-assistant' });
    const collapse = el(document, { className: 'thinking-chain-container my-4' });
    const reasoning = el(document, { className: 'thinking-content' });
    reasoning.textContent = 'reasoning…';
    const prose = el(document, { className: 'markdown-prose' });
    const answerParagraph = el(document, { tag: 'p' });
    answerParagraph.textContent = 'The actual answer';
    prose.appendChild(answerParagraph);
    collapse.append(reasoning, prose);
    turn.appendChild(collapse);
    document.body.appendChild(turn);

    // The prose renders its paragraph text; the reasoning div renders its
    // text. The collapse and turn have no explicit blocks — their innerText
    // derives from children, so after the script strips the collapse (or the
    // reasoning body within it) the text changes accordingly (the old bug
    // left an empty stripped read).
    reasoning.setInnerTextBlocks(['reasoning…']);
    prose.setInnerTextBlocks(['The actual answer']);

    const snap = api.snapshot();
    const turn0 = snap.turns[0]!;
    assert.equal(turn0.finalText, 'The actual answer');
    assert.equal(turn0.hasFinalAnswer, true);
    assert.equal(turn0.thinkingOnly, false);
    assert.equal(snap.last, 'The actual answer');
  });

  it('GLM: shadow-root answer is captured via the text walk (tier 3)', () => {
    const document = makeDocument();
    const api = loadPageScript(glmPageScript, document);

    // Managed renderer shape: chat.z.ai's shadow-DOM variant. The
    // .chat-assistant host has an OPEN shadow root holding the answer and an
    // empty light DOM. cloneNode(true) does not copy shadow roots, so tiers
    // 1 and 2 read empty on every clone; only the original-element walk (tier
    // 3) sees the text. The reasoning subtree inside the shadow root is
    // skipped by class.
    //
    //   <div class="chat-assistant">          ← light DOM empty
    //     #shadowRoot (open)
    //       <div class="thinking-chain-container my-4">
    //         <div class="collapse-body">Thought Process… cobalt reasoning</div>
    //       </div>
    //       <p class="answer">cobalt</p>
    //   </div>
    const turn = el(document, { className: 'chat-assistant' });
    const shadow = el(document, {});
    shadow.tagName = '#DOCUMENT-FRAGMENT';
    shadow.nodeType = 11; // SHADOW_ROOT-like fragment
    const collapse = el(document, { className: 'thinking-chain-container my-4' });
    const reasoningBody = el(document, { className: 'collapse-body' });
    reasoningBody.textContent = 'Thought Process: the user asked about the mineral…';
    reasoningBody.withTextNode();
    collapse.appendChild(reasoningBody);
    const answer = el(document, { className: 'answer', tag: 'p' });
    answer.textContent = 'cobalt';
    answer.withTextNode();
    shadow.append(collapse, answer);
    turn.shadowRoot = shadow;
    document.body.appendChild(turn);

    const snap = api.snapshot();
    const turn0 = snap.turns[0]!;
    assert.equal(turn0.finalText, 'cobalt');
    assert.equal(turn0.hasFinalAnswer, true);
    assert.equal(turn0.thinkingOnly, false);
    assert.equal(snap.last, 'cobalt');

    // Diagnostics: clones empty (shadow roots not copied), tier-3 walk got
    // the answer, shadow detected at depth 1. rawTextLen (light-DOM
    // textContent) is 0 while rawLen > 0 — the definitive shadow-only
    // signature. rawLen (composed innerText on the original) includes the
    // reasoning body too, just as Chromium renders it.
    const debug = turn0.__rayzanDebug!;
    assert.equal(debug.t1Len, 0);
    assert.equal(debug.t2Len, 0);
    assert.equal(debug.t3Len, 'cobalt'.length);
    assert.ok(debug.rawLen > 'cobalt'.length, 'composed innerText includes reasoning + answer');
    assert.equal(debug.rawTextLen, 0);
    assert.equal(debug.shadowRootDepth, 1);
  });

  it('Qwen: sendPrompt throws when the submit never takes effect', async () => {
    const document = makeDocument();
    const api = loadPageScript(qwenPageScript, document);
    const field = el(document, { className: 'message-input-textarea', tag: 'textarea' });
    field.textContent = 'hello';
    document.body.appendChild(field);
    api.snapshot = () => ({ count: 0, last: '', generating: false, turns: [] });
    await assert.rejects(api.sendPrompt('hello'), /Qwen submit did not take effect/);
  });

  it('Qwen: sendPrompt succeeds when the composer clears', async () => {
    const document = makeDocument();
    const api = loadPageScript(qwenPageScript, document);
    let reads = 0;
    const field = el(document, { className: 'message-input-textarea', tag: 'textarea' });
    document.body.appendChild(field);
    Object.defineProperty(field, 'textContent', {
      get: () => (reads <= 1 ? 'hello' : ''),
      configurable: true,
    });
    api.snapshot = () => {
      reads += 1;
      return reads <= 1
        ? { count: 0, last: '', generating: false, turns: [] }
        : { count: 1, last: '', generating: false, turns: [] };
    };
    const result = await api.sendPrompt('hello');
    assert.equal(result.ok, true);
    assert.ok(['click', 'enter'].includes(result.via));
  });
});
