(() => {
  const ADAPTER_VERSION = '2.0.3';
  let activeRequest = null;

  function conversationPath() {
    const m = location.pathname.match(/^\/c\/[^/?#]+/);
    return m ? m[0] : '';
  }

  function composer() {
    return document.querySelector('#prompt-textarea') ||
      Array.from(document.querySelectorAll('[contenteditable="true"]')).find(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !el.closest('[data-message-author-role]');
      }) || null;
  }

  function textOf(el) { return String(el?.innerText || el?.textContent || '').trim(); }

  function releaseRequest(requestId) {
    if (activeRequest === requestId) activeRequest = null;
  }

  function localCollectTopLevelObjects(raw) {
    const out = [];
    let depth = 0, start = -1, inString = false, escaped = false;
    for(let i = 0; i < raw.length; i++){
      const c = raw[i];
      if(inString){
        if(escaped) escaped = false;
        else if(c === '\\') escaped = true;
        else if(c === '"') inString = false;
        continue;
      }
      if(c === '"'){ inString = true; continue; }
      if(c === '{'){ if(depth === 0) start = i; depth++; continue; }
      if(c === '}' && depth > 0){
        depth--;
        if(depth === 0 && start >= 0){ out.push(raw.slice(start, i + 1)); start = -1; }
      }
    }
    return out;
  }

  const localParser = {
    extractJson(text, expectedRequestId){
      const raw = String(text || '').replace(/```(?:json)?/gi,'').replace(/```/g,'').trim();
      const candidates = [raw, ...localCollectTopLevelObjects(raw)];
      for(const c of candidates){
        try{
          const obj = JSON.parse(c);
          if(obj && typeof obj === 'object' && !Array.isArray(obj) && obj.requestId === expectedRequestId) return obj;
        }catch{}
      }
      throw new Error('AI_JSON_PARSE_FAILED');
    }
  };

  function parser(){ return globalThis.AUH_RESPONSE_PARSER || localParser; }

  function localMatch(requestId, fragments){
    const p = parser();
    const parts = (fragments || []).map(x => String(x || '').trim()).filter(Boolean);
    const tryOne = text => {
      try{
        const obj = p.extractJson(text, requestId);
        return obj?.requestId === requestId && (obj.status === 'act' || obj.status === 'done') ? JSON.stringify(obj) : '';
      }catch{ return ''; }
    };
    for(let i=parts.length-1;i>=0;i--){ const hit=tryOne(parts[i]); if(hit) return hit; }
    const start=Math.max(0,parts.length-80);
    for(let i=parts.length-1;i>=start;i--){ const hit=tryOne(parts.slice(i).join('\n')); if(hit) return hit; }
    return tryOne(parts.slice(start).join('\n'));
  }

  function matchFragments(requestId, fragments){
    const m = globalThis.AUH_CHAT_RESPONSE_MATCHER;
    if(m?.find){
      const hit = m.find(requestId, fragments, parser());
      return hit?.text || '';
    }
    return localMatch(requestId, fragments);
  }

  function uniqueNodes(nodes){
    const seen = new Set();
    return nodes.filter(n => n && !seen.has(n) && seen.add(n));
  }

  function turnContainers(){
    return uniqueNodes([
      ...document.querySelectorAll('[data-message-author-role]'),
      ...document.querySelectorAll('[data-testid^="conversation-turn-"]'),
      ...document.querySelectorAll('article')
    ]);
  }

  function closestTurn(el){
    return el?.closest?.('[data-testid^="conversation-turn-"], article, [data-message-author-role]') || el || null;
  }

  function findUserAnchor(requestId){
    const direct = Array.from(document.querySelectorAll('[data-message-author-role="user"]'))
      .reverse().find(t => textOf(t).includes(requestId));
    if(direct) return closestTurn(direct);

    const marker = `REQUEST_ID=${requestId}`;
    const candidates = turnContainers().filter(t => {
      const txt = textOf(t);
      return txt.includes(marker) && txt.includes('ТЕКУЩАЯ СТРАНИЦА');
    });
    return candidates[candidates.length - 1] || null;
  }

  function follows(anchor, node){
    if(!anchor || !node || anchor === node || anchor.contains?.(node)) return false;
    return !!(anchor.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING);
  }

  function ignoredTextNode(node, userAnchor){
    const el = node?.parentElement;
    if(!el) return true;
    if(userAnchor?.contains?.(el)) return true;
    if(el.closest('[data-message-author-role="user"]')) return true;
    if(el.closest('#prompt-textarea, [contenteditable="true"], nav, aside')) return true;
    return false;
  }

  function collectTextAfterUser(requestId){
    const userAnchor = findUserAnchor(requestId);
    if(!userAnchor) return [];
    const root = userAnchor.closest('main') || document.querySelector('main') || document.body;
    if(!root || typeof document.createTreeWalker !== 'function') return [];

    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while((node = walker.nextNode())){
      if(!follows(userAnchor, node) || ignoredTextNode(node, userAnchor)) continue;
      const s = String(node.nodeValue || '').trim();
      if(s) out.push(s);
      if(out.length > 500) out.shift();
    }
    return out;
  }

  function findAssistantResult(requestId) {
    const userAnchor = findUserAnchor(requestId);
    if(!userAnchor) return '';

    const assistantNodes = uniqueNodes([
      ...document.querySelectorAll('[data-message-author-role="assistant"]'),
      ...document.querySelectorAll('[data-turn="assistant"]')
    ]).filter(n => follows(userAnchor, closestTurn(n) || n));

    const direct = matchFragments(requestId, assistantNodes.map(textOf));
    if(direct) return direct;

    // ChatGPT occasionally changes/duplicates its turn wrappers. Inspect all turn-like
    // containers after the exact user turn instead of trusting one CSS attribute.
    const generic = turnContainers().filter(n => follows(userAnchor, n));
    const genericHit = matchFragments(requestId, generic.map(textOf));
    if(genericHit) return genericHit;

    // Final DOM-position recovery: collect visible conversation text that occurs after
    // the matching user turn. This handles answers split across several renderer nodes.
    return matchFragments(requestId, collectTextAfterUser(requestId));
  }

  async function trustedInputAndSend(requestId, prompt, pinnedPath) {
    const el = composer();
    if (!el) throw new Error('CHATGPT_COMPOSER_NOT_FOUND');
    el.scrollIntoView({block:'nearest'});
    el.focus();

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { port.disconnect(); } catch {}
        fn(value);
      };

      const port = chrome.runtime.connect({name:'AUH_CHAT_CDP'});
      const timer = setTimeout(() => finish(reject, new Error('CHATGPT_CDP_PORT_TIMEOUT')), 12000);
      port.onMessage.addListener((msg) => {
        if (msg?.ok) finish(resolve, msg);
        else finish(reject, new Error(msg?.error || 'CHATGPT_CDP_FAILED'));
      });
      port.onDisconnect.addListener(() => {
        const err = chrome.runtime.lastError?.message;
        if (!settled && err) finish(reject, new Error(`CHATGPT_CDP_PORT_CLOSED:${err}`));
      });
      port.postMessage({type:'AUH_CHAT_CDP_INPUT_AND_SEND', requestId, prompt, pinnedPath});
    });
  }

  async function waitForUserEcho(requestId, beforeCount, timeoutMs = 12000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const userTurns = Array.from(document.querySelectorAll('[data-message-author-role="user"]'));
      if (userTurns.length > beforeCount && userTurns.some(t => textOf(t).includes(requestId))) return true;
      // Fallback for a future ChatGPT DOM where the role attribute moves.
      if(findUserAnchor(requestId)) return true;
      await new Promise(r => setTimeout(r, 120));
    }
    return false;
  }

  async function waitForAssistant(requestId, timeoutMs = 120000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const txt = findAssistantResult(requestId);
      if (txt) return txt; // JSON parser only succeeds once a complete matching object exists.
      await new Promise(r => setTimeout(r, 220));
    }
    // One last broad recovery before declaring timeout. Never discard a response that
    // is already present in the conversation DOM.
    const recovered = findAssistantResult(requestId);
    if(recovered) return recovered;
    throw new Error('CHATGPT_RESPONSE_TIMEOUT');
  }

  async function reportResult(payload) {
    return chrome.runtime.sendMessage(payload);
  }

  async function executeAsk(requestId, prompt, pinnedPath) {
    if (!pinnedPath || conversationPath() !== pinnedPath) throw new Error('SAFETY_CHAT_SWITCH');
    if (activeRequest) throw new Error('CHATGPT_BUSY');
    activeRequest = requestId;
    try {
      const beforeUsers = document.querySelectorAll('[data-message-author-role="user"]').length;
      await trustedInputAndSend(requestId, prompt, pinnedPath);

      const sent = await waitForUserEcho(requestId, beforeUsers);
      if (!sent) throw new Error('CHATGPT_SEND_UNCERTAIN_NO_RETRY');
      if (conversationPath() !== pinnedPath) throw new Error('SAFETY_CHAT_SWITCH');

      const text = await waitForAssistant(requestId);
      if (conversationPath() !== pinnedPath) throw new Error('SAFETY_CHAT_SWITCH');
      releaseRequest(requestId);
      await reportResult({type:'AUH_CHAT_RESULT', requestId, ok:true, text, conversationPath:pinnedPath});
    } catch (err) {
      // A timeout can be a detector failure rather than an absent answer. Recover from
      // the live DOM once more before surfacing an error to the service worker.
      const code = String(err?.message || err);
      if(code === 'CHATGPT_RESPONSE_TIMEOUT'){
        const recovered = findAssistantResult(requestId);
        if(recovered){
          releaseRequest(requestId);
          try{ await reportResult({type:'AUH_CHAT_RESULT', requestId, ok:true, text:recovered, conversationPath:pinnedPath, recovered:true}); }catch{}
          return;
        }
      }
      releaseRequest(requestId);
      try {
        await reportResult({type:'AUH_CHAT_RESULT', requestId, ok:false, error:code, conversationPath:conversationPath()});
      } catch {}
    } finally {
      releaseRequest(requestId);
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'AUH_CHAT_PING') {
      sendResponse({ok:!!conversationPath(), conversationPath:conversationPath(), busy:!!activeRequest, version:ADAPTER_VERSION});
      return;
    }
    if (msg?.type === 'AUH_CHAT_RECOVER') {
      if(!msg.requestId){ sendResponse({ok:false,error:'REQUEST_ID_REQUIRED'}); return; }
      const text = findAssistantResult(msg.requestId);
      sendResponse({ok:!!text, text:text || '', conversationPath:conversationPath(), version:ADAPTER_VERSION});
      return;
    }
    if (msg?.type === 'AUH_CHAT_ASK') {
      if (activeRequest) {
        sendResponse({ok:false, error:'CHATGPT_BUSY', activeRequest});
        return;
      }
      executeAsk(msg.requestId, msg.prompt, msg.pinnedPath);
      sendResponse({ok:true, accepted:true, version:ADAPTER_VERSION});
      return;
    }
  });
})();
