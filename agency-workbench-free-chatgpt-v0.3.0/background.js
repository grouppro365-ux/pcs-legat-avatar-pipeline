const STORE = { CHAT: 'agency.chatBinding.v3', TARGET: 'agency.targetBinding.v3' };

chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') }));
chrome.runtime.onInstalled.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') }));

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, response => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message)); else resolve(response);
    });
  });
}

async function getStored(key) { return (await chrome.storage.local.get(key))[key] || null; }
async function setStored(key, value) { await chrome.storage.local.set({ [key]: value }); }

function parseHttpUrl(raw) {
  try {
    const u = new URL(raw || '');
    return /^https?:$/.test(u.protocol) ? u : null;
  } catch { return null; }
}

function chatConversationPath(url) {
  const u = parseHttpUrl(url);
  if (!u || u.hostname !== 'chatgpt.com') return null;
  return /^\/c\/[^/]+/.test(u.pathname) ? u.pathname : null;
}

async function getTab(tabId) {
  try { return await chrome.tabs.get(Number(tabId)); }
  catch { return null; }
}

async function waitForTabComplete(tabId, timeoutMs = 15000) {
  let tab = await getTab(tabId);
  if (!tab) throw new Error('Вкладка закрыта');
  if (tab.status === 'complete') return tab;

  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error('Страница слишком долго загружается'));
    }, timeoutMs);

    function finish(value, error) {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      if (error) reject(error); else resolve(value);
    }

    async function onUpdated(updatedTabId, info) {
      if (updatedTabId !== Number(tabId) || info.status !== 'complete') return;
      const fresh = await getTab(tabId);
      if (!fresh) finish(null, new Error('Вкладка закрылась во время загрузки'));
      else finish(fresh);
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function injectAndPing(tabId, kind) {
  await waitForTabComplete(tabId);
  const pingType = kind === 'chat' ? 'AGENCY_CHAT_PING' : 'AGENCY_PAGE_PING';
  const file = kind === 'chat' ? 'chatgpt-bridge.js' : 'page-agent.js';

  try {
    const pong = await sendTabMessage(tabId, { type: pingType });
    if (pong?.ok) return { ok: true, injected: false, pong };
  } catch {}

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
  } catch (e) {
    return { ok: false, error: `Не удалось внедрить ${file}: ${e.message}` };
  }

  try {
    const pong = await sendTabMessage(tabId, { type: pingType });
    if (pong?.ok) return { ok: true, injected: true, pong };
    return { ok: false, error: `${file} внедрён, но не отвечает` };
  } catch (e) {
    return { ok: false, error: `${file} не отвечает после внедрения: ${e.message}` };
  }
}

async function bindChat(tabId) {
  const tab = await waitForTabComplete(tabId);
  const u = parseHttpUrl(tab?.url);
  if (!tab || !u || u.hostname !== 'chatgpt.com') throw new Error('Выбранная вкладка не является chatgpt.com');
  const health = await injectAndPing(tab.id, 'chat');
  if (!health.ok) throw new Error(health.error);
  const binding = { tabId: tab.id, conversationPath: chatConversationPath(tab.url), title: tab.title || 'ChatGPT' };
  await setStored(STORE.CHAT, binding);
  return { binding, health };
}

async function bindTarget(tabId) {
  const tab = await waitForTabComplete(tabId);
  const u = parseHttpUrl(tab?.url);
  if (!tab || !u || u.hostname === 'chatgpt.com') throw new Error('Выберите обычную рабочую вкладку сайта');
  const health = await injectAndPing(tab.id, 'page');
  if (!health.ok) throw new Error(health.error);
  const binding = { tabId: tab.id, origin: u.origin, title: tab.title || u.hostname };
  await setStored(STORE.TARGET, binding);
  return { binding, health };
}

async function validateChatBinding() {
  const binding = await getStored(STORE.CHAT);
  if (!binding) throw new Error('ChatGPT ещё не привязан');
  const tab = await waitForTabComplete(binding.tabId);
  const u = parseHttpUrl(tab?.url);
  if (!tab || !u || u.hostname !== 'chatgpt.com') throw new Error('Привязанная вкладка ChatGPT закрыта или больше не ChatGPT');
  const currentPath = chatConversationPath(tab.url);
  if (binding.conversationPath && currentPath !== binding.conversationPath) throw new Error('В привязанной вкладке открыт другой разговор ChatGPT. Перепривяжите вкладку.');
  const health = await injectAndPing(tab.id, 'chat');
  if (!health.ok) throw new Error(health.error);
  return { binding, tab, health };
}

async function validateTargetBinding() {
  const binding = await getStored(STORE.TARGET);
  if (!binding) throw new Error('Рабочий сайт ещё не привязан');
  const tab = await waitForTabComplete(binding.tabId);
  const u = parseHttpUrl(tab?.url);
  if (!tab || !u) throw new Error('Привязанная рабочая вкладка закрыта');
  if (u.origin !== binding.origin) throw new Error(`Рабочая вкладка ушла на другой сайт: ${u.origin}. Перепривяжите её явно.`);
  const health = await injectAndPing(tab.id, 'page');
  if (!health.ok) throw new Error(health.error);
  return { binding, tab, health };
}

async function diagnose() {
  const result = { chat: { ok: false }, target: { ok: false } };
  try {
    const x = await validateChatBinding();
    result.chat = { ok: true, title: x.tab.title, url: x.tab.url, injected: !!x.health.injected };
  } catch (e) { result.chat = { ok: false, error: e.message }; }
  try {
    const x = await validateTargetBinding();
    result.target = { ok: true, title: x.tab.title, url: x.tab.url, injected: !!x.health.injected };
  } catch (e) { result.target = { ok: false, error: e.message }; }
  return result;
}

async function listTabs() {
  return (await chrome.tabs.query({ currentWindow: true }))
    .filter(t => /^https?:\/\//.test(t.url || ''))
    .map(t => ({ id: t.id, title: t.title || '', url: t.url || '' }));
}

async function sendToChatGPT(prompt, requestId, timeoutMs = 180000) {
  const x = await validateChatBinding();
  const response = await sendTabMessage(x.tab.id, { type: 'AGENCY_CHAT_SEND', prompt, requestId, timeoutMs });
  if (!response?.ok) throw new Error(response?.error || 'ChatGPT bridge вернул ошибку');
  if (!x.binding.conversationPath && response.conversationPath) {
    x.binding.conversationPath = response.conversationPath;
    await setStored(STORE.CHAT, x.binding);
  }
  return response;
}

async function scanTarget() {
  const x = await validateTargetBinding();
  const response = await sendTabMessage(x.tab.id, { type: 'AGENCY_PAGE_SCAN' });
  if (!response?.ok) throw new Error(response?.error || 'Не удалось прочитать рабочую страницу');
  return response.scan;
}

async function executeTarget(action) {
  const x = await validateTargetBinding();
  const response = await sendTabMessage(x.tab.id, { type: 'AGENCY_PAGE_EXECUTE', action });
  if (!response?.ok && !response?.confirmationRequired) throw new Error(response?.error || 'Действие на странице не выполнено');

  if (action?.type === 'click') {
    try { await waitForTabComplete(x.tab.id, 12000); } catch {}
  }
  const after = await getTab(x.tab.id);
  const afterUrl = parseHttpUrl(after?.url);
  if (afterUrl && afterUrl.origin !== x.binding.origin) throw new Error(`После действия вкладка перешла на другой origin: ${afterUrl.origin}. Остановлено.`);
  return response;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message?.type) {
        case 'AGENCY_LIST_TABS': sendResponse({ ok: true, tabs: await listTabs() }); break;
        case 'AGENCY_BIND_CHAT': sendResponse({ ok: true, ...(await bindChat(message.tabId)) }); break;
        case 'AGENCY_BIND_TARGET': sendResponse({ ok: true, ...(await bindTarget(message.tabId)) }); break;
        case 'AGENCY_GET_BINDINGS': sendResponse({ ok: true, chat: await getStored(STORE.CHAT), target: await getStored(STORE.TARGET) }); break;
        case 'AGENCY_DIAGNOSE': sendResponse({ ok: true, diagnosis: await diagnose() }); break;
        case 'AGENCY_CHAT_SEND_REQUEST': sendResponse({ ok: true, result: await sendToChatGPT(message.prompt, message.requestId, message.timeoutMs) }); break;
        case 'AGENCY_TARGET_SCAN_REQUEST': sendResponse({ ok: true, scan: await scanTarget() }); break;
        case 'AGENCY_TARGET_EXECUTE_REQUEST': sendResponse({ ok: true, result: await executeTarget(message.action) }); break;
        default: sendResponse({ ok: false, error: 'Unknown message type' });
      }
    } catch (e) { sendResponse({ ok: false, error: e?.message || String(e) }); }
  })();
  return true;
});