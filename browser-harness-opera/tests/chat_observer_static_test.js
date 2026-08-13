const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const observer=fs.readFileSync(path.join(root,'chatgpt_observer.js'),'utf8');
const worker=fs.readFileSync(path.join(root,'service_worker.js'),'utf8');
const tracker=fs.readFileSync(path.join(root,'target_tracker.js'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));

assert(/new MutationObserver/.test(observer),'ChatGPT observer must be MutationObserver driven');
assert(/ABH_CHAT_ARM/.test(observer),'observer must support arming exact request');
assert(/ABH_CHAT_RECOVER/.test(observer),'observer must recover a pending request after worker sleep/restart');
assert(/ABH_CHAT_SENT_PROOF/.test(observer),'observer must prove request delivery state');
assert(/outsideComposer/.test(observer)&&/insideComposer/.test(observer),'send proof distinguishes conversation from composer');
assert(/BH_PLANNER\?\.extractJson|BH_PLANNER\.extractJson/.test(observer),'observer must parse exact requestId JSON');
assert(/chrome\.storage\.local\.set/.test(observer),'observer must persist response before waking service worker');
assert(/ABH_CHAT_RESPONSE/.test(observer),'observer must wake service worker with response event');
assert(/acknowledged/.test(observer)&&/chrome\.storage\.local\.remove\(key\)/.test(observer),'acknowledged mailbox response must be cleaned after durable runtime ACK');
assert(/If no ACK arrived[\s\S]*keep it for recovery/.test(observer),'unacknowledged response remains recoverable');
assert(!/setInterval\s*\(/.test(observer),'observer must not use periodic chat polling');

// Regression: after Opera "Reload" an old isolated-world global can survive while
// its old chrome.runtime listener is dead. A permanent boolean early-return made
// the newly injected observer silently skip installation and caused
// CHATGPT_OBSERVER_NOT_READY. Hot reload must be versioned/disposable instead.
assert(!/if\s*\(globalThis\.__ABH_CHAT_OBSERVER__\)\s*return/.test(observer),'legacy permanent observer boolean guard must never return early');
assert(/OBSERVER_VERSION/.test(observer),'observer must expose a concrete hot-reload generation');
assert(/__ABH_CHAT_OBSERVER_CONTROLLER__/.test(observer),'observer must keep a versioned controller');
assert(/previous\?\.dispose\?\.\(\)/.test(observer),'fresh observer must dispose a previous live generation when possible');
assert(/removeListener\(onMessage\)/.test(observer)&&/disconnect\(\)/.test(observer),'observer generation must be disposable');
assert(/observerVersion:OBSERVER_VERSION/.test(observer),'observer ping/records must expose generation for diagnostics');

assert(/status='waiting_chatgpt'|status = 'waiting_chatgpt'|live\.status='waiting_chatgpt'/.test(worker),'worker must expose durable waiting_chatgpt state');
assert(/ABH_CHAT_RESPONSE/.test(worker),'worker must consume event-driven response');
assert(/recoverPendingChat/.test(worker),'worker must recover pending chat without resending');
assert(!/CHATGPT_RESPONSE_TIMEOUT/.test(worker),'old terminal ChatGPT response timeout must be removed');
assert(!/waitPlannerResponse/.test(worker),'old long-poll response loop must be removed');

assert(/chrome\.storage\.onChanged/.test(tracker),'target tracker must reconcile concurrent state writes');
assert(/reconciling/.test(tracker),'target reconciliation must have loop guard');
assert(/chrome\.tabs\.get\(tabId\)/.test(tracker),'target reconciliation must compare persisted target with live tab');

const chatScript=manifest.content_scripts.find(x=>(x.matches||[]).some(m=>m.includes('chatgpt.com')));
assert(chatScript,'manifest must have a ChatGPT-specific content script');
assert(chatScript.js.includes('planner_protocol.js'),'ChatGPT content script must load planner protocol');
assert(chatScript.js.includes('chatgpt_observer.js'),'ChatGPT content script must load event observer');

console.log('chat_observer_static_test PASS');
