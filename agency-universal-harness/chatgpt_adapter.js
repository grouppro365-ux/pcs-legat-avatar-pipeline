(() => {
  let activeRequest = null;

  function conversationPath() {
    const m = location.pathname.match(/^\/c\/[^/?#]+/);
    return m ? m[0] : '';
  }

  function composer() {
    return document.querySelector('#prompt-textarea') ||
      Array.from(document.querySelectorAll('[contenteditable="true"]')).find(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !el.closest('[data-message-author-role]');
      }) || null;
  }

  function textOf(el) { return String(el?.innerText || el?.textContent || '').trim(); }

  function setComposerText(el, text) {
    el.focus();
    if (el.tagName === 'TEXTAREA') {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (set) set.call(el, text); else el.value = text;
      el.dispatchEvent(new Event('input', {bubbles:true}));
      return;
    }
    el.textContent = '';
    el.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'deleteContentBackward'}));
    el.textContent = text;
    el.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:text}));
  }

  function findSendButton(el) {
    const form = el.closest('form') || el.parentElement?.parentElement;
    const candidates = form ? Array.from(form.querySelectorAll('button')) : [];
    return candidates.find(b => {
      const s = `${b.getAttribute('aria-label') || ''} ${b.getAttribute('data-testid') || ''} ${b.innerText || ''}`;
      return /(send|submit|отправ)/i.test(s) && !b.disabled;
    }) || null;
  }

  async function waitForUserEcho(requestId, beforeCount, timeoutMs = 8000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const userTurns = Array.from(document.querySelectorAll('[data-message-author-role="user"]'));
      if (userTurns.length > beforeCount && userTurns.some(t => textOf(t).includes(requestId))) return true;
      await new Promise(r => setTimeout(r, 120));
    }
    return false;
  }

  function findAssistantResult(requestId) {
    const turns = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
    for (let i = turns.length - 1; i >= 0; i--) {
      const txt = textOf(turns[i]);
      if (txt.includes(requestId) && /\{[\s\S]*\}/.test(txt)) return txt;
    }
    return '';
  }

  async function waitForAssistant(requestId, timeoutMs = 120000) {
    const started = Date.now();
    let last = '';
    let stableSince = 0;
    while (Date.now() - started < timeoutMs) {
      const txt = findAssistantResult(requestId);
      if (txt) {
        if (txt !== last) { last = txt; stableSince = Date.now(); }
        else if (Date.now() - stableSince > 900) return txt;
      }
      await new Promise(r => setTimeout(r, 250));
    }
    throw new Error('CHATGPT_RESPONSE_TIMEOUT');
  }

  async function executeAsk(requestId, prompt, pinnedPath) {
    if (!pinnedPath || conversationPath() !== pinnedPath) throw new Error('SAFETY_CHAT_SWITCH');
    if (activeRequest) throw new Error('CHATGPT_BUSY');
    activeRequest = requestId;
    try {
      const el = composer();
      if (!el) throw new Error('CHATGPT_COMPOSER_NOT_FOUND');
      const beforeUsers = document.querySelectorAll('[data-message-author-role="user"]').length;
      setComposerText(el, prompt);
      const send = findSendButton(el);
      if (send) send.click();
      else {
        el.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', code:'Enter', bubbles:true}));
        el.dispatchEvent(new KeyboardEvent('keyup', {key:'Enter', code:'Enter', bubbles:true}));
      }
      const sent = await waitForUserEcho(requestId, beforeUsers);
      if (!sent) throw new Error('CHATGPT_SEND_UNCERTAIN_NO_RETRY');
      if (conversationPath() !== pinnedPath) throw new Error('SAFETY_CHAT_SWITCH');
      const text = await waitForAssistant(requestId);
      if (conversationPath() !== pinnedPath) throw new Error('SAFETY_CHAT_SWITCH');
      await chrome.runtime.sendMessage({type:'AUH_CHAT_RESULT', requestId, ok:true, text, conversationPath:pinnedPath});
    } catch (err) {
      await chrome.runtime.sendMessage({type:'AUH_CHAT_RESULT', requestId, ok:false, error:String(err?.message || err), conversationPath:conversationPath()});
    } finally {
      activeRequest = null;
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'AUH_CHAT_PING') {
      sendResponse({ok:!!conversationPath(), conversationPath:conversationPath()});
      return;
    }
    if (msg?.type === 'AUH_CHAT_ASK') {
      if (activeRequest) { sendResponse({ok:false, error:'CHATGPT_BUSY'}); return; }
      executeAsk(msg.requestId, msg.prompt, msg.pinnedPath);
      sendResponse({ok:true, accepted:true});
      return;
    }
  });
})();
