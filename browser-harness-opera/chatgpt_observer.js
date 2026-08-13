/*
 * Event-driven ChatGPT bridge for Agency Browser Harness.
 * Runs inside the explicitly bound chatgpt.com tab. It watches the rendered
 * conversation and wakes the MV3 service worker when the exact requestId JSON
 * appears. This removes long polling from the service worker.
 */
(() => {
  if (globalThis.__ABH_CHAT_OBSERVER__) return;
  globalThis.__ABH_CHAT_OBSERVER__ = true;

  const STATE_KEY = 'agency.browserHarness.state.v1';
  const RESPONSE_PREFIX = 'agency.browserHarness.chat.response.';
  const norm = v => String(v ?? '').replace(/\s+/g, ' ').trim();
  let active = null;
  let scanTimer = null;
  let scanning = false;

  function chatPath() {
    return location.pathname.match(/^\/c\/[^/?#]+/)?.[0] || '';
  }

  function composerRoots() {
    const roots = new Set();
    const exact = document.querySelector('#prompt-textarea');
    if (exact) {
      roots.add(exact);
      const form = exact.closest('form');
      if (form) roots.add(form);
    }
    for (const el of document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"]')) {
      const form = el.closest('form');
      if (form) roots.add(form); else roots.add(el);
    }
    return [...roots];
  }

  function insideComposer(node) {
    const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    if (!el) return false;
    return composerRoots().some(root => root === el || root.contains(el));
  }

  function requestOutsideComposer(requestId) {
    const needle = `REQUEST_ID=${requestId}`;
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue?.includes(needle)) continue;
      if (!insideComposer(node)) return true;
    }
    return false;
  }

  function requestInsideComposer(requestId) {
    const needle = `REQUEST_ID=${requestId}`;
    return composerRoots().some(root => norm(root.innerText || root.textContent || root.value || '').includes(needle));
  }

  async function persistAndSignal(obj) {
    const requestId = active?.requestId || obj?.requestId;
    if (!requestId || obj?.requestId !== requestId) return false;
    const key = `${RESPONSE_PREFIX}${requestId}`;
    const record = {
      requestId,
      response: obj,
      chatPath: chatPath(),
      observedAt: new Date().toISOString()
    };

    // Persist first. If the service worker is asleep/crashes, startup recovery can
    // still consume this exact response without ever resending the prompt.
    await chrome.storage.local.set({[key]: record});
    let acknowledged = false;
    try {
      const ack = await chrome.runtime.sendMessage({type:'ABH_CHAT_RESPONSE', ...record});
      acknowledged = !!ack?.ok;
    } catch {}

    // A successful runtime ACK means the response has already been copied into
    // durable run state. Remove the mailbox record to prevent storage leaks or a
    // later worker restart from replaying the same response. If no ACK arrived,
    // keep it for recovery.
    if (acknowledged) await chrome.storage.local.remove(key).catch(()=>{});
    active = null;
    return true;
  }

  async function scanNow() {
    if (scanning || !active?.requestId) return;
    scanning = true;
    try {
      const body = document.body?.innerText || '';
      let obj = null;
      try { obj = globalThis.BH_PLANNER?.extractJson(body, active.requestId) || null; }
      catch {}
      if (obj) await persistAndSignal(obj);
    } finally {
      scanning = false;
    }
  }

  function scheduleScan(delay = 80) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => scanNow().catch(()=>{}), delay);
  }

  async function arm(requestId) {
    active = {requestId:String(requestId), armedAt:Date.now()};
    scheduleScan(0);
    return {ok:true,requestId:active.requestId,path:chatPath()};
  }

  async function restoreFromRunState() {
    try {
      const data = await chrome.storage.local.get(STATE_KEY);
      const state = data[STATE_KEY];
      const pending = state?.run?.pendingRequest;
      if (!pending?.requestId || !state?.chat?.path) return;
      if (state.chat.path !== chatPath()) return;
      if (!['waiting_chatgpt','running','sending_chatgpt'].includes(state.run?.status)) return;
      await arm(pending.requestId);
    } catch {}
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      if (msg?.type === 'ABH_CHAT_OBSERVER_PING') {
        return {ok:true,path:chatPath(),activeRequestId:active?.requestId || null};
      }
      if (msg?.type === 'ABH_CHAT_ARM' || msg?.type === 'ABH_CHAT_RECOVER') {
        return arm(msg.requestId);
      }
      if (msg?.type === 'ABH_CHAT_SENT_PROOF') {
        const requestId = String(msg.requestId || '');
        return {
          ok:true,
          requestId,
          outsideComposer:requestOutsideComposer(requestId),
          insideComposer:requestInsideComposer(requestId),
          path:chatPath()
        };
      }
      return {ok:false,error:'UNKNOWN_CHAT_OBSERVER_MESSAGE'};
    })().then(sendResponse).catch(err => sendResponse({ok:false,error:String(err?.message || err)}));
    return true;
  });

  const observer = new MutationObserver(() => scheduleScan());
  observer.observe(document.documentElement, {subtree:true, childList:true, characterData:true});
  window.addEventListener('pageshow', () => restoreFromRunState());
  restoreFromRunState();
})();
