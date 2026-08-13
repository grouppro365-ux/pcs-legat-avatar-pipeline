/*
 * Event-driven ChatGPT bridge for Agency Browser Harness.
 * Runs inside the explicitly bound chatgpt.com tab. It watches the rendered
 * conversation and wakes the MV3 service worker when the exact requestId JSON
 * appears. This removes long polling from the service worker.
 *
 * HOT-RELOAD NOTE:
 * Never use a permanent boolean guard here. Opera/Chromium can keep globals from
 * an old isolated world after an unpacked extension Reload while the old
 * chrome.runtime listener is already dead. A boolean guard would then prevent
 * the fresh observer from installing and produce CHATGPT_OBSERVER_NOT_READY.
 */
(() => {
  const OBSERVER_VERSION = '0.3.1-hotfix';
  const CONTROLLER_KEY = '__ABH_CHAT_OBSERVER_CONTROLLER__';
  const STATE_KEY = 'agency.browserHarness.state.v1';
  const RESPONSE_PREFIX = 'agency.browserHarness.chat.response.';
  const norm = v => String(v ?? '').replace(/\s+/g, ' ').trim();

  const previous = globalThis[CONTROLLER_KEY];
  if (previous?.version === OBSERVER_VERSION && previous?.alive) return;
  try { previous?.dispose?.(); } catch {}

  // Intentionally overwrite the legacy boolean used by v0.3.0. Its presence is
  // not evidence that a live runtime listener still exists.
  globalThis.__ABH_CHAT_OBSERVER__ = OBSERVER_VERSION;

  let active = null;
  let scanTimer = null;
  let scanning = false;
  let disposed = false;
  let domObserver = null;

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
    if (disposed) return false;
    const requestId = active?.requestId || obj?.requestId;
    if (!requestId || obj?.requestId !== requestId) return false;
    const key = `${RESPONSE_PREFIX}${requestId}`;
    const record = {
      requestId,
      response: obj,
      chatPath: chatPath(),
      observedAt: new Date().toISOString(),
      observerVersion: OBSERVER_VERSION
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
    if (disposed || scanning || !active?.requestId) return;
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
    if (disposed) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => scanNow().catch(()=>{}), delay);
  }

  async function arm(requestId) {
    if (disposed) return {ok:false,error:'OBSERVER_DISPOSED'};
    active = {requestId:String(requestId), armedAt:Date.now()};
    scheduleScan(0);
    return {ok:true,requestId:active.requestId,path:chatPath(),observerVersion:OBSERVER_VERSION};
  }

  async function restoreFromRunState() {
    if (disposed) return;
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

  const onMessage = (msg, _sender, sendResponse) => {
    (async () => {
      if (disposed) return {ok:false,error:'OBSERVER_DISPOSED'};
      if (msg?.type === 'ABH_CHAT_OBSERVER_PING') {
        return {ok:true,path:chatPath(),activeRequestId:active?.requestId || null,observerVersion:OBSERVER_VERSION};
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
          path:chatPath(),
          observerVersion:OBSERVER_VERSION
        };
      }
      return {ok:false,error:'UNKNOWN_CHAT_OBSERVER_MESSAGE'};
    })().then(sendResponse).catch(err => sendResponse({ok:false,error:String(err?.message || err)}));
    return true;
  };

  function dispose() {
    if (disposed) return;
    disposed = true;
    active = null;
    clearTimeout(scanTimer);
    try { domObserver?.disconnect(); } catch {}
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch {}
    try { window.removeEventListener('pageshow', onPageShow); } catch {}
  }

  const onPageShow = () => restoreFromRunState();
  chrome.runtime.onMessage.addListener(onMessage);
  domObserver = new MutationObserver(() => scheduleScan());
  domObserver.observe(document.documentElement, {subtree:true, childList:true, characterData:true});
  window.addEventListener('pageshow', onPageShow);

  globalThis[CONTROLLER_KEY] = {
    version: OBSERVER_VERSION,
    alive: true,
    dispose
  };

  restoreFromRunState();
})();
