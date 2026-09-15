import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseHTML } from 'linkedom';

import { adapterFor } from '../src/adapters/index.js';
import {
  clickControl,
  trackedTurn,
  turnAfterSnapshot,
} from '../src/adapters/observe.js';
import {
  chatgptAdapter,
  chatgptAssistantTurns,
  chatgptExtract,
  chatgptIsGenerating,
  chatgptSendControl,
  chatgptStopControl,
} from '../src/adapters/chatgpt.js';
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
  glmStopControl,
  glmTurnAfterSnapshot,
} from '../src/adapters/glm.js';
import {
  qwenAdapter,
  qwenAssistantTurns,
  qwenExtract,
  qwenIsGenerating,
  qwenSendControl,
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
    assert.equal(adapterFor('https://chatgpt.com/').id, 'chatgpt');
    assert.equal(adapterFor('https://chatgpt.com/c/abc').id, 'chatgpt');
    assert.equal(adapterFor('https://chat.openai.com/').id, 'chatgpt');
    assert.equal(adapterFor('https://chat.qwen.ai/c/guest').id, 'qwen');
    assert.equal(adapterFor('https://chat.z.ai/c/abc').id, 'glm');
    assert.equal(chatgptAdapter.canHandle('https://chat.qwen.ai/'), false);
    assert.equal(fixtureAdapter.canHandle('https://chat.deepseek.com/'), false);
    assert.equal(
      deepSeekAdapter.canHandle('http://127.0.0.1:8787/fixture-chat'),
      false,
    );
    assert.equal(qwenAdapter.canHandle('https://chat.z.ai/c/abc'), false);
    assert.equal(glmAdapter.canHandle('https://chat.qwen.ai/'), false);
    assert.throws(() => adapterFor('https://claude.ai/'));
  });

  it('ChatGPT fixture: Voice is not Send; markdown is captured without thinking', () => {
    const voice = parseHTML(`<div>
      <div id="prompt-textarea" contenteditable="true"></div>
      <button type="button" class="composer-submit-btn composer-submit-button-color" aria-label="Start Voice"></button>
    </div>`).document;
    assert.equal(chatgptSendControl(voice), undefined);
    assert.equal(chatgptIsGenerating(voice), false);

    const sendReady = parseHTML(`<div>
      <div id="prompt-textarea" contenteditable="true"><p>probe</p></div>
      <button type="submit" id="composer-submit-button" aria-label="Send prompt" data-testid="send-button"></button>
    </div>`).document;
    assert.equal(
      chatgptSendControl(sendReady)?.getAttribute('aria-label'),
      'Send prompt',
    );

    const generating = parseHTML(`<div>
      <div data-message-author-role="assistant" data-message-id="msg-1">
        <div class="markdown">partial</div>
      </div>
      <button type="button" id="composer-submit-button" data-testid="stop-button" aria-label="Stop streaming"></button>
    </div>`).document;
    assert.equal(chatgptAssistantTurns(generating).length, 1);
    assert.equal(chatgptIsGenerating(generating), true);
    assert.equal(chatgptSendControl(generating), undefined);

    const leftoverStop = parseHTML(`<div>
      <div data-message-author-role="assistant" data-message-id="msg-1">
        <div class="markdown">Done answer</div>
      </div>
      <button data-testid="stop-button" hidden aria-label="Stop streaming"></button>
    </div>`).document;
    assert.equal(chatgptStopControl(leftoverStop), undefined);
    assert.equal(chatgptIsGenerating(leftoverStop), false);

    const streamingSection = parseHTML(`<div>
      <section data-testid="conversation-turn-2" data-turn="user" data-turn-id="u1"></section>
      <section data-testid="conversation-turn-3" data-turn="assistant" data-turn-id="a-new">
        <div class="markdown"></div>
      </section>
      <button id="composer-submit-button" data-testid="stop-button" aria-label="Stop streaming"></button>
    </div>`).document;
    assert.equal(chatgptAssistantTurns(streamingSection).length, 1);
    assert.equal(chatgptExtract(chatgptAssistantTurns(streamingSection)[0]), '');
    assert.equal(chatgptIsGenerating(streamingSection), true);

    const done = parseHTML(`<div>
      <div data-message-author-role="user" data-message-id="u1"><div class="markdown">user</div></div>
      <section data-testid="conversation-turn-3" data-turn="assistant" data-turn-id="a1">
        <div data-message-author-role="assistant" data-message-id="a1" data-turn-start-message="true">
          <div data-testid="thoughts">hidden reasoning</div>
          <div class="markdown prose">Final ChatGPT answer</div>
        </div>
      </section>
    </div>`).document;
    assert.equal(chatgptAssistantTurns(done).length, 1);
    assert.equal(
      chatgptExtract(chatgptAssistantTurns(done)[0]),
      'Final ChatGPT answer',
    );
    assert.equal(chatgptAdapter.providerLabel, 'ChatGPT');
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

    const mixed = parseHTML(`<div>
      <div class="ds-message"><div class="ds-assistant-message-main-content">assistant</div></div>
      <div class="d29f3d7d ds-message">user bubble</div>
    </div>`).document;
    assert.equal(deepSeekAssistantTurns(mixed).length, 1);
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

    const leftoverStop = parseHTML(`<div>
      <div class="qwen-chat-message qwen-chat-message-assistant">
        <div class="response-message-content t2t phase-answer">Hey there!</div>
      </div>
      <button class="stop-button" hidden aria-label="Stop"></button>
    </div>`).document;
    assert.equal(qwenIsGenerating(leftoverStop), false);

    const done =
      parseHTML(`<div class="qwen-chat-message qwen-chat-message-assistant">
      <div>Thinking completed</div>
      <div class="response-message-content t2t phase-answer">Hey there!</div>
    </div>`).document;
    assert.equal(qwenIsGenerating(done), false);
    assert.equal(qwenExtract(qwenAssistantTurns(done)[0]), 'Hey there!');

    const voice = parseHTML(`<div class="message-input-right-button-send">
      <div role="button" aria-label="Voice mode" class="omb__btn"></div>
    </div>`).document;
    assert.equal(qwenSendControl(voice), undefined);

    const sendReady = parseHTML(`<div class="message-input-right-button-send">
      <div class="chat-prompt-send-button">
        <button class="send-button" aria-label="Send"></button>
      </div>
    </div>`).document;
    assert.equal(
      qwenSendControl(sendReady)?.getAttribute('aria-label'),
      'Send',
    );

    const liveSend = sendReady.querySelector('button.send-button');
    assert.ok(liveSend);
    let reactClicks = 0;
    (
      liveSend as { __reactProps$test?: { onClick: () => void } }
    ).__reactProps$test = {
      onClick: () => {
        reactClicks += 1;
      },
    };
    clickControl(liveSend as HTMLElement);
    assert.equal(reactClicks, 1);
  });

  it('GLM fixture: extracts assistant text without the thinking chain', () => {
    const generating = parseHTML(`<div>
      <div class="chat-assistant markdown-prose"><p></p></div>
      <button id="send-message-button" disabled></button>
    </div>`).document;
    assert.equal(glmAssistantTurns(generating).length, 1);
    assert.equal(glmIsGenerating(generating), true);

    const leftoverStop = parseHTML(`<div>
      <div class="chat-assistant markdown-prose"><p>Pong from GLM</p></div>
      <button id="stop-message-button" hidden aria-label="Stop generating"></button>
    </div>`).document;
    assert.equal(glmStopControl(leftoverStop), undefined);
    assert.equal(glmIsGenerating(leftoverStop), false);

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

  it('tracks the new assistant turn and does not fall back to an older last message', () => {
    const root = parseHTML(`<div>
      <div class="qwen-chat-message-assistant"><div class="response-message-content phase-answer">old</div></div>
      <div class="qwen-chat-message-assistant"><div class="response-message-content phase-answer">new</div></div>
    </div>`).document;
    const turns = qwenAssistantTurns(root);
    assert.equal(qwenExtract(trackedTurn(turns, 1)), 'new');
    assert.equal(trackedTurn(turns, 2), undefined);
    const inplace = qwenAssistantTurns(
      parseHTML(
        `<div class="qwen-chat-message-assistant"><div class="response-message-content phase-answer">grown</div></div>`,
      ).document,
    );
    assert.equal(
      qwenExtract(turnAfterSnapshot(inplace, 1, 'old', qwenExtract)),
      'grown',
    );
  });
});
