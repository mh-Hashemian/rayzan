/** Page scripts run inside provider webContents via executeJavaScript. */

export const chatgptPageScript = `
(() => {
  const isChromeLabel = (text) => /^(ChatGPT|Assistant)\\s*said:?\\s*$/i.test(text.trim());
  const api = {
    probe() {
      const composer =
        document.querySelector('#prompt-textarea[contenteditable="true"]') ||
        document.querySelector('[contenteditable="true"]#prompt-textarea') ||
        document.querySelector('#prompt-textarea') ||
        document.querySelector('[contenteditable="true"][data-testid="prompt-textarea"]') ||
        document.querySelector('div.ProseMirror[contenteditable="true"]');
      const shellHints = Boolean(
        document.querySelector('[data-testid="profile-button"]') ||
          document.querySelector('button[data-testid="profile-button"]') ||
          document.querySelector('a[data-testid="create-new-chat-button"]') ||
          document.querySelector('button[data-testid="create-new-chat-button"]') ||
          document.querySelector('[data-testid="composer"]') ||
          document.querySelector('#composer-submit-button') ||
          document.querySelector('[data-testid="send-button"]') ||
          document.querySelector('nav a[href="/"]') ||
          document.querySelector('[data-testid="history-item"]')
      );
      const loginText = [...document.querySelectorAll('button, a')].some((el) =>
        /^(log in|sign in)$/i.test((el.textContent || '').trim())
      );
      const authUrl = /\\/(auth|login|signin)/i.test(location.pathname);
      const onProductHost = /^(chatgpt\\.com|chat\\.openai\\.com)$/i.test(location.hostname);
      const send = document.querySelector(
        '#composer-submit-button[data-testid="send-button"], button[data-testid="send-button"][aria-label="Send prompt"]'
      );
      const stop = document.querySelector(
        'button[data-testid="stop-button"], #composer-submit-button[data-testid="stop-button"]'
      );
      // Prefer positive chrome over login CTAs — marketing pages also say "Log in".
      const loggedIn =
        !authUrl &&
        onProductHost &&
        (Boolean(composer) || shellHints || (Boolean(send) && !loginText));
      return {
        loggedIn,
        needsLogin: !loggedIn && (loginText || authUrl),
        hasComposer: Boolean(composer),
        hasSend: Boolean(send && !send.disabled),
        generating: Boolean(stop),
        url: location.href,
        title: document.title,
      };
    },
    async createNewChat() {
      const selectors = [
        'a[data-testid="create-new-chat-button"]',
        'button[data-testid="create-new-chat-button"]',
        'a[href="/"]',
        'a[href="https://chatgpt.com/"]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          el.click();
          await new Promise((r) => setTimeout(r, 800));
          return { ok: true, via: sel, url: location.href };
        }
      }
      location.href = 'https://chatgpt.com/';
      return { ok: true, via: 'navigate-home', url: location.href };
    },
    async sendPrompt(text) {
      const send = globalThis.__rayzanChatGptSend;
      if (!send || typeof send.sendChatGptPrompt !== 'function') {
        throw new Error('ChatGPT shared send helpers were not injected');
      }
      return send.sendChatGptPrompt(text, {
        onProgress(ev) {
          try {
            console.log('[rayzan-send]' + JSON.stringify(ev));
          } catch (_) {}
        },
      });
    },
    snapshot() {
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          el.getClientRects().length > 0
        );
      };
      const identityOf = (el, index) => {
        for (const name of ['data-message-id', 'data-msgid', 'data-messageid', 'data-id', 'data-turn-id', 'data-unique-id']) {
          const value = (el.getAttribute(name) || '').trim();
          if (value) return name + ':' + value;
        }
        const id = (el.getAttribute('id') || '').trim();
        if (id && !/^ember|react|aria/.test(id)) return 'id:' + id;
        return 'idx:' + index;
      };
      let turns = [...document.querySelectorAll(
        '[data-turn="assistant"], [data-testid^="conversation-turn-"][data-turn="assistant"]'
      )].filter((el) => el.getAttribute('data-turn') === 'assistant');
      if (turns.length === 0) {
        turns = [...document.querySelectorAll('[data-message-author-role="assistant"]')].filter(
          (el) => el.parentElement?.closest('[data-message-author-role]') === null
        );
      }
      const mapped = turns.map((el, index) => {
        const clone = el.cloneNode(true);
        for (const t of clone.querySelectorAll(
          '[data-testid="thoughts"], [data-testid="thought-process"], [data-testid="reasoning-summary"], .result-thinking, [data-testid="author"]'
        )) {
          t.remove();
        }
        const md =
          clone.querySelector('.markdown') ||
          clone.querySelector('[data-message-author-role="assistant"]') ||
          clone;
        let text = (md.innerText || '').trim();
        text = text.replace(/^ChatGPT said:\\s*/i, '').trim();
        if (!text || isChromeLabel(text)) text = '';
        const thinking = el.querySelector(
          '[data-testid="thoughts"], [data-testid="thought-process"], [data-testid="reasoning-summary"], .result-thinking'
        );
        const hasFinalAnswer = text.length > 0;
        return {
          identity: identityOf(el, index),
          thinkingOnly: Boolean(thinking) && !hasFinalAnswer,
          hasFinalAnswer,
          finalText: text,
        };
      });
      const stop = [
        ...document.querySelectorAll(
          'button[data-testid="stop-button"], #composer-submit-button[data-testid="stop-button"], button[aria-label="Stop streaming"], button[aria-label="Stop generating"], button[aria-label="Stop"]'
        ),
      ].find((el) => {
        if (!isVisible(el)) return false;
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        if (/voice|send/.test(aria)) return false;
        return el.getAttribute('data-testid') === 'stop-button' || /stop/.test(aria);
      });
      const withText = mapped.filter((t) => t.finalText.length > 0 || t.thinkingOnly);
      return {
        count: withText.length,
        last: withText[withText.length - 1]?.finalText || '',
        generating: Boolean(stop),
        turns: mapped,
      };
    },
    observe() {
      return this.snapshot();
    },
    // Browser-scheduling settle for the capture terminal boundary: after the
    // generation control disappears, ChatGPT may still commit final assistant
    // content in later render frames. Wait for paint boundaries plus a quiet
    // mutation check — never a fixed delay.
    async readSettledTurn() {
      const frames = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      let settled = this.snapshot();
      for (let i = 0; i < 4; i += 1) {
        let mutated = false;
        const mo = new MutationObserver(() => {
          mutated = true;
        });
        mo.observe(document.documentElement, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
        });
        await frames();
        mo.disconnect();
        const next = this.snapshot();
        const changed =
          mutated ||
          next.last !== settled.last ||
          next.count !== settled.count ||
          next.generating !== settled.generating;
        settled = next;
        if (!changed) break;
      }
      return settled;
    },
    waitForDomChange(timeoutMs) {
      const ms = typeof timeoutMs === 'number' ? timeoutMs : 250;
      return new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          try { mo.disconnect(); } catch (_) {}
          clearTimeout(timer);
          resolve(api.observe());
        };
        const mo = new MutationObserver(() => finish());
        mo.observe(document.documentElement, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
        });
        const timer = setTimeout(finish, ms);
      });
    },
  };
  return api;
})()
`;

export const deepseekPageScript = `
(() => {
  const api = {
    probe() {
      const field =
        document.querySelector('textarea[placeholder="Message DeepSeek"]') ||
        document.querySelector('textarea[placeholder*="DeepSeek" i]') ||
        document.querySelector('textarea[placeholder*="Send a message" i]') ||
        document.querySelector('textarea[class*="chat"]');
      const chatShell = Boolean(
        document.querySelector('.ds-message') ||
          document.querySelector('[class*="ds-"] textarea') ||
          document.querySelector('textarea[placeholder*="DeepSeek" i]')
      );
      const loginText = [...document.querySelectorAll('button, a')].some((el) =>
        /^(log in|sign in|login)$/i.test((el.textContent || '').trim())
      );
      const send = document.querySelector('.ds-button.ds-button--primary.ds-button--circle');
      const thinkingOnly = (() => {
        const msgs = [...document.querySelectorAll('.ds-message')].filter((el) =>
          el.querySelector('.ds-assistant-message-main-content, .ds-think-content')
        );
        const last = msgs[msgs.length - 1];
        if (!last) return false;
        const hasMain = last.querySelector('.ds-assistant-message-main-content');
        const thinking = last.querySelector('.ds-think-content');
        return Boolean(thinking && !hasMain);
      })();
      // Avoid treating a generic login-page <textarea> as signed-in.
      const loggedIn = Boolean(field) || (chatShell && !loginText);
      return {
        loggedIn,
        needsLogin: !loggedIn && loginText,
        hasComposer: Boolean(field),
        hasSend: Boolean(send && !send.classList.contains('ds-button--disabled')),
        generating: thinkingOnly,
        url: location.href,
        title: document.title,
      };
    },
    async createNewChat() {
      const el = [...document.querySelectorAll('div[role="button"], button, a')].find((node) =>
        /new chat|新对话|新建/i.test(node.textContent || '')
      );
      if (el) {
        el.click();
        await new Promise((r) => setTimeout(r, 800));
        return { ok: true, via: 'button-text', url: location.href };
      }
      location.href = 'https://chat.deepseek.com/';
      return { ok: true, via: 'navigate-home', url: location.href };
    },
    async sendPrompt(text) {
      const t0 = performance.now();
      const stages = {};
      const mark = (n) => { stages[n] = Math.round(performance.now() - t0); };
      mark('start');
      // Prefer fast replies for Coordinator JSON jobs — DeepThink can sit for
      // many minutes on large evidence packs and never surface main content.
      const disableDeepThink = () => {
        const candidates = [...document.querySelectorAll(
          'button, div[role="button"], label, [class*="switch"], [class*="toggle"]'
        )];
        for (const el of candidates) {
          const label = (
            (el.textContent || '') +
            ' ' +
            (el.getAttribute('aria-label') || '') +
            ' ' +
            (el.getAttribute('title') || '')
          ).trim();
          if (!/deep.?think|深度思考|R1|reason(ing)?/i.test(label)) continue;
          const pressed =
            el.getAttribute('aria-pressed') === 'true' ||
            el.getAttribute('aria-checked') === 'true' ||
            /active|selected|on|checked|enabled/i.test(el.className || '');
          if (pressed) el.click();
        }
      };
      disableDeepThink();
      await new Promise((r) => setTimeout(r, 80));
      disableDeepThink();
      mark('deepThinkDisabled');
      const field =
        document.querySelector('textarea[placeholder="Message DeepSeek"]') ||
        document.querySelector('textarea[placeholder*="DeepSeek" i]') ||
        document.querySelector('textarea[name="search"]') ||
        document.querySelector('textarea');
      if (!field) throw new Error('DeepSeek composer not found');
      mark('composerFound');
      field.focus();
      mark('composerFocused');
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set;
      if (setter) setter.call(field, text);
      else field.value = text;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      mark('textInserted');
      await new Promise((r) => setTimeout(r, 120));
      mark('postInsertDelay120');
      const send = document.querySelector(
        '.ds-button.ds-button--primary.ds-button--circle:not(.ds-button--disabled)'
      );
      if (send) {
        send.click();
        stages.submitVia = 'click';
        mark('sendTriggered');
      } else {
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        stages.submitVia = 'enter';
        mark('sendTriggered');
      }
      return { ok: true, stages };
    },
    stopGeneration() {
      const stop = [...document.querySelectorAll('button, .ds-icon-button')].find(
        (el) => /stop/i.test(el.getAttribute('aria-label') || el.textContent || '')
      );
      if (stop) {
        stop.click();
        return { ok: true };
      }
      return { ok: false };
    },
    snapshot() {
      const stopVisible = Boolean(
        document.querySelector(
          'button[aria-label*="Stop" i], button[aria-label*="Stop generating" i], .ds-icon-button[aria-label*="Stop" i]'
        ) ||
          [...document.querySelectorAll('button, .ds-icon-button')].some((el) =>
            /stop generating|^stop$/i.test(
              (el.getAttribute('aria-label') || el.textContent || '').trim()
            )
          )
      );
      const msgs = [...document.querySelectorAll('.ds-message')].filter((el) =>
        el.querySelector('.ds-assistant-message-main-content, .ds-think-content')
      );
      const texts = msgs
        .map((el) => {
          const main = el.querySelector('.ds-assistant-message-main-content');
          const mainText = (main ? main.innerText : '').trim();
          if (mainText) return mainText;
          // DeepSeek R1 sometimes leaves the finished answer only in think
          // content after Stop disappears — still capture it for JSON jobs.
          // Also allow salvage while Stop is visible once think text looks
          // like a complete JSON object (bail path stops generation first).
          const think = el.querySelector('.ds-think-content');
          const thinkText = (think ? think.innerText : '').trim();
          if (
            thinkText &&
            (thinkText.includes('{') ||
              thinkText.includes(String.fromCharCode(96, 96, 96)) ||
              thinkText.length > 40)
          ) {
            if (!stopVisible) return thinkText;
            try {
              const start = thinkText.indexOf('{');
              const end = thinkText.lastIndexOf('}');
              if (start >= 0 && end > start) {
                JSON.parse(thinkText.slice(start, end + 1));
                return thinkText;
              }
            } catch {
              /* still streaming */
            }
          }
          return '';
        })
        .filter(Boolean);
      const last = msgs[msgs.length - 1];
      const thinking = last?.querySelector('.ds-think-content');
      const hasMain = Boolean(
        (last?.querySelector('.ds-assistant-message-main-content')?.innerText || '').trim()
      );
      const lastText = texts[texts.length - 1] || '';
      return {
        count: texts.length,
        last: lastText,
        generating:
          stopVisible || Boolean(thinking && !hasMain && !lastText),
        turns: msgs.map((el, index) => {
          const main = el.querySelector('.ds-assistant-message-main-content');
          const mainText = (main ? main.innerText : '').trim();
          const think = el.querySelector('.ds-think-content');
          const finalText = mainText || texts[index] || '';
          const hasFinalAnswer = finalText.length > 0;
          return {
            identity: 'idx:' + index,
            thinkingOnly: Boolean(think) && !hasFinalAnswer,
            hasFinalAnswer,
            finalText,
          };
        }),
      };
    },
    observe() {
      return this.snapshot();
    },
    waitForDomChange(timeoutMs) {
      const ms = typeof timeoutMs === 'number' ? timeoutMs : 250;
      return new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          try { mo.disconnect(); } catch (_) {}
          clearTimeout(timer);
          resolve(api.observe());
        };
        const mo = new MutationObserver(() => finish());
        mo.observe(document.documentElement, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
        });
        const timer = setTimeout(finish, ms);
      });
    },
  };
  return api;
})()
`;

export const qwenPageScript = `
(() => {
  const api = {
    probe() {
      const field = document.querySelector(
        'textarea.message-input-textarea, textarea[placeholder*="Message" i], textarea[placeholder*="Ask Qwen" i]'
      );
      const shell = Boolean(
        document.querySelector('.qwen-chat-message-assistant, [class*="qwen-chat-message-assistant"]') ||
          field
      );
      const loginText = [...document.querySelectorAll('button, a')].some((el) =>
        /^(log in|sign in|login)$/i.test((el.textContent || '').trim())
      );
      const send = document.querySelector(
        '.message-input-right-button-send button.send-button[aria-label="Send"], button.send-button[aria-label="Send"], button[aria-label="Send"]'
      );
      const stop = document.querySelector(
        '.stop-button, button[aria-label="Stop"], button[aria-label*="Stop" i]'
      );
      const loggedIn = Boolean(field) || (shell && !loginText);
      return {
        loggedIn,
        needsLogin: !loggedIn && loginText,
        hasComposer: Boolean(field),
        hasSend: Boolean(send && !send.disabled),
        generating: Boolean(stop),
        url: location.href,
        title: document.title,
      };
    },
    async createNewChat() {
      const el = [...document.querySelectorAll('button, a, div[role="button"]')].find((node) =>
        /new chat|new conversation|新对话/i.test(node.textContent || '')
      );
      if (el) {
        el.click();
        await new Promise((r) => setTimeout(r, 800));
        return { ok: true, via: 'button-text', url: location.href };
      }
      location.href = 'https://chat.qwen.ai/';
      return { ok: true, via: 'navigate-home', url: location.href };
    },
    async sendPrompt(text) {
      const field = document.querySelector(
        'textarea.message-input-textarea, textarea[placeholder*="Message" i], textarea[placeholder*="Ask Qwen" i]'
      );
      if (!field) throw new Error('Qwen composer not found');
      field.focus();
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set;
      if (setter) setter.call(field, text);
      else field.value = text;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
      const send = document.querySelector(
        '.message-input-right-button-send button.send-button[aria-label="Send"], button.send-button[aria-label="Send"], button[aria-label="Send"]'
      );
      if (send && !send.disabled) send.click();
      else field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return { ok: true };
    },
    snapshot() {
      const turns = [...document.querySelectorAll(
        '.qwen-chat-message-assistant, [class*="qwen-chat-message-assistant"]'
      )];
      const stop = [...document.querySelectorAll(
        '.stop-button, button[aria-label="Stop"], button[aria-label*="Stop" i]'
      )].some((el) => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
      });
      const mapped = turns.map((el, index) => {
        const answer = el.querySelector(
          '.response-message-content.phase-answer, .response-message-content'
        );
        let text = ((answer ? answer.innerText : '') || '').trim();
        if (!text && !stop) text = (el.innerText || '').trim();
        if (stop && !text) text = '';
        const hasFinalAnswer = text.length > 0;
        return {
          identity: 'idx:' + index,
          thinkingOnly: false,
          hasFinalAnswer,
          finalText: text,
        };
      });
      return {
        count: mapped.filter((t) => t.finalText).length,
        last: mapped.filter((t) => t.finalText).at(-1)?.finalText || '',
        generating: stop,
        turns: mapped,
      };
    },
    observe() {
      return this.snapshot();
    },
    waitForDomChange(timeoutMs) {
      const ms = typeof timeoutMs === 'number' ? timeoutMs : 250;
      return new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          try { mo.disconnect(); } catch (_) {}
          clearTimeout(timer);
          resolve(api.observe());
        };
        const mo = new MutationObserver(() => finish());
        mo.observe(document.documentElement, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
        });
        const timer = setTimeout(finish, ms);
      });
    },
  };
  return api;
})()
`;

export const glmPageScript = `
(() => {
  const api = {
    probe() {
      const field = document.querySelector('#chat-input, textarea#chat-input');
      const shell = Boolean(
        document.querySelector('.chat-assistant, [class*="chat-assistant"]') || field
      );
      const loginText = [...document.querySelectorAll('button, a')].some((el) =>
        /^(log in|sign in|login)$/i.test((el.textContent || '').trim())
      );
      const send = document.querySelector('#send-message-button');
      const stop = document.querySelector(
        '#stop-message-button, button[aria-label="Stop"], button[aria-label="Stop generating"], .stopGeneratingButton'
      );
      const loggedIn = Boolean(field) || (shell && !loginText);
      return {
        loggedIn,
        needsLogin: !loggedIn && loginText,
        hasComposer: Boolean(field),
        hasSend: Boolean(send && !send.disabled),
        generating: Boolean(stop),
        url: location.href,
        title: document.title,
      };
    },
    async createNewChat() {
      const el = [...document.querySelectorAll('button, a, div[role="button"]')].find((node) =>
        /new chat|new conversation|新对话|新建/i.test(node.textContent || '')
      );
      if (el) {
        el.click();
        await new Promise((r) => setTimeout(r, 800));
        return { ok: true, via: 'button-text', url: location.href };
      }
      location.href = 'https://chat.z.ai/';
      return { ok: true, via: 'navigate-home', url: location.href };
    },
    async sendPrompt(text) {
      const field = document.querySelector('#chat-input, textarea#chat-input');
      if (!field) throw new Error('GLM composer not found');
      field.focus();
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set;
      if (setter) setter.call(field, text);
      else field.value = text;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
      const send = document.querySelector('#send-message-button');
      if (send && !send.disabled) send.click();
      else field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return { ok: true };
    },
    snapshot() {
      let turns = [...document.querySelectorAll('.chat-assistant')];
      if (turns.length === 0) {
        turns = [...document.querySelectorAll('[class*="chat-assistant"]')].filter(
          (el) => !el.closest('.user-message')
        );
      }
      const mapped = turns.map((el, index) => {
        const clone = el.cloneNode(true);
        for (const t of clone.querySelectorAll(
          '.thinking-chain-container, [class*="thinking-chain"], [class*="Thinking"]'
        )) {
          t.remove();
        }
        const text = (clone.innerText || '').trim();
        const thinking = el.querySelector(
          '.thinking-chain-container, [class*="thinking-chain"]'
        );
        const hasFinalAnswer = text.length > 0;
        return {
          identity: 'idx:' + index,
          thinkingOnly: Boolean(thinking) && !hasFinalAnswer,
          hasFinalAnswer,
          finalText: text,
        };
      });
      const stopEl = [...document.querySelectorAll(
        '#stop-message-button, button[aria-label="Stop"], button[aria-label="Stop generating"], .stopGeneratingButton'
      )].find((el) => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
      });
      const send = document.querySelector('#send-message-button');
      const lastText = mapped.filter((t) => t.finalText).at(-1)?.finalText || '';
      // Match extension glmIsGenerating: a disabled Send with visible answer
      // text must NOT keep capture stuck in "generating".
      const sendDisabled = Boolean(send && send.disabled);
      const generating =
        Boolean(stopEl) ||
        Boolean(mapped.at(-1)?.thinkingOnly) ||
        (sendDisabled && lastText.length === 0);
      return {
        count: mapped.filter((t) => t.finalText || t.thinkingOnly).length,
        last: lastText,
        generating,
        turns: mapped,
      };
    },
    observe() {
      return this.snapshot();
    },
    waitForDomChange(timeoutMs) {
      const ms = typeof timeoutMs === 'number' ? timeoutMs : 250;
      return new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          try { mo.disconnect(); } catch (_) {}
          clearTimeout(timer);
          resolve(api.observe());
        };
        const mo = new MutationObserver(() => finish());
        mo.observe(document.documentElement, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
        });
        const timer = setTimeout(finish, ms);
      });
    },
  };
  return api;
})()
`;
