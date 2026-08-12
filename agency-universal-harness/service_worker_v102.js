importScripts('chat_cdp.js', 'response_parser.js', 'service_worker.js');

// v1.0.2 hotfix: service_worker.js historically scanned JSON from the last "{" and
// could return a nested target object instead of the outer action object. Replace
// that parser at runtime with the tested outer-object parser.
extractJson = function(text) {
  return AUH_RESPONSE_PARSER.extractJson(text);
};

const AUH_STATE_KEY = 'auh.state.v1';

function auhChatPath(url) {
  try { return new URL(url).pathname.match(/^\/c\/[^/?#]+/)?.[0] || ''; }
  catch { return ''; }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'AUH_CHAT_CDP') return;

  let handled = false;
  port.onMessage.addListener(async (msg) => {
    if (handled) return;
    handled = true;
    try {
      const stored = await chrome.storage.local.get(AUH_STATE_KEY);
      const state = stored[AUH_STATE_KEY];
      const senderTabId = port.sender?.tab?.id;
      if (!state?.chat || !senderTabId || senderTabId !== state.chat.tabId) {
        throw new Error('SAFETY_CHAT_TAB_MISMATCH');
      }
      if (msg?.type !== 'AUH_CHAT_CDP_INPUT_AND_SEND') {
        throw new Error('CHATGPT_CDP_BAD_MESSAGE');
      }
      if (!msg.requestId || !String(msg.prompt || '').includes(msg.requestId)) {
        throw new Error('CHATGPT_CDP_REQUEST_ID_MISSING');
      }
      if (msg.pinnedPath !== state.chat.path) {
        throw new Error('SAFETY_CHAT_SWITCH');
      }

      const tab = await chrome.tabs.get(senderTabId).catch(() => null);
      if (!tab || auhChatPath(tab.url || '') !== state.chat.path) {
        throw new Error('SAFETY_CHAT_SWITCH');
      }

      const result = await AUH_CHAT_CDP.replaceFocusedTextAndSend(senderTabId, msg.prompt);
      port.postMessage({ ok: true, ...result });
    } catch (err) {
      port.postMessage({ ok: false, error: String(err?.message || err) });
    } finally {
      try { port.disconnect(); } catch {}
    }
  });
});
