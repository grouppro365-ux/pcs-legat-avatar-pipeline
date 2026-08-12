(() => {
  const refs = new Map();
  let epoch = 0;

  const SECRET_INPUT = /(password|passcode|otp|one[- ]?time|2fa|cvv|cvc|card|парол|код подтверждения|номер карты)/i;

  function cleanText(s, max = 240) {
    return String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function redact(text) {
    return String(text || '')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
      .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, '[PHONE]')
      .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[CARD_OR_NUMBER]')
      .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,}|token[=:]\s*[A-Za-z0-9._-]{12,})\b/gi, '[TOKEN]');
  }

  function safeUrl() {
    try {
      const u = new URL(location.href);
      return `${u.origin}${u.pathname}`;
    } catch { return ''; }
  }

  function roleOf(el) {
    return cleanText(el.getAttribute('role') || ({BUTTON:'button',A:'link',INPUT:'input',TEXTAREA:'textbox',SELECT:'combobox'}[el.tagName] || el.tagName.toLowerCase()), 60);
  }

  function nameOf(el) {
    const labelled = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('name') || '';
    if (labelled) return cleanText(labelled, 140);
    const id = el.id;
    if (id) {
      const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (lab) return cleanText(lab.innerText, 140);
    }
    return cleanText(el.innerText || el.textContent || el.placeholder || '', 140);
  }

  function stableHints(el) {
    return {
      id: cleanText(el.id, 100),
      name: cleanText(el.getAttribute('name'), 100),
      testid: cleanText(el.getAttribute('data-testid'), 100),
      aria: cleanText(el.getAttribute('aria-label'), 140),
      placeholder: cleanText(el.getAttribute('placeholder'), 140),
      type: cleanText(el.getAttribute('type'), 40)
    };
  }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || 1) > 0 && r.width > 0 && r.height > 0;
  }

  function pageFingerprint() {
    const body = redact(cleanText(document.body?.innerText, 1600));
    return `${safeUrl()}|${document.title}|${body}`;
  }

  function scan() {
    epoch += 1;
    refs.clear();
    const selector = 'button,a[href],input,textarea,select,[contenteditable="true"],[role="button"],[role="link"],[role="textbox"],[role="combobox"],[role="checkbox"],[role="radio"]';
    const nodes = Array.from(document.querySelectorAll(selector)).filter(visible).slice(0, 220);
    const elements = nodes.map((el, i) => {
      const ref = `e${epoch}_${i+1}`;
      refs.set(ref, el);
      const hints = stableHints(el);
      const label = `${nameOf(el)} ${hints.placeholder}`.trim();
      return {
        ref,
        role: roleOf(el),
        name: nameOf(el),
        label: cleanText(label, 180),
        text: cleanText(el.innerText || el.textContent, 180),
        tag: el.tagName.toLowerCase(),
        hints,
        sensitive: SECRET_INPUT.test(label) || String(el.type || '').toLowerCase() === 'password'
      };
    });

    const visibleText = redact(cleanText(document.body?.innerText || '', 7000));
    return {
      epoch,
      url: safeUrl(),
      title: cleanText(document.title, 240),
      visibleText,
      elements,
      fingerprint: pageFingerprint()
    };
  }

  function currentElement(ref) {
    const el = refs.get(ref);
    return el && el.isConnected ? el : null;
  }

  function setNativeValue(el, value) {
    const tag = el.tagName.toLowerCase();
    if (el.isContentEditable) {
      el.focus();
      el.textContent = value;
      el.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:value}));
      return;
    }
    const proto = tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc?.set) desc.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', {bubbles:true}));
    el.dispatchEvent(new Event('change', {bubbles:true}));
  }

  function valueOf(el) {
    if (el.isContentEditable) return cleanText(el.innerText || el.textContent, 2000);
    return String(el.value ?? '');
  }

  function waitForMutation(before, timeoutMs = 4500) {
    return new Promise(resolve => {
      if (pageFingerprint() !== before) return resolve({changed:true, fingerprint:pageFingerprint()});
      let done = false;
      const finish = (changed) => {
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
    const timeout = Math.min(Math.max(Number(action.timeoutMs) || 5000, 250), 15000);
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const text = cleanText(document.body?.innerText || '', 8000);
      if (action.textIncludes && text.toLowerCase().includes(String(action.textIncludes).toLowerCase())) return {ok:true};
      if (action.urlIncludes && safeUrl().includes(String(action.urlIncludes))) return {ok:true};
      await new Promise(r => setTimeout(r, 150));
    }
    return {ok:false, error:'WAIT_TIMEOUT'};
  }

  async function act(action) {
    if (!action || typeof action !== 'object') return {ok:false, error:'BAD_ACTION'};
    if (action.type === 'wait') return waitForCondition(action);
    if (action.type === 'navigate') {
      try {
        const next = new URL(action.url, location.href);
        if (next.origin !== location.origin) return {ok:false, error:'CROSS_ORIGIN_REBIND_REQUIRED'};
        location.href = next.href;
        return {ok:true, navigation:true, expectedUrl:`${next.origin}${next.pathname}`};
      } catch { return {ok:false, error:'BAD_URL'}; }
    }

    const el = currentElement(action.target?.ref);
    if (!el) return {ok:false, error:'STALE_OR_UNKNOWN_REF'};
    const label = `${nameOf(el)} ${el.getAttribute('placeholder') || ''}`;
    if (SECRET_INPUT.test(label) || String(el.type || '').toLowerCase() === 'password') return {ok:false, error:'SECRET_FIELD_BLOCKED'};

    if (action.type === 'fill') {
      setNativeValue(el, String(action.value ?? ''));
      const actual = valueOf(el);
      const ok = actual === String(action.value ?? '');
      return {ok, verified:ok, evidence:{type:'field_value', actual: ok ? '[MATCH]' : cleanText(actual, 160)}};
    }

    if (action.type === 'select') {
      if (el.tagName !== 'SELECT') return {ok:false, error:'NOT_SELECT'};
      const wanted = String(action.value ?? '');
      const opt = Array.from(el.options).find(o => o.value === wanted || cleanText(o.text) === wanted);
      if (!opt) return {ok:false, error:'OPTION_NOT_FOUND'};
      el.value = opt.value;
      el.dispatchEvent(new Event('change', {bubbles:true}));
      const ok = el.value === opt.value;
      return {ok, verified:ok, evidence:{type:'select_value', actual: ok ? '[MATCH]' : cleanText(el.value, 120)}};
    }

    if (action.type === 'assert') {
      const actual = valueOf(el) || cleanText(el.innerText || el.textContent, 2000);
      let ok = false;
      if (action.equals != null) ok = actual === String(action.equals);
      if (action.includes != null) ok = actual.toLowerCase().includes(String(action.includes).toLowerCase());
      return {ok, verified:ok, evidence:{type:'assert', actual: cleanText(actual, 220)}};
    }

    if (action.type === 'click') {
      if (el.tagName === 'A' && el.href) {
        const next = new URL(el.href, location.href);
        if (next.origin !== location.origin) return {ok:false, error:'CROSS_ORIGIN_REBIND_REQUIRED'};
      }
      const form = el.closest('form');
      if (form?.action) {
        const next = new URL(form.action, location.href);
        if (next.origin !== location.origin) return {ok:false, error:'CROSS_ORIGIN_REBIND_REQUIRED'};
      }
      const before = pageFingerprint();
      el.scrollIntoView({block:'center', inline:'center'});
      el.click();
      const change = await waitForMutation(before);
      return {ok:true, verified:change.changed, evidence:{type:'state_change', changed:change.changed}};
    }

    return {ok:false, error:'ACTION_NOT_SUPPORTED'};
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'AUH_PAGE_PING') { sendResponse({ok:true, url:safeUrl()}); return; }
    if (msg?.type === 'AUH_PAGE_SCAN') { sendResponse({ok:true, scan:scan()}); return; }
    if (msg?.type === 'AUH_PAGE_ACT') {
      Promise.resolve(act(msg.action)).then(result => sendResponse(result)).catch(err => sendResponse({ok:false, error:String(err?.message || err)}));
      return true;
    }
  });
})();
