import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseHTML } from 'linkedom';

import { adapterFor } from '../src/adapters/index.js';
import {
  deepSeekAdapter,
  deepSeekAssistantTurns,
  deepSeekExtract,
  deepSeekIsGenerating,
} from '../src/adapters/deepseek.js';
import { fixtureAdapter } from '../src/adapters/fixture.js';
import {
  glmAdapter,
  glmAssistantTurns,
  glmExtract,
  glmIsGenerating,
  glmTurnAfterSnapshot,
} from '../src/adapters/glm.js';
import {
  qwenAdapter,
  qwenAssistantTurns,
  qwenExtract,
  qwenIsGenerating,
} from '../src/adapters/qwen.js';

describe('browser adapters', () => {
  it('selects fixture vs providers by URL, not by Agent role', () => {
    assert.equal(
      adapterFor('http://127.0.0.1:8787/fixture-chat').id,
      'fixture',
    );
    assert.equal(
      adapterFor('https://chat.deepseek.com/a/chat/s/123').id,
      'deepseek',
    );
    assert.equal(adapterFor('https://chat.qwen.ai/c/guest').id, 'qwen');
    assert.equal(adapterFor('https://chat.z.ai/c/abc').id, 'glm');
    assert.equal(fixtureAdapter.canHandle('https://chat.deepseek.com/'), false);
    assert.equal(
      deepSeekAdapter.canHandle('http://127.0.0.1:8787/fixture-chat'),
      false,
    );
    assert.equal(qwenAdapter.canHandle('https://chat.z.ai/c/abc'), false);
    assert.equal(glmAdapter.canHandle('https://chat.qwen.ai/'), false);
    assert.throws(() => adapterFor('https://chat.openai.com/'));
  });

  it('DeepSeek fixture: tracks assistant turns and ignores thinking-only state', () => {
    const thinking = parseHTML(`<div class="ds-message">
      <div class="ds-think-content"><div class="ds-markdown">scratch</div></div>
    </div>`).document;
    assert.equal(deepSeekAssistantTurns(thinking).length, 1);
    assert.equal(deepSeekIsGenerating(thinking), true);

    const done = parseHTML(`<div class="ds-message">
      <div class="ds-think-content">thought</div>
      <div class="ds-markdown ds-assistant-message-main-content">Final DeepSeek answer</div>
    </div>`).document;
    assert.equal(deepSeekIsGenerating(done), false);
    assert.equal(
      deepSeekExtract(deepSeekAssistantTurns(done)[0]),
      'Final DeepSeek answer',
    );
  });

  it('Qwen fixture: Stop means generating; phase-answer is the captured text', () => {
    const generating = parseHTML(`<div>
      <div class="qwen-chat-message qwen-chat-message-assistant">
        <div class="response-message-content t2t">partial</div>
      </div>
      <button class="stop-button" aria-label="Stop"></button>
    </div>`).document;
    assert.equal(qwenAssistantTurns(generating).length, 1);
    assert.equal(qwenIsGenerating(generating), true);

    const done =
      parseHTML(`<div class="qwen-chat-message qwen-chat-message-assistant">
      <div>Thinking completed</div>
      <div class="response-message-content t2t phase-answer">Hey there!</div>
    </div>`).document;
    assert.equal(qwenIsGenerating(done), false);
    assert.equal(qwenExtract(qwenAssistantTurns(done)[0]), 'Hey there!');
  });

  it('GLM fixture: extracts assistant text without the thinking chain', () => {
    const generating = parseHTML(`<div>
      <div class="chat-assistant markdown-prose"><p></p></div>
      <button id="send-message-button" disabled></button>
    </div>`).document;
    assert.equal(glmAssistantTurns(generating).length, 1);
    assert.equal(glmIsGenerating(generating), true);

    const done = parseHTML(`<div class="chat-assistant markdown-prose">
      <div class="thinking-chain-container">Thought Process hidden</div>
      <p>Pong from GLM</p>
    </div>`).document;
    assert.equal(glmExtract(glmAssistantTurns(done)[0]), 'Pong from GLM');
    assert.equal(glmAdapter.providerLabel, 'GLM');

    const streaming = parseHTML(`<div>
      <div class="chat-assistant markdown-prose"><p>Independent Analysis: Circular</p></div>
      <button id="send-message-button" disabled></button>
    </div>`).document;
    assert.equal(glmIsGenerating(streaming), false);

    const finishedDisabledSend = parseHTML(`<div>
      <div class="chat-assistant markdown-prose"><p>Full finished GLM answer</p></div>
      <button id="send-message-button" disabled></button>
    </div>`).document;
    assert.equal(glmIsGenerating(finishedDisabledSend), false);

    const newerWithAnswer = parseHTML(`<div>
      <div class="chat-assistant markdown-prose"><p></p></div>
      <div class="chat-assistant markdown-prose"><p>Finished GLM answer</p></div>
    </div>`).document;
    assert.equal(
      glmExtract(glmTurnAfterSnapshot(0, newerWithAnswer)),
      'Finished GLM answer',
    );
  });
});
