import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseHTML } from 'linkedom';

import {
  chatgptComposer,
  chatgptSendControl,
  chatgptSubmitAccepted,
  richComposerText,
  setRichComposerValue,
} from './index.js';

describe('shared ChatGPT send helpers', () => {
  it('fills contenteditable composer via setRichComposerValue', () => {
    const { document } = parseHTML(`<!doctype html><html><body>
      <div id="prompt-textarea" contenteditable="true"><p></p></div>
      <button data-testid="send-button" aria-label="Send prompt">Send</button>
    </body></html>`);
    // linkedom: attach document as global for helpers that read document.
    const previous = globalThis.document;
    (globalThis as { document: Document }).document = document as unknown as Document;
    try {
      const field = chatgptComposer();
      assert.ok(field);
      setRichComposerValue(field!, 'hello evidence');
      assert.equal(richComposerText(field), 'hello evidence');
      assert.ok(chatgptSendControl());
      assert.equal(chatgptSubmitAccepted(field!, 0), false);
      field!.replaceChildren();
      assert.equal(chatgptSubmitAccepted(field!, 0), true);
    } finally {
      (globalThis as { document?: Document }).document = previous;
    }
  });
});
