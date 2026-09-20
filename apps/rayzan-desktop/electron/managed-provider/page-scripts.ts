/** Page scripts run inside provider webContents via executeJavaScript. */

export const chatgptPageScript = `
(() => {
  const isChromeLabel = (text) => /^(ChatGPT|Assistant)\\s*said:?\\s*$/i.test(text.trim());
  const api = {
    probe() {
      const composer =
        document.querySelector('#prompt-textarea[contenteditable="true"]') ||
        document.querySelector('[contenteditable="true"]#prompt-textarea') ||
        document.querySelector('#prompt-textarea');
      const shellHints = Boolean(
        document.querySelector('[data-testid="profile-button"]') ||
          document.querySelector('a[data-testid="create-new-chat-button"]') ||
          document.querySelector('[data-testid="composer"]')
      );
      const loginText = [...document.querySelectorAll('button, a')].some((el) =>
        /^(log in|sign in)$/i.test((el.textContent || '').trim())
      );
      const authUrl = /\\/(auth|login|signin)/i.test(location.pathname);
      const send = document.querySelector(
        '#composer-submit-button[data-testid="send-button"], button[data-testid="send-button"][aria-label="Send prompt"]'
      );
      const stop = document.querySelector(
        'button[data-testid="stop-button"], #composer-submit-button[data-testid="stop-button"]'
      );
      const loggedIn = !authUrl && (Boolean(composer) || shellHints);
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
      const field =
        document.querySelector('#prompt-textarea[contenteditable="true"]') ||
        document.querySelector('#prompt-textarea');
      if (!field) throw new Error('ChatGPT composer not found');
      field.focus();
      try {
        document.execCommand('selectAll', false);
        document.execCommand('insertText', false, text);
      } catch (_) {}
      if ((field.innerText || '').trim() !== String(text).trim()) {
        field.innerHTML = '';
        const p = document.createElement('p');
        p.textContent = text;
        field.appendChild(p);
        field.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
      }
      await new Promise((r) => setTimeout(r, 120));
      const send = document.querySelector(
        '#composer-submit-button[data-testid="send-button"], button[data-testid="send-button"][aria-label="Send prompt"]'
      );
      if (send && !send.disabled) send.click();
      else field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return { ok: true };
    },
    snapshot() {
      let turns = [...document.querySelectorAll('[data-turn="assistant"]')];
      if (turns.length === 0) {
        turns = [...document.querySelectorAll('[data-message-author-role="assistant"]')].filter(
          (el) => el.parentElement?.closest('[data-message-author-role]') === null
        );
      }
      const texts = turns
        .map((el) => {
          const clone = el.cloneNode(true);
          for (const t of clone.querySelectorAll(
            '[data-testid="thoughts"], [data-testid="thought-process"], [data-testid="reasoning-summary"], .result-thinking, [data-testid="author"]'
          )) {
            t.remove();
          }
          const md = clone.querySelector('.markdown');
          let text = (md ? md.innerText : clone.innerText || '').trim();
          text = text.replace(/^ChatGPT said:\\s*/i, '').trim();
          if (!text || isChromeLabel(text)) return '';
          return text;
        })
        .filter(Boolean);
      const stop = document.querySelector(
        'button[data-testid="stop-button"], #composer-submit-button[data-testid="stop-button"]'
      );
      return {
        count: texts.length,
        last: texts[texts.length - 1] || '',
        generating: Boolean(stop),
      };
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
      const field =
        document.querySelector('textarea[placeholder="Message DeepSeek"]') ||
        document.querySelector('textarea[placeholder*="DeepSeek" i]') ||
        document.querySelector('textarea[name="search"]') ||
        document.querySelector('textarea');
      if (!field) throw new Error('DeepSeek composer not found');
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
        '.ds-button.ds-button--primary.ds-button--circle:not(.ds-button--disabled)'
      );
      if (send) send.click();
      else field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return { ok: true };
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
      const incompleteJson = (() => {
        const t = lastText.trim();
        const start = t.indexOf('{');
        if (start < 0) {
          if (!(t.startsWith('{') || t.startsWith('['))) return false;
        }
        const slice = start >= 0 ? t.slice(start) : t;
        try {
          JSON.parse(slice);
          return false;
        } catch {
          return slice.startsWith('{') || slice.startsWith('[');
        }
      })();
      return {
        count: texts.length,
        last: lastText,
        generating:
          stopVisible ||
          Boolean(thinking && !hasMain && !lastText) ||
          incompleteJson,
      };
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
      const texts = turns
        .map((el) => {
          const answer = el.querySelector('.response-message-content.phase-answer');
          return ((answer ? answer.innerText : el.innerText) || '').trim();
        })
        .filter(Boolean);
      const stop = document.querySelector(
        '.stop-button, button[aria-label="Stop"], button[aria-label*="Stop" i]'
      );
      return {
        count: texts.length,
        last: texts[texts.length - 1] || '',
        generating: Boolean(stop),
      };
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
      const texts = turns
        .map((el) => {
          const clone = el.cloneNode(true);
          for (const t of clone.querySelectorAll(
            '.thinking-chain-container, [class*="thinking-chain"], [class*="Thinking"]'
          )) {
            t.remove();
          }
          return (clone.innerText || '').trim();
        })
        .filter(Boolean);
      const stop = document.querySelector(
        '#stop-message-button, button[aria-label="Stop"], button[aria-label="Stop generating"], .stopGeneratingButton'
      );
      const send = document.querySelector('#send-message-button');
      const last = turns[turns.length - 1];
      const thinking = last?.querySelector(
        '.thinking-chain-container, [class*="thinking-chain"]'
      );
      const lastText = texts[texts.length - 1] || '';
      // While the thinking chain is on screen, the model is still working —
      // never treat partial streamed text as a finished reply.
      const generating =
        Boolean(stop) ||
        Boolean(thinking) ||
        Boolean(send && send.disabled && lastText.length === 0);
      return {
        count: texts.length,
        last: lastText,
        generating,
      };
    },
  };
  return api;
})()
`;
