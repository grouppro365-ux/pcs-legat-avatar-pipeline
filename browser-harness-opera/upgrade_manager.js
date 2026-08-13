/* Keep already-open bound tabs from running a stale content-script after an
 * unpacked extension update. This runs only on install/update events. */
(() => {
  const KEY='agency.browserHarness.state.v1';
  const ACTIVE = new Set(['running','sending_chatgpt','waiting_chatgpt','confirmation']);

  chrome.runtime.onInstalled.addListener(async details => {
    if (!['install','update'].includes(details.reason)) return;
    try {
      const data = await chrome.storage.local.get(KEY);
      const state = data[KEY];
      // Never reload underneath an active mutation/run. The new runtime can
      // recover an active wait; stale tabs can be refreshed on the next bind.
      if (state?.run && ACTIVE.has(state.run.status)) return;
      const ids = new Set([state?.chat?.tabId,state?.target?.tabId].filter(Number.isInteger));
      for (const tabId of ids) {
        const tab = await chrome.tabs.get(tabId).catch(()=>null);
        if (!tab?.url || !/^https?:/i.test(tab.url)) continue;
        await chrome.tabs.reload(tabId).catch(()=>{});
      }
    } catch {}
  });
})();
