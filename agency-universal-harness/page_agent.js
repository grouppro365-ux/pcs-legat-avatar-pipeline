(() => {
  const refs = new Map();
  const reverseRefs = new WeakMap();
  let nextRef = 1;
  let epoch = 0;

  const SECRET_INPUT = /(password|passcode|otp|one[- ]?time|2fa|cvv|cvc|card|парол|код подтверждения|номер карты)/i;
  const cleanText = globalThis.AUH_LOCATOR?.clean || ((s,max=240)=>String(s||'').replace(/\s+/g,' ').trim().slice(0,max));

  function redact(text) {
    return String(text || '')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
      .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, '[PHONE]')
      .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[CARD_OR_NUMBER]')
      .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,}|token[=:]\s*[A-Za-z0-9._-]{12,})\b/gi, '[TOKEN]');
  }

  function safeUrl() {
    try { const u = new URL(location.href); return `${u.origin}${u.pathname}`; }
    catch { return ''; }
  }

  function pageFingerprint() {
    const body = redact(cleanText(document.body?.innerText, 1800));
    return `${safeUrl()}|${document.title}|${body}`;
  }

  function refFor(el) {
    const existing = reverseRefs.get(el);
    if (existing) return existing;
    const ref = `r${nextRef++}`;
    reverseRefs.set(el, ref);
    refs.set(ref, el);
    return ref;
  }

  function pruneRefs() {
    for (const [ref, el] of refs.entries()) if (!el?.isConnected) refs.delete(ref);
  }

  function scan() {
    epoch += 1;
    pruneRefs();
    if (!globalThis.AUH_LOCATOR) return {epoch,url:safeUrl(),title:document.title,visibleText:'',elements:[],fingerprint:pageFingerprint(),error:'LOCATOR_ENGINE_NOT_READY'};
    const nodes = AUH_LOCATOR.interactiveNodes(320);
    const elements = nodes.map(el => {
      const d = AUH_LOCATOR.descriptor(el);
      const ref = refFor(el);
      const label = `${d.name} ${d.hints?.placeholder || ''}`.trim();
      return {
        ref,
        ...d,
        sensitive: SECRET_INPUT.test(label) || String(el.type || '').toLowerCase() === 'password'
      };
    });
    return {
      epoch,
      url: safeUrl(),
      title: cleanText(document.title, 240),
      visibleText: redact(cleanText(document.body?.innerText || '', 8000)),
      elements,
      fingerprint: pageFingerprint()
    };
  }

  function setNativeValue(el, value) {
    const tag = el.tagName.toLowerCase();
    if (el.isContentEditable) {
      el.focus();
      el.textContent = value;
      el.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:value}));
      el.dispatchEvent(new Event('change', {bubbles:true}));
      return;
    }
    const proto = tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc?.set) desc.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', {bubbles:true}));
    el.dispatchEvent(new Event('change', {bubbles:true}));
  }

  function valueOf(el) {
    if (el.isContentEditable) return cleanText(el.innerText || el.textContent, 3000);
    if ('checked' in el && (el.type === 'checkbox' || el.type === 'radio')) return String(!!el.checked);
    return String(el.value ?? '');
  }

  function waitForMutation(before, timeoutMs = 3500) {
    return new Promise(resolve => {
      if (pageFingerprint() !== before) return resolve({changed:true, fingerprint:pageFingerprint()});
      let done = false;
      const finish = changed => {
        if (done) return;
        done = true;
        observer.disconnect();
        clearTimeout(timer);
        resolve({changed, fingerprint:pageFingerprint()});
      };
      const observer = new MutationObserver(() => {
        if (pageFingerprint() !== before) finish(true);
      });
      observer.observe(document.documentElement, {subtree:true, childList:true, attributes:true, characterData:true});
      const timer = setTimeout(() => finish(pageFingerprint() !== before), timeoutMs);
    });
  }

  async function waitForCondition(action) {
    const timeout = Math.min(Math.max(Number(action.timeoutMs) || 5000, 250), 20000);
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const text = cleanText(document.body?.innerText || '', 12000);
      if (action.textIncludes && text.toLowerCase().includes(String(action.textIncludes).toLowerCase())) return {ok:true, verified:true, evidence:{type:'wait_text', includes:String(action.textIncludes)}};
      if (action.urlIncludes && safeUrl().includes(String(action.urlIncludes))) return {ok:true, verified:true, evidence:{type:'wait_url', includes:String(action.urlIncludes)}};
      await new Promise(r => setTimeout(r, 150));
    }
    return {ok:false, error:'WAIT_TIMEOUT', recoverable:true};
  }

  function resolveTarget(target) {
    if (!globalThis.AUH_LOCATOR) return {ok:false,error:'LOCATOR_ENGINE_NOT_READY',recoverable:true};
    return AUH_LOCATOR.resolve(target || {}, refs);
  }

  async function act(action) {
    if (!action || typeof action !== 'object') return {ok:false, error:'BAD_ACTION'};
    if (action.type === 'wait') return waitForCondition(action);

    if (action.type === 'navigate') {
      try {
        const next = new URL(action.url, location.href);
        if (!/^https?:$/.test(next.protocol)) return {ok:false, error:'UNSUPPORTED_URL_SCHEME'};
        location.href = next.href;
        return {ok:true, verified:true, navigation:true, expectedUrl:`${next.origin}${next.pathname}`, expectedOrigin:next.origin, evidence:{type:'navigate',url:`${next.origin}${next.pathname}`}};
      } catch { return {ok:false, error:'BAD_URL'}; }
    }

    if (action.type === 'scroll' && !action.target?.ref && !action.target?.name && !action.target?.text) {
      const y = Number(action.y ?? action.deltaY ?? 700);
      window.scrollBy({top:Number.isFinite(y)?y:700, behavior:'auto'});
      return {ok:true, verified:true, evidence:{type:'scroll',y:window.scrollY}};
    }

    const resolved = resolveTarget(action.target);
    if (!resolved.ok) return resolved;
    const el = resolved.el;
    const label = `${AUH_LOCATOR.nameOf(el)} ${el.getAttribute('placeholder') || ''}`;
    if (SECRET_INPUT.test(label) || String(el.type || '').toLowerCase() === 'password') return {ok:false, error:'SECRET_FIELD_BLOCKED'};
    const recovery = {recovered:!!resolved.recovered, locatorMethod:resolved.method, locatorScore:resolved.score};

    if (action.type === 'fill') {
      setNativeValue(el, String(action.value ?? ''));
      const actual = valueOf(el);
      const ok = actual === String(action.value ?? '');
      return {ok, verified:ok, ...recovery, evidence:{type:'field_value', actual:ok?'[MATCH]':cleanText(actual,160)}};
    }

    if (action.type === 'select') {
      if (el.tagName !== 'SELECT') return {ok:false, error:'NOT_SELECT', recoverable:true};
      const wanted = String(action.value ?? '');
      const opt = Array.from(el.options).find(o => o.value === wanted || cleanText(o.text) === wanted);
      if (!opt) return {ok:false, error:'OPTION_NOT_FOUND', recoverable:true};
      el.value = opt.value;
      el.dispatchEvent(new Event('input', {bubbles:true}));
      el.dispatchEvent(new Event('change', {bubbles:true}));
      const ok = el.value === opt.value;
      return {ok, verified:ok, ...recovery, evidence:{type:'select_value', actual:ok?'[MATCH]':cleanText(el.value,120)}};
    }

    if (action.type === 'check' || action.type === 'uncheck') {
      if (!('checked' in el)) return {ok:false,error:'NOT_CHECKABLE',recoverable:true};
      const desired = action.type === 'check';
      if (!!el.checked !== desired) el.click();
      const ok = !!el.checked === desired;
      return {ok, verified:ok, ...recovery, evidence:{type:'checked',value:!!el.checked}};
    }

    if (action.type === 'assert') {
      const actual = valueOf(el) || cleanText(el.innerText || el.textContent, 3000);
      let ok = false;
      if (action.equals != null) ok = actual === String(action.equals);
      if (action.includes != null) ok = actual.toLowerCase().includes(String(action.includes).toLowerCase());
      return {ok, verified:ok, ...recovery, evidence:{type:'assert',actual:cleanText(actual,240)}};
    }

    if (action.type === 'hover') {
      el.scrollIntoView({block:'center',inline:'center'});
      el.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
      el.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}));
      return {ok:true, verified:true, ...recovery, evidence:{type:'hover',target:AUH_LOCATOR.nameOf(el)}};
    }

    if (action.type === 'scroll') {
      el.scrollIntoView({block:action.block || 'center',inline:'nearest'});
      return {ok:true, verified:true, ...recovery, evidence:{type:'scroll_to',target:AUH_LOCATOR.nameOf(el)}};
    }

    if (action.type === 'click') {
      if (el.tagName === 'A' && el.href) {
        try {
          const next = new URL(el.href, location.href);
          if (!/^https?:$/.test(next.protocol)) return {ok:false,error:'UNSUPPORTED_URL_SCHEME'};
        } catch {}
      }
      const form = el.closest('form');
      if (form?.action) {
        try {
          const next = new URL(form.action, location.href);
          if (next.origin !== location.origin) return {ok:false,error:'CROSS_ORIGIN_FORM_BLOCKED'};
        } catch {}
      }
      const before = pageFingerprint();
      const beforeUrl = safeUrl();
      el.scrollIntoView({block:'center',inline:'center'});
      el.click();
      const change = await waitForMutation(before);
      const afterUrl = safeUrl();
      const navigation = afterUrl !== beforeUrl;
      return {
        ok:true,
        verified:change.changed || navigation,
        navigation,
        expectedUrl:navigation ? afterUrl : undefined,
        expectedOrigin:navigation ? location.origin : undefined,
        ...recovery,
        evidence:{type:'state_change',changed:change.changed,navigation}
      };
    }

    return {ok:false, error:'ACTION_NOT_SUPPORTED'};
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'AUH_PAGE_PING') { sendResponse({ok:true,url:safeUrl(),epoch}); return; }
    if (msg?.type === 'AUH_PAGE_SCAN') { sendResponse({ok:true,scan:scan()}); return; }
    if (msg?.type === 'AUH_PAGE_ACT') {
      Promise.resolve(act(msg.action)).then(sendResponse).catch(err => sendResponse({ok:false,error:String(err?.message || err)}));
      return true;
    }
  });
})();
