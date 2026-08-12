(() => {
  if (globalThis.__AGENCY_PAGE_AGENT_V03__) return;
  globalThis.__AGENCY_PAGE_AGENT_V03__ = true;

  const MAX_TEXT = 7000;
  const registry = new Map();
  const INTERACTIVE = 'a[href],button,input,textarea,select,[contenteditable="true"],[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="switch"],[tabindex]';
  const SENSITIVE = /password|passwd|passcode|otp|one.?time|cvv|cvc|card.?number|bank.?account|iban|swift|secret|token|api.?key|private.?key|парол|код из смс|одноразов|номер карты|банковск|секрет|токен|ключ api/i;

  const clean = (s, n = 180) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const safeUrl = (raw = location.href) => {
    try { const u = new URL(raw, location.href); return `${u.origin}${u.pathname}`; }
    catch { return ''; }
  };
  const redact = (s) => {
    let out = String(s || '');
    out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]');
    out = out.replace(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, '[PHONE]');
    out = out.replace(/\b(?:\d[ -]*?){13,19}\b/g, '[CARD_OR_LONG_NUMBER]');
    out = out.replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/gi, '[IBAN]');
    out = out.replace(/(?:api[_ -]?key|token|secret|password)\s*[:=]\s*\S+/gi, '$1=[REDACTED]');
    return out;
  };

  function visible(el) {
    if (!el || !(el instanceof Element)) return false;
    const st = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return st.display !== 'none' && st.visibility !== 'hidden' && Number(st.opacity || 1) !== 0 && r.width > 0 && r.height > 0;
  }

  function associatedLabel(el) {
    const parts = [];
    if (el.labels) for (const l of el.labels) parts.push(clean(l.innerText || l.textContent));
    if (el.id) {
      try {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l) parts.push(clean(l.innerText || l.textContent));
      } catch {}
    }
    const aria = el.getAttribute?.('aria-label'); if (aria) parts.push(clean(aria));
    const ph = el.getAttribute?.('placeholder'); if (ph) parts.push(clean(ph));
    const title = el.getAttribute?.('title'); if (title) parts.push(clean(title));
    if (['BUTTON','A'].includes(el.tagName) || el.getAttribute?.('role')) parts.push(clean(el.innerText || el.textContent));
    return clean(parts.filter(Boolean).join(' · '), 220);
  }

  function signature(el) {
    const attrs = [
      el.id && `id=${el.id}`,
      el.getAttribute?.('name') && `name=${el.getAttribute('name')}`,
      el.getAttribute?.('data-testid') && `testid=${el.getAttribute('data-testid')}`,
      el.getAttribute?.('aria-label') && `aria=${clean(el.getAttribute('aria-label'),80)}`,
      el.getAttribute?.('role') && `role=${el.getAttribute('role')}`,
      el.getAttribute?.('type') && `type=${el.getAttribute('type')}`,
      `tag=${el.tagName}`,
      `label=${associatedLabel(el)}`
    ].filter(Boolean).join('|');
    let h = 2166136261;
    for (let i = 0; i < attrs.length; i++) { h ^= attrs.charCodeAt(i); h = Math.imul(h, 16777619); }
    return `el_${(h >>> 0).toString(16)}`;
  }

  function collect() {
    registry.clear();
    const els = [...document.querySelectorAll(INTERACTIVE)].filter(visible).slice(0, 120);
    const items = [];
    for (const el of els) {
      const ref = signature(el);
      if (!registry.has(ref)) registry.set(ref, el);
      let href = '';
      if (el instanceof HTMLAnchorElement && el.href) {
        try { const u = new URL(el.href); href = u.origin === location.origin ? u.pathname : '[external]'; } catch {}
      }
      items.push({
        ref,
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || '',
        type: el.getAttribute('type') || '',
        label: redact(associatedLabel(el)),
        href,
        disabled: !!(el.disabled || el.getAttribute('aria-disabled') === 'true')
      });
    }
    const body = redact((document.body?.innerText || '').replace(/\s+/g,' ').trim()).slice(0, MAX_TEXT);
    return { url: safeUrl(), title: clean(document.title, 200), visibleText: body, elements: items };
  }

  function resolve(ref) {
    if (!ref) return null;
    if (registry.has(ref) && document.contains(registry.get(ref))) return registry.get(ref);
    for (const el of [...document.querySelectorAll(INTERACTIVE)].filter(visible)) {
      if (signature(el) === ref) { registry.set(ref, el); return el; }
    }
    return null;
  }

  function isSensitive(el) {
    if (!el) return false;
    const text = `${el.getAttribute?.('type') || ''} ${el.getAttribute?.('name') || ''} ${el.id || ''} ${associatedLabel(el)}`;
    return SENSITIVE.test(text) || el.getAttribute?.('autocomplete') === 'one-time-code' || el.getAttribute?.('autocomplete') === 'cc-number';
  }

  function actualValue(el) {
    if (!el) return '';
    if (el instanceof HTMLSelectElement) return el.value;
    if ('value' in el) return String(el.value ?? '');
    if (el.isContentEditable) return (el.innerText || el.textContent || '').trim();
    return (el.innerText || el.textContent || '').trim();
  }

  function preflight(action) {
    if (action.type === 'navigate' || action.type === 'wait') return { found: true };
    const el = resolve(action.ref);
    if (!el) return { found: false };
    const label = associatedLabel(el);
    let externalOrigin = false;
    let destination = '';
    const anchor = el.closest?.('a[href]');
    if (anchor?.href) {
      try { const u = new URL(anchor.href, location.href); destination = safeUrl(u.href); externalOrigin = u.origin !== location.origin; } catch {}
    }
    const form = el.closest?.('form');
    if (!externalOrigin && form?.action) {
      try { const u = new URL(form.action, location.href); if (u.origin !== location.origin) { externalOrigin = true; destination = safeUrl(u.href); } } catch {}
    }
    return {
      found: true,
      ref: action.ref,
      label,
      title: clean(el.getAttribute?.('title')),
      aria: clean(el.getAttribute?.('aria-label')),
      name: clean(el.getAttribute?.('name')),
      type: clean(el.getAttribute?.('type')),
      sensitive: isSensitive(el),
      externalOrigin,
      destination
    };
  }

  function setNativeValue(el, value) {
    if (el instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
      setter ? setter.call(el, value) : (el.value = value);
    } else if (el instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')?.set;
      setter ? setter.call(el, value) : (el.value = value);
    } else if (el.isContentEditable) {
      el.focus();
      const sel = getSelection(); const range = document.createRange(); range.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(range);
      if (!document.execCommand('insertText', false, value)) el.textContent = value;
    } else if ('value' in el) el.value = value;
    el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
  }

  async function execute(action) {
    const type = action.type;
    if (type === 'wait') {
      const ms = Math.max(100, Math.min(Number(action.ms || 800), 5000));
      await new Promise(r => setTimeout(r, ms));
      return { ok: true, type, ms };
    }
    const el = resolve(action.ref);
    if (!el) return { ok:false, type, error:'Элемент не найден.' };
    if (isSensitive(el)) return { ok:false, type, error:'Чувствительное поле заблокировано.' };
    el.scrollIntoView({block:'center', inline:'center'});
    await new Promise(r=>setTimeout(r,120));

    if (type === 'click') {
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') return {ok:false,type,error:'Элемент disabled.'};
      el.click();
      return { ok:true, type, ref:action.ref, label:associatedLabel(el) };
    }
    if (type === 'fill') {
      const v = String(action.value ?? '');
      setNativeValue(el, v);
      await new Promise(r=>setTimeout(r,80));
      const actual = actualValue(el);
      return { ok: actual === v, type, ref:action.ref, expected:v, actual: actual === v ? actual : '[MISMATCH]' };
    }
    if (type === 'select') {
      if (!(el instanceof HTMLSelectElement)) return {ok:false,type,error:'Элемент не select.'};
      const wanted = String(action.value ?? '');
      const opt = [...el.options].find(o => o.value === wanted || clean(o.textContent) === clean(wanted));
      if (!opt) return {ok:false,type,error:'Опция не найдена.'};
      el.value = opt.value; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));
      return {ok:el.value===opt.value,type,ref:action.ref,expected:opt.value,actual:el.value};
    }
    return {ok:false,type,error:'Неизвестное действие.'};
  }

  function verifyOne(check) {
    const type = check.type;
    if (type === 'urlIncludes') return { ...check, ok: safeUrl().includes(String(check.value || '')) };
    if (type === 'textIncludes') return { ...check, ok: (document.body?.innerText || '').toLowerCase().includes(String(check.value || '').toLowerCase()) };
    const el = resolve(check.ref);
    if (!el) return { ...check, ok:false, actual:'[NOT_FOUND]' };
    if (type === 'fieldEquals') { const a = actualValue(el); return { ...check, ok:a===String(check.value ?? ''), actual:a }; }
    if (type === 'elementExists') return { ...check, ok:true };
    if (type === 'elementTextIncludes') { const a=(el.innerText||el.textContent||''); return { ...check, ok:a.toLowerCase().includes(String(check.value||'').toLowerCase()), actual:clean(a,220) }; }
    return { ...check, ok:false, actual:'[UNKNOWN_CHECK]' };
  }

  function verify(payload) {
    collect();
    const details = [];
    for (const m of payload.mutations || []) details.push(verifyOne({type:'fieldEquals',ref:m.ref,value:m.value,source:'mutation'}));
    for (const c of payload.checks || []) details.push(verifyOne(c));
    return { allPass: details.length > 0 && details.every(x=>x.ok), details };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      try {
        if (msg?.type === 'AGENCY_PAGE_PING') return sendResponse({ok:true,version:'0.3.0'});
        if (msg?.type === 'AGENCY_SCAN') return sendResponse({ok:true,snapshot:collect()});
        if (msg?.type === 'AGENCY_PREFLIGHT') { collect(); return sendResponse({ok:true,preflight:preflight(msg.action||{})}); }
        if (msg?.type === 'AGENCY_EXECUTE') return sendResponse({ok:true,result:await execute(msg.action||{})});
        if (msg?.type === 'AGENCY_VERIFY') return sendResponse({ok:true,result:verify(msg.payload||{})});
        return sendResponse({ok:false,error:'Unknown page-agent message'});
      } catch (e) { sendResponse({ok:false,error:String(e?.message||e)}); }
    })();
    return true;
  });
})();
