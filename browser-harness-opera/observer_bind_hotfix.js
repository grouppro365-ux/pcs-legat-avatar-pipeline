/*
 * Robust ChatGPT observer bind recovery for unpacked Opera extension updates.
 * If the observer handshake is unavailable in an already-open ChatGPT tab,
 * reload only that bound conversation, wait for document completion, then
 * re-inject parser + observer and require a successful PING before binding.
 */
(() => {
  const VERSION = '0.3.1';
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function waitTabComplete(tabId, timeoutMs = 30000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab) throw new Error('BOUND_CHAT_TAB_CLOSED');
      if (tab.status === 'complete') return tab;
      await sleep(200);
    }
    throw new Error('CHATGPT_RELOAD_TIMEOUT');
  }

  async function ping(tabId) {
    try {
      const pong = await chrome.tabs.sendMessage(tabId, {type:'ABH_CHAT_OBSERVER_PING'});
      return pong?.ok ? pong : null;
    } catch {
      return null;
    }
  }

  async function inject(tabId) {
    await chrome.scripting.executeScript({target:{tabId}, files:['planner_protocol.js']});
    await chrome.scripting.executeScript({target:{tabId}, files:['chatgpt_observer.js']});
    return ping(tabId);
  }

  // service_worker.js declares ensureChatObserver as a global function in the
  // classic service-worker scope. Replace it with a recovery-first version.
  globalThis.ensureChatObserver = async function ensureChatObserverV031(tabId) {
    let pong = await ping(tabId);
    if (pong) return {...pong, bindRecovery:'none', harnessVersion:VERSION};

    // First try a clean reinjection. This is enough when no stale page world is
    // present and avoids unnecessary navigation.
    pong = await inject(tabId).catch(() => null);
    if (pong) return {...pong, bindRecovery:'reinjected', harnessVersion:VERSION};

    // Unpacked extension reloads can leave a stale isolated-world singleton in
    // an already-open tab. A document reload is the deterministic reset: the
    // conversation URL stays pinned while every content-script world is fresh.
    const before = await chrome.tabs.get(tabId).catch(() => null);
    if (!before?.url || !String(before.url).startsWith('https://chatgpt.com/')) {
      throw new Error('OPEN_CHATGPT_CONVERSATION_FIRST');
    }
    const pathBefore = new URL(before.url).pathname.match(/^\/c\/[^/?#]+/)?.[0] || '';
    if (!pathBefore) throw new Error('OPEN_CHATGPT_CONVERSATION_FIRST');

    await chrome.tabs.reload(tabId);
    const after = await waitTabComplete(tabId);
    const pathAfter = new URL(after.url || '').pathname.match(/^\/c\/[^/?#]+/)?.[0] || '';
    if (pathAfter !== pathBefore) throw new Error('SAFETY_CHAT_SWITCH');

    // The manifest content script should now be fresh. Give it one short turn,
    // then explicitly inject once as a deterministic fallback.
    await sleep(250);
    pong = await ping(tabId);
    if (!pong) pong = await inject(tabId).catch(() => null);
    if (!pong) {
      throw new Error(`CHATGPT_OBSERVER_NOT_READY_AFTER_RELOAD:${VERSION}`);
    }
    return {...pong, bindRecovery:'reloaded', harnessVersion:VERSION};
  };
})();
