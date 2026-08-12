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

  function releaseRequest(requestId) {
    // Never let an older async frame clear a newer request.
    if (activeRequest === requestId) activeRequest = null;
  }

  async function trustedInputAndSend(requestId, prompt, pinnedPath) {
    const el = composer();
    if (!el) throw new Error('CHATGPT_COMPOSER_NOT_FOUND');
    el.scrollIntoView({block:'nearest'});
    el.focus();

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { port.disconnect(); } catch {}
        fn(value);
      };

      const port = chrome.runtime.connect({name:'AUH_CHAT_CDP'});
      const timer = setTimeout(() => finish(reject, new Error('CHATGPT_CDP_PORT_TIMEOUT')), 12000);
      port.onMessage.addListener((msg) => {
        if (msg?.ok) finish(resolve, msg);
        else finish(reject, new Error(msg?.error || 'CHATGPT_CDP_FAILED'));
      });
      port.onDisconnect.addListener(() => {
        const err = chrome.runtime.lastError?.message;
        if (!settled && err) finish(reject, new Error(`CHATGPT_CDP_PORT_CLOSED:${err}`));
      });
      port.postMessage({type:'AUH_CHAT_CDP_INPUT_AND_SEND', requestId, prompt, pinnedPath});
    });
  }

  async function waitForUserEcho(requestId, beforeCount, timeoutMs = 12000) {
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

  async function reportResult(payload) {
    // The request slot MUST already be released before this call. The service worker
    // may synchronously process the result and immediately start the next reasoning step.
    return chrome.runtime.sendMessage(payload);
  }

  async function executeAsk(requestId, prompt, pinnedPath) {
    if (!pinnedPath || conversationPath() !== pinnedPath) throw new Error('SAFETY_CHAT_SWITCH');
    if (activeRequest) throw new Error('CHATGPT_BUSY');
    activeRequest = requestId;
    try {
      const beforeUsers = document.querySelectorAll('[data-message-author-role="user"]').length;

      await trustedInputAndSend(requestId, prompt, pinnedPath);

      const sent = await waitForUserEcho(requestId, beforeUsers);
      if (!sent) throw new Error('CHATGPT_SEND_UNCERTAIN_NO_RETRY');
      if (conversationPath() !== pinnedPath) throw new Error('SAFETY_CHAT_SWITCH');

      const text = await waitForAssistant(requestId);
      if (conversationPath() !== pinnedPath) throw new Error('SAFETY_CHAT_SWITCH');

      // Critical ordering: free the slot BEFORE reporting the completed turn.
      // handleChatResult() can execute a browser action and ask for the next step
      // before sendMessage() resolves back into this content script.
      releaseRequest(requestId);
      await reportResult({type:'AUH_CHAT_RESULT', requestId, ok:true, text, conversationPath:pinnedPath});
    } catch (err) {
      releaseRequest(requestId);
      try {
        await reportResult({type:'AUH_CHAT_RESULT', requestId, ok:false, error:String(err?.message || err), conversationPath:conversationPath()});
      } catch {}
    } finally {
      // Guarded release: an older request can never clear a newer activeRequest.
      releaseRequest(requestId);
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'AUH_CHAT_PING') {
      sendResponse({ok:!!conversationPath(), conversationPath:conversationPath(), busy:!!activeRequest});
      return;
    }
    if (msg?.type === 'AUH_CHAT_ASK') {
      if (activeRequest) {
        sendResponse({ok:false, error:'CHATGPT_BUSY', activeRequest});
        return;
      }
      executeAsk(msg.requestId, msg.prompt, msg.pinnedPath);
      sendResponse({ok:true, accepted:true});
      return;
    }
  });
})();
