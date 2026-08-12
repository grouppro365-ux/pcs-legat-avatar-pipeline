importScripts('policy.js');

const CHAT_HOST_RE = /(^|\.)chatgpt\.com$|^chat\.openai\.com$/i;
const usedConfirmations = new Set();

chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('dashboard.html');
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find(t => t.url === url);
  if (existing?.id) {
    await chrome.tabs.update(existing.id,{active:true});
    if (existing.windowId) await chrome.windows.update(existing.windowId,{focused:true});
  } else await chrome.tabs.create({url});
});

const stripUrl = raw => {
  try { const u = new URL(raw); return `${u.origin}${u.pathname}`; } catch { return ''; }
};
const originOf = raw => { try { return new URL(raw).origin; } catch { return ''; } };
const isHttp = raw => { try { return /^https?:$/.test(new URL(raw).protocol); } catch { return false; } };
const isChat = raw => { try { return CHAT_HOST_RE.test(new URL(raw).hostname); } catch { return false; } };

async function getTab(tabId) {
  if (!Number.isInteger(tabId)) throw new Error('Вкладка не привязана.');
  try { return await chrome.tabs.get(tabId); } catch { throw new Error('Привязанная вкладка закрыта. Перепривяжите её явно.'); }
}

function sendTab(tabId,msg,timeoutMs=170000) {
  return new Promise((resolve,reject) => {
    let done=false;
    const timer=setTimeout(()=>{if(!done){done=true;reject(new Error('Bridge timeout'));}},timeoutMs);
    chrome.tabs.sendMessage(tabId,msg,response => {
      const err=chrome.runtime.lastError;
      if(done) return;
      done=true; clearTimeout(timer);
      if(err) reject(new Error(err.message)); else resolve(response);
    });
  });
}

async function ensureScript(tabId,file,pingType) {
  try {
    const ping=await sendTab(tabId,{type:pingType},4000);
    if(ping?.ok) return ping;
  } catch {}
  await chrome.scripting.executeScript({target:{tabId},files:[file]});
  const ping=await sendTab(tabId,{type:pingType},6000);
  if(!ping?.ok) throw new Error(`Не удалось запустить ${file} в выбранной вкладке.`);
  return ping;
}

async function validateChatBinding(binding) {
  const tab=await getTab(binding?.tabId);
  if(!isChat(tab.url)) throw new Error('Привязанная ChatGPT-вкладка больше не является ChatGPT.');
  const ping=await ensureScript(tab.id,'chatgpt-bridge.js','AGENCY_CHAT_PING');
  const expected=String(binding?.conversationKey||'');
  if(expected && ping.conversationKey !== expected) throw new Error('В выбранной вкладке открыт другой разговор ChatGPT. Перепривяжите чат.');
  if(!ping.composer) throw new Error('ChatGPT открыт, но поле ввода не найдено. Обновите страницу ChatGPT.');
  return {tab,ping};
}

async function validateTargetBinding(binding) {
  const tab=await getTab(binding?.tabId);
  if(!isHttp(tab.url) || isChat(tab.url)) throw new Error('Рабочая вкладка недоступна или указывает на ChatGPT.');
  const currentOrigin=originOf(tab.url);
  if(!binding?.origin || currentOrigin !== binding.origin) throw new Error('Рабочая вкладка ушла на другой сайт. Перепривяжите её явно.');
  const ping=await ensureScript(tab.id,'page-agent.js','AGENCY_PAGE_PING');
  return {tab,ping};
}

async function waitForTabComplete(tabId, timeoutMs=15000) {
  const start=Date.now();
  while(Date.now()-start<timeoutMs){
    const t=await getTab(tabId);
    if(t.status==='complete') return t;
    await new Promise(r=>setTimeout(r,250));
  }
  throw new Error('Страница не загрузилась за 15 секунд.');
}

async function executeTarget(binding,action,confirmation) {
  const {tab}=await validateTargetBinding(binding);
  if(action.type==='navigate') {
    const verdict=AgencyPolicy.assess(action,{found:true},binding.origin);
    if(verdict.decision!=='allow') return {ok:false,policy:verdict};
    await chrome.tabs.update(tab.id,{url:new URL(action.url,binding.origin).href});
    await waitForTabComplete(tab.id);
    await ensureScript(tab.id,'page-agent.js','AGENCY_PAGE_PING');
    return {ok:true,result:{ok:true,type:'navigate',url:stripUrl((await getTab(tab.id)).url)}};
  }

  const pf=await sendTab(tab.id,{type:'AGENCY_PREFLIGHT',action},8000);
  if(!pf?.ok) throw new Error(pf?.error||'Preflight failed');
  const verdict=AgencyPolicy.assess(action,pf.preflight,binding.origin);
  if(verdict.decision==='block') return {ok:false,policy:verdict,preflight:pf.preflight};
  if(verdict.decision==='confirm') {
    const id=verdict.confirmationId;
    const valid=confirmation?.confirmedByUser===true && confirmation?.confirmationId===id && !usedConfirmations.has(id);
    if(!valid) return {ok:false,requiresConfirmation:true,confirmationId:id,reason:verdict.reason,preflight:pf.preflight};
    usedConfirmations.add(id);
  }
  const out=await sendTab(tab.id,{type:'AGENCY_EXECUTE',action},15000);
  if(!out?.ok) throw new Error(out?.error||'Execute failed');
  return {ok:true,result:out.result,preflight:pf.preflight,confirmed:verdict.decision==='confirm'};
}

chrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{
  (async()=>{
    try {
      if(msg?.type==='LIST_TABS') {
        const tabs=await chrome.tabs.query({});
        return sendResponse({ok:true,tabs:tabs.filter(t=>isHttp(t.url)).map(t=>({id:t.id,title:t.title||'',url:stripUrl(t.url),isChat:isChat(t.url)}))});
      }
      if(msg?.type==='BIND_CHAT') {
        const tab=await getTab(msg.tabId);
        if(!isChat(tab.url)) throw new Error('Выберите вкладку chatgpt.com.');
        const ping=await ensureScript(tab.id,'chatgpt-bridge.js','AGENCY_CHAT_PING');
        if(!ping.composer) throw new Error('Не найдено поле ввода ChatGPT. Обновите вкладку и попробуйте снова.');
        return sendResponse({ok:true,binding:{tabId:tab.id,conversationKey:ping.conversationKey,title:tab.title||'ChatGPT'}});
      }
      if(msg?.type==='BIND_TARGET') {
        const tab=await getTab(msg.tabId);
        if(!isHttp(tab.url)||isChat(tab.url)) throw new Error('Выберите обычный рабочий сайт.');
        await ensureScript(tab.id,'page-agent.js','AGENCY_PAGE_PING');
        return sendResponse({ok:true,binding:{tabId:tab.id,origin:originOf(tab.url),title:tab.title||'',url:stripUrl(tab.url)}});
      }
      if(msg?.type==='PING_BINDINGS') {
        const chat=msg.chatBinding ? await validateChatBinding(msg.chatBinding) : null;
        const target=msg.targetBinding ? await validateTargetBinding(msg.targetBinding) : null;
        return sendResponse({ok:true,chat:chat?.ping||null,target:target?.ping||null});
      }
      if(msg?.type==='ASK_CHATGPT') {
        const {tab}=await validateChatBinding(msg.binding);
        const out=await sendTab(tab.id,{type:'AGENCY_CHAT_ASK',prompt:String(msg.prompt||''),requestId:String(msg.requestId||'')},170000);
        if(!out?.ok) throw new Error(out?.error||'ChatGPT bridge failed');
        if(out.conversationKey !== msg.binding.conversationKey) throw new Error('ChatGPT переключился на другой разговор во время выполнения.');
        return sendResponse({ok:true,answer:out.answer,requestId:out.requestId,conversationKey:out.conversationKey});
      }
      if(msg?.type==='SCAN_TARGET') {
        const {tab}=await validateTargetBinding(msg.binding);
        const out=await sendTab(tab.id,{type:'AGENCY_SCAN'},10000);
        if(!out?.ok) throw new Error(out?.error||'Scan failed');
        return sendResponse({ok:true,snapshot:out.snapshot});
      }
      if(msg?.type==='EXECUTE_TARGET') {
        const out=await executeTarget(msg.binding,msg.action||{},msg.confirmation||null);
        return sendResponse(out);
      }
      if(msg?.type==='VERIFY_TARGET') {
        const {tab}=await validateTargetBinding(msg.binding);
        const out=await sendTab(tab.id,{type:'AGENCY_VERIFY',payload:msg.payload||{}},12000);
        if(!out?.ok) throw new Error(out?.error||'Verify failed');
        return sendResponse({ok:true,result:out.result});
      }
      return sendResponse({ok:false,error:'Unknown background message'});
    } catch(e) { return sendResponse({ok:false,error:String(e?.message||e)}); }
  })();
  return true;
});
