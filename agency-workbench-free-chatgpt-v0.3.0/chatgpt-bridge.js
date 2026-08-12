(() => {
  if (globalThis.__AGENCY_CHAT_BRIDGE_V3__) return;
  globalThis.__AGENCY_CHAT_BRIDGE_V3__ = true;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function conversationPath() {
    try {
      return /^\/c\/[^/]+/.test(location.pathname) ? location.pathname : null;
    } catch {
      return null;
    }
  }

  function composer() {
    const selectors = [
      '#prompt-textarea',
      '[data-testid="composer-text-input"]',
      'textarea[placeholder*="Message"]',
      'textarea[placeholder*="Сообщ"]',
      '[contenteditable="true"][data-lexical-editor="true"]',
      '.ProseMirror[contenteditable="true"]',
      'main [contenteditable="true"]'
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && !el.closest('[aria-hidden="true"]')) return el;
    }
    return null;
  }

  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : null;
    const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  }

  async function writeComposer(text) {
    const el = composer();
    if (!el) throw new Error('Не найдено поле ввода ChatGPT. Возможно, интерфейс ChatGPT изменился.');
    el.focus();

    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      setNativeValue(el, text);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      let inserted = false;
      try { inserted = document.execCommand('insertText', false, text); } catch {}
      if (!inserted) {
        el.replaceChildren(document.createTextNode(text));
      }
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    await sleep(250);
    return el;
  }

  function sendButton() {
    const selectors = [
      'button[data-testid="send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="Отправ"]'
    ];
    for (const selector of selectors) {
      const btn = document.querySelector(selector);
      if (btn && !btn.disabled) return btn;
    }
    return null;
  }

  async function submitComposer(el) {
    for (let i = 0; i < 15; i++) {
      const btn = sendButton();
      if (btn) {
        btn.click();
        return;
      }
      await sleep(150);
    }
    const form = el.closest('form');
    if (form && typeof form.requestSubmit === 'function') {
      form.requestSubmit();
      return;
    }
    throw new Error('Не найдена активная кнопка отправки ChatGPT.');
  }

  function assistantNodes() {
    const direct = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
    if (direct.length) return direct;

    const turns = [...document.querySelectorAll('article[data-testid^="conversation-turn-"]')];
    return turns.filter(el => {
      const text = (el.innerText || '').trim();
      return text && !el.querySelector('[data-message-author-role="user"]');
    });
  }

  function lastAssistantText() {
    const nodes = assistantNodes();
    const last = nodes[nodes.length - 1];
    return (last?.innerText || '').trim();
  }

  function generationRunning() {
    return !!document.querySelector(
      'button[data-testid="stop-button"], button[aria-label*="Stop"], button[aria-label*="Останов"]'
    );
  }

  async function waitForNewAssistant(beforeText, timeoutMs) {
    const started = Date.now();
    let seen = '';
    let stableSince = 0;

    while (Date.now() - started < timeoutMs) {
      const nowText = lastAssistantText();
      if (nowText && nowText !== beforeText) {
        if (nowText !== seen) {
          seen = nowText;
          stableSince = Date.now();
        } else if (!generationRunning() && Date.now() - stableSince > 1400) {
          return nowText;
        }
      }
      await sleep(350);
    }
    throw new Error('ChatGPT не закончил ответ за отведённое время.');
  }

  async function sendPrompt(prompt, timeoutMs) {
    const before = lastAssistantText();
    const el = await writeComposer(prompt);
    await submitComposer(el);
    const text = await waitForNewAssistant(before, timeoutMs || 180000);
    return { text, conversationPath: conversationPath() };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'AGENCY_CHAT_PING') {
      sendResponse({ ok: true, bridge: 'chat-v3', conversationPath: conversationPath() });
      return;
    }

    if (message?.type === 'AGENCY_CHAT_SEND') {
      (async () => {
        try {
          const result = await sendPrompt(String(message.prompt || ''), Number(message.timeoutMs) || 180000);
          sendResponse({ ok: true, requestId: message.requestId, ...result });
        } catch (e) {
          sendResponse({ ok: false, requestId: message.requestId, error: e?.message || String(e) });
        }
      })();
      return true;
    }
  });
})();