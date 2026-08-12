(() => {
  if (window.__agencyPageAgentLoaded) return;
  window.__agencyPageAgentLoaded = true;

  const MAX_TEXT = 7000;
  const MAX_ELEMENTS = 120;

  function redact(s='') {
    return String(s)
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
      .replace(/\+?\d[\d\s().-]{7,}\d/g, '[PHONE]')
      .replace(/\b\d{13,19}\b/g, '[NUMBER]')
      .replace(/(token|secret|api[_ -]?key)\s*[:=]\s*\S+/gi, '$1=[REDACTED]');
  }

  function visible(el) {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  }

  function cssEscape(v) { return CSS.escape(String(v)); }

  function selectorFor(el) {
    if (el.id) return `#${cssEscape(el.id)}`;
    for (const attr of ['data-testid','name','aria-label','placeholder']) {
      const v = el.getAttribute(attr);
      if (v) return `${el.tagName.toLowerCase()}[${attr}="${String(v).replace(/"/g,'\\"')}"]`;
    }
    const parts=[];
    let n=el;
    while (n && n.nodeType===1 && parts.length<4) {
      let part=n.tagName.toLowerCase();
      const p=n.parentElement;
      if (p) {
        const same=[...p.children].filter(x=>x.tagName===n.tagName);
        if (same.length>1) part += `:nth-of-type(${same.indexOf(n)+1})`;
      }
      parts.unshift(part);
      n=p;
    }
    return parts.join(' > ');
  }

  function labelFor(el) {
    return redact(
      el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      el.innerText ||
      el.textContent ||
      el.getAttribute('name') || ''
    ).trim().slice(0,220);
  }

  function safeUrl() {
    return `${location.origin}${location.pathname}`;
  }

  function scan() {
    const candidates=[...document.querySelectorAll('a,button,input:not([type="hidden"]):not([type="password"]),textarea,select,[contenteditable="true"],[role="button"],[role="link"],[role="textbox"]')]
      .filter(visible).slice(0,MAX_ELEMENTS);
    const elements=candidates.map((el,i)=>(
      {
        ref:`e${i+1}`,
        tag:el.tagName.toLowerCase(),
        type:el.getAttribute('type')||'',
        selector:selectorFor(el),
        label:labelFor(el),
        href: el instanceof HTMLAnchorElement ? (()=>{try{return new URL(el.href,location.href).origin===location.origin?`${new URL(el.href,location.href).origin}${new URL(el.href,location.href).pathname}`:'[EXTERNAL]'}catch{return''}})() : ''
      }
    ));
    const body=redact((document.body?.innerText||'').replace(/\s+/g,' ').trim()).slice(0,MAX_TEXT);
    return { url:safeUrl(), title:document.title, visibleText:body, elements };
  }

  function get(selector) {
    if (!selector) return null;
    try { return document.querySelector(selector); } catch { return null; }
  }

  function externalDestination(el, allowedOrigin) {
    try {
      if (el instanceof HTMLAnchorElement && el.href) return new URL(el.href, location.href).origin !== allowedOrigin;
      const form=el.closest?.('form');
      if (form?.action) return new URL(form.action, location.href).origin !== allowedOrigin;
    } catch { return true; }
    return false;
  }

  function setValue(el, value) {
    if (el.matches('input,textarea')) {
      const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      const desc=Object.getOwnPropertyDescriptor(proto,'value');
      desc?.set?.call(el,value);
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      return;
    }
    if (el.isContentEditable) {
      el.focus();
      el.textContent=value;
      el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));
      return;
    }
    throw new Error('Элемент не поддерживает ввод.');
  }

  async function action(a, allowedOrigin) {
    if (a.type==='wait') {
      await new Promise(r=>setTimeout(r,Math.min(Math.max(Number(a.ms)||500,0),5000)));
      return {ok:true};
    }
    if (a.type==='navigate') {
      const u=new URL(a.url,location.href);
      if (u.origin!==allowedOrigin) return {ok:false,error:'Cross-origin navigation blocked'};
      location.href=u.href;
      return {ok:true,verified:true,navigated:`${u.origin}${u.pathname}`};
    }
    if (a.type==='assert' && a.urlIncludes!=null) {
      const actual=safeUrl();
      const ok=actual.includes(String(a.urlIncludes));
      return {ok,actual};
    }
    const el=get(a.selector);
    if (!el) return {ok:false,error:`Элемент не найден: ${a.selector||'(empty)'}`};

    if (a.type==='fill') {
      if (/password|otp|cvv|cvc/i.test([el.type,el.name,el.autocomplete,el.getAttribute('aria-label')].join(' '))) return {ok:false,error:'Sensitive field blocked'};
      setValue(el,String(a.value??''));
      const actual=el.isContentEditable?el.textContent:el.value;
      return {ok:true,verified:String(actual)===String(a.value??''),actualLength:String(actual||'').length};
    }
    if (a.type==='select') {
      if (!(el instanceof HTMLSelectElement)) return {ok:false,error:'Это не select'};
      el.value=String(a.value??'');
      el.dispatchEvent(new Event('change',{bubbles:true}));
      return {ok:true,verified:el.value===String(a.value??'')};
    }
    if (a.type==='click') {
      if (externalDestination(el,allowedOrigin)) return {ok:false,error:'Cross-origin click blocked'};
      el.scrollIntoView({block:'center',behavior:'auto'});
      el.click();
      return {ok:true};
    }
    if (a.type==='assert') {
      const actual=el.matches('input,textarea,select')?el.value:(el.isContentEditable?el.textContent:(el.innerText||el.textContent||''));
      let ok=true;
      if (a.equals!=null) ok=String(actual).trim()===String(a.equals).trim();
      if (a.includes!=null) ok=String(actual).toLowerCase().includes(String(a.includes).toLowerCase());
      return {ok,actual:redact(String(actual)).slice(0,500)};
    }
    return {ok:false,error:'Unknown action'};
  }

  chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
    (async()=>{
      if (msg.type==='PAGE_PING') return {ok:true,version:'0.3.1'};
      if (msg.type==='PAGE_SCAN') return {ok:true,scan:scan()};
      if (msg.type==='PAGE_ACTION') return await action(msg.action||{},msg.allowedOrigin||location.origin);
      return {ok:false,error:'Unknown message'};
    })().then(sendResponse).catch(e=>sendResponse({ok:false,error:e.message||String(e)}));
    return true;
  });
})();
