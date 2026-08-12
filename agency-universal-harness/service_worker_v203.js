importScripts('service_worker_v2.js');

const AUH_RUNTIME_VERSION = '2.0.3';
const AUH_RUNTIME_VERSION_KEY = 'auh.runtime.version';
const AUH_STATE_KEY = 'auh.state.v2';

(async () => {
  try {
    const stored = await chrome.storage.local.get([AUH_RUNTIME_VERSION_KEY, AUH_STATE_KEY]);
    if (stored[AUH_RUNTIME_VERSION_KEY] === AUH_RUNTIME_VERSION) return;
    await chrome.storage.local.set({[AUH_RUNTIME_VERSION_KEY]: AUH_RUNTIME_VERSION});

    // Content scripts already living inside an open ChatGPT tab can survive an
    // unpacked-extension reload. Refresh only the bound ChatGPT tab once per runtime
    // version so the new response detector is guaranteed to be active. Never reload
    // the working site automatically: it may contain unsaved form state.
    const chatTabId = stored[AUH_STATE_KEY]?.chat?.tabId;
    if (chatTabId) {
      const tab = await chrome.tabs.get(chatTabId).catch(() => null);
      if (tab && String(tab.url || '').startsWith('https://chatgpt.com/')) {
        await chrome.tabs.reload(chatTabId);
      }
    }
  } catch {
    // Migration failure must not disable the base service worker. Binding validation
    // will surface any remaining bridge problem explicitly in the UI.
  }
})();
