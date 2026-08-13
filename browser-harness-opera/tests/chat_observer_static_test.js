const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const observer=fs.readFileSync(path.join(root,'chatgpt_observer.js'),'utf8');
const worker=fs.readFileSync(path.join(root,'service_worker.js'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));

assert(/new MutationObserver/.test(observer),'ChatGPT observer must be MutationObserver driven');
assert(/ABH_CHAT_ARM/.test(observer),'observer must support arming exact request');
assert(/ABH_CHAT_RECOVER/.test(observer),'observer must recover a pending request after worker sleep/restart');
assert(/ABH_CHAT_SENT_PROOF/.test(observer),'observer must prove a request outside composer');
assert(/BH_PLANNER\?\.extractJson|BH_PLANNER\.extractJson/.test(observer),'observer must parse exact requestId JSON');
assert(/chrome\.storage\.local\.set/.test(observer),'observer must persist response before waking service worker');
assert(/ABH_CHAT_RESPONSE/.test(observer),'observer must wake service worker with response event');
assert(!/setInterval\s*\(/.test(observer),'observer must not use periodic chat polling');

assert(/status='waiting_chatgpt'|status = 'waiting_chatgpt'|live\.status='waiting_chatgpt'/.test(worker),'worker must expose durable waiting_chatgpt state');
assert(/ABH_CHAT_RESPONSE/.test(worker),'worker must consume event-driven response');
assert(/recoverPendingChat/.test(worker),'worker must recover pending chat without resending');
assert(!/CHATGPT_RESPONSE_TIMEOUT/.test(worker),'old terminal ChatGPT response timeout must be removed');
assert(!/waitPlannerResponse/.test(worker),'old long-poll response loop must be removed');

const chatScript=manifest.content_scripts.find(x=>(x.matches||[]).some(m=>m.includes('chatgpt.com')));
assert(chatScript,'manifest must have a ChatGPT-specific content script');
assert(chatScript.js.includes('planner_protocol.js'),'ChatGPT content script must load planner protocol');
assert(chatScript.js.includes('chatgpt_observer.js'),'ChatGPT content script must load event observer');

console.log('chat_observer_static_test PASS');
