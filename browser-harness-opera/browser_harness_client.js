/*
 * Browser-side half of Agency Browser Harness.
 * Directly adapted from the element-cache / proxy / visibility ideas in
 * scriby/browser-harness (MIT, 2013), but runs as an MV3 content script.
 */
(() => {
  if (globalThis.__AGENCY_BROWSER_HARNESS_CLIENT__) return;
  globalThis.__AGENCY_BROWSER_HARNESS_CLIENT__ = true;

  const refByElement = new WeakMap();
  const elementByRef = new Map();
  let refSeq = 1;

  const norm = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const normLower = value => norm(value).toLowerCase();

  function isVisible(el) {
    if (!el || !(el instanceof Element) || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== 'none' &&
      s.visibility !== 'hidden' && Number(s.opacity || 1) > 0;
  }

  function textOf(el) {
    return norm([
      el?.getAttribute?.('aria-label'),
      el?.getAttribute?.('title'),
      el?.getAttribute?.('placeholder'),
      el?.innerText,
      el?.textContent
    ].filter(Boolean).join(' '));
  }

  function controlValue(el) {
    if (!el) return '';
    if (el.isContentEditable) return norm(el.innerText || el.textContent || '');
    if ('value' in el) return String(el.value ?? '');
    return textOf(el);
  }

  function roleOf(el) {
    const explicit = el.getAttribute?.('role');
    if (explicit) return explicit;
    const tag = el.tagName?.toLowerCase();
    const type = normLower(el.getAttribute?.('type'));
    if (tag === 'a' && el.hasAttribute('href')) return 'link';
    if (tag === 'button' || type === 'button' || type === 'submit') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (['button','submit','reset'].includes(type)) return 'button';
      return 'textbox';
    }
    if (el.isContentEditable) return 'textbox';
    return tag || '';
  }

  function labelOf(el) {
    if (!el) return '';
    if (el.labels?.length) return norm(Array.from(el.labels).map(textOf).join(' '));
    const aria = el.getAttribute?.('aria-label');
    if (aria) return norm(aria);
    const labelledBy = el.getAttribute?.('aria-labelledby');
    if (labelledBy) {
      const t = labelledBy.split(/\s+/).map(id => document.getElementById(id)).filter(Boolean).map(textOf).join(' ');
      if (t) return norm(t);
    }
    if (el.id) {
      try {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label) return textOf(label);
      } catch {}
    }
    const parentLabel = el.closest?.('label');
    if (parentLabel) return textOf(parentLabel);
    return '';
  }

  function nameOf(el) {
    return norm(labelOf(el) || el.getAttribute?.('aria-label') || el.getAttribute?.('name') || textOf(el));
  }

  function refFor(el) {
    let ref = refByElement.get(el);
    if (!ref) {
      ref = `bh${refSeq++}`;
      refByElement.set(el, ref);
      elementByRef.set(ref, el);
    }
    return ref;
  }

  function hrefPath(el) {
    const href = el?.href;
    if (!href) return '';
    try {
      const u = new URL(href, location.href);
      return `${u.origin}${u.pathname}`;
    } catch { return ''; }
  }

  function descriptor(el) {
    const r = el.getBoundingClientRect();
    return {
      ref: refFor(el),
      tag: el.tagName.toLowerCase(),
      role: roleOf(el),
      name: nameOf(el).slice(0, 220),
      label: labelOf(el).slice(0, 220),
      text: textOf(el).slice(0, 260),
      hints: {
        id: el.id || '',
        name: el.getAttribute('name') || '',
        testid: el.getAttribute('data-testid') || '',
        aria: el.getAttribute('aria-label') || '',
        placeholder: el.getAttribute('placeholder') || '',
        type: el.getAttribute('type') || '',
        hrefPath: hrefPath(el)
      },
      rect: {
        x: Math.round(r.x), y: Math.round(r.y),
        width: Math.round(r.width), height: Math.round(r.height)
      },
      checked: 'checked' in el ? !!el.checked : undefined,
      disabled: 'disabled' in el ? !!el.disabled : undefined
    };
  }

  function collectInteractive(root = document) {
    const selector = [
      'button','a[href]','input','textarea','select','summary',
      '[role="button"]','[role="link"]','[role="checkbox"]','[role="radio"]',
      '[role="tab"]','[role="menuitem"]','[role="combobox"]','[role="textbox"]',
      '[contenteditable="true"]','[tabindex]:not([tabindex="-1"])'
    ].join(',');
    const out = [];
    const seen = new Set();
    const visit = node => {
      const queryRoot = node instanceof Document || node instanceof ShadowRoot || node instanceof Element ? node : null;
      if (!queryRoot?.querySelectorAll) return;
      for (const el of queryRoot.querySelectorAll(selector)) {
        if (!seen.has(el) && isVisible(el)) {
          seen.add(el);
          out.push(el);
        }
        if (el.shadowRoot) visit(el.shadowRoot);
      }
      for (const host of queryRoot.querySelectorAll('*')) {
        if (host.shadowRoot) visit(host.shadowRoot);
      }
    };
    visit(root);
    return out;
  }

  function byLabel(labelText) {
    const wanted = normLower(labelText);
    if (!wanted) return [];
    const out = [];
    for (const label of document.querySelectorAll('label')) {
      if (!normLower(textOf(label)).includes(wanted)) continue;
      if (label.control) out.push(label.control);
      else {
        const id = label.getAttribute('for');
        if (id && document.getElementById(id)) out.push(document.getElementById(id));
        const nested = label.querySelector('input,textarea,select,[contenteditable="true"]');
        if (nested) out.push(nested);
      }
    }
    return out;
  }

  function uniqueVisible(items) {
    return Array.from(new Set(items.filter(Boolean))).filter(isVisible);
  }

  function resolveTarget(spec = {}) {
    const exactRef = spec.ref && elementByRef.get(String(spec.ref));
    if (exactRef?.isConnected && isVisible(exactRef)) return {el: exactRef, method: 'exact_ref'};

    if (spec.selector) {
      try {
        const found = uniqueVisible(Array.from(document.querySelectorAll(String(spec.selector))));
        if (found.length === 1) return {el: found[0], method: 'selector'};
        if (found.length > 1) return {error: 'LOCATOR_AMBIGUOUS', candidates: found.slice(0, 8).map(descriptor)};
      } catch { return {error: 'INVALID_SELECTOR'}; }
    }

    const hints = spec.hints || {};
    const exactSelectors = [];
    if (hints.id) exactSelectors.push(`#${CSS.escape(String(hints.id))}`);
    if (hints.testid) exactSelectors.push(`[data-testid="${CSS.escape(String(hints.testid))}"]`);
    if (hints.name) exactSelectors.push(`[name="${CSS.escape(String(hints.name))}"]`);
    for (const sel of exactSelectors) {
      try {
        const found = uniqueVisible(Array.from(document.querySelectorAll(sel)));
        if (found.length === 1) return {el: found[0], method: 'stable_hint'};
      } catch {}
    }

    if (spec.label) {
      const found = uniqueVisible(byLabel(spec.label));
      if (found.length === 1) return {el: found[0], method: 'label'};
    }

    const all = collectInteractive();
    const role = normLower(spec.role);
    const name = normLower(spec.name);
    const aria = normLower(hints.aria);
    const placeholder = normLower(hints.placeholder);
    const text = normLower(spec.text);
    const href = normLower(hints.hrefPath);

    const scored = [];
    for (const el of all) {
      let score = 0;
      const d = descriptor(el);
      if (role && normLower(d.role) === role) score += 30;
      if (name && normLower(d.name) === name) score += 45;
      else if (name && normLower(d.name).includes(name)) score += 25;
      if (aria && normLower(d.hints.aria) === aria) score += 45;
      if (placeholder && normLower(d.hints.placeholder) === placeholder) score += 35;
      if (href && normLower(d.hints.hrefPath) === href) score += 50;
      if (text && normLower(d.text) === text) score += 35;
      else if (text && normLower(d.text).includes(text)) score += 18;
      if (spec.tag && d.tag === String(spec.tag).toLowerCase()) score += 8;
      if (score > 0) scored.push({el, d, score});
    }
    scored.sort((a,b) => b.score - a.score);
    if (!scored.length) return {error: 'LOCATOR_NOT_FOUND'};
    if (scored.length > 1 && scored[0].score === scored[1].score && scored[0].score < 70) {
      return {error: 'LOCATOR_AMBIGUOUS', candidates: scored.slice(0,8).map(x => x.d)};
    }
    return {el: scored[0].el, method: 'semantic_fallback'};
  }

  function dispatchValueEvents(el, inputType = 'insertText', data = null) {
    try { el.dispatchEvent(new InputEvent('beforeinput', {bubbles:true, composed:true, inputType, data})); } catch {}
    try { el.dispatchEvent(new InputEvent('input', {bubbles:true, composed:true, inputType, data})); }
    catch { el.dispatchEvent(new Event('input', {bubbles:true, composed:true})); }
    el.dispatchEvent(new Event('change', {bubbles:true, composed:true}));
  }

  function setValue(el, value) {
    const text = String(value ?? '');
    el.scrollIntoView({block:'center', inline:'nearest'});
    el.focus({preventScroll:true});
    if (el.isContentEditable) {
      const selection = getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      let inserted = false;
      try { inserted = document.execCommand('insertText', false, text); } catch {}
      if (!inserted || controlValue(el) !== norm(text)) {
        el.textContent = text;
        dispatchValueEvents(el, 'insertText', text);
      }
      return;
    }
    const tag = el.tagName.toLowerCase();
    const proto = tag === 'input' ? HTMLInputElement.prototype :
      tag === 'textarea' ? HTMLTextAreaElement.prototype :
      tag === 'select' ? HTMLSelectElement.prototype : null;
    const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, text); else el.value = text;
    dispatchValueEvents(el, 'insertText', text);
  }

  async function act(action = {}) {
    const type = String(action.type || '').toLowerCase();
    if (type === 'scroll') {
      if (action.target) {
        const found = resolveTarget(action.target);
        if (found.error) return {ok:false,error:found.error,candidates:found.candidates,recoverable:true};
        found.el.scrollIntoView({block:action.block || 'center', behavior:action.behavior || 'auto'});
        return {ok:true,verified:true,type,element:descriptor(found.el),locatorMethod:found.method};
      }
      window.scrollBy({top:Number(action.deltaY || 650),left:Number(action.deltaX || 0),behavior:action.behavior || 'auto'});
      return {ok:true,verified:true,type,scrollX:window.scrollX,scrollY:window.scrollY};
    }

    if (type === 'wait') {
      const timeout = Math.min(Math.max(Number(action.timeoutMs || 10000), 100), 60000);
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        if (action.textIncludes && normLower(document.body?.innerText).includes(normLower(action.textIncludes))) return {ok:true,verified:true,type,evidence:{textIncludes:action.textIncludes}};
        if (action.urlIncludes && location.href.includes(String(action.urlIncludes))) return {ok:true,verified:true,type,evidence:{url:location.href}};
        if (action.target) {
          const found = resolveTarget(action.target);
          if (found.el) return {ok:true,verified:true,type,element:descriptor(found.el),locatorMethod:found.method};
        }
        await new Promise(r => setTimeout(r, 150));
      }
      return {ok:false,error:'WAIT_TIMEOUT',recoverable:true};
    }

    const found = resolveTarget(action.target || {});
    if (found.error) return {ok:false,error:found.error,candidates:found.candidates,recoverable:['LOCATOR_NOT_FOUND','LOCATOR_AMBIGUOUS'].includes(found.error)};
    const el = found.el;

    if (type === 'focus') {
      el.scrollIntoView({block:'center'}); el.focus({preventScroll:true});
      return {ok:true,verified:document.activeElement === el,type,element:descriptor(el),locatorMethod:found.method};
    }
    if (type === 'click') {
      if ('disabled' in el && el.disabled) return {ok:false,error:'ELEMENT_DISABLED'};
      el.scrollIntoView({block:'center'}); el.focus({preventScroll:true}); el.click();
      return {ok:true,verified:true,type,element:descriptor(el),locatorMethod:found.method};
    }
    if (type === 'fill') {
      setValue(el, action.value ?? '');
      await new Promise(r => setTimeout(r, 120));
      const actual = controlValue(el);
      const expected = el.isContentEditable ? norm(action.value ?? '') : String(action.value ?? '');
      const verified = el.isContentEditable ? norm(actual) === expected : actual === expected;
      return verified ? {ok:true,verified:true,type,actual,element:descriptor(el),locatorMethod:found.method} : {ok:false,error:'FIELD_VALUE_REVERTED',recoverable:true,actual};
    }
    if (type === 'select') {
      if (!(el instanceof HTMLSelectElement)) return {ok:false,error:'NOT_SELECT',recoverable:true};
      const wantedValue = action.value != null ? String(action.value) : null;
      const wantedText = action.optionText != null ? normLower(action.optionText) : null;
      let option = wantedValue != null ? Array.from(el.options).find(o => String(o.value) === wantedValue) : null;
      if (!option && wantedText) option = Array.from(el.options).find(o => normLower(o.textContent).includes(wantedText));
      if (!option) return {ok:false,error:'OPTION_NOT_FOUND',recoverable:true};
      setValue(el, option.value);
      await new Promise(r => setTimeout(r, 100));
      if (String(el.value) !== String(option.value)) return {ok:false,error:'SELECT_VALUE_REVERTED',recoverable:true};
      return {ok:true,verified:true,type,selected:norm(option.textContent),element:descriptor(el),locatorMethod:found.method};
    }
    if (type === 'check' || type === 'uncheck') {
      if (!('checked' in el)) return {ok:false,error:'NOT_CHECKABLE',recoverable:true};
      el.checked = type === 'check';
      dispatchValueEvents(el);
      return {ok:true,verified:el.checked === (type === 'check'),type,checked:!!el.checked,element:descriptor(el),locatorMethod:found.method};
    }
    if (type === 'submit') {
      const form = el instanceof HTMLFormElement ? el : (el.form || el.closest('form'));
      if (form) {
        if (typeof form.requestSubmit === 'function') form.requestSubmit(); else form.submit();
        return {ok:true,verified:true,type,evidence:{method:'form_submit'}};
      }
      const button = el.closest?.('form')?.querySelector?.('button[type="submit"],input[type="submit"]');
      if (button) { button.click(); return {ok:true,verified:true,type,evidence:{method:'submit_button'}}; }
      return {ok:false,error:'FORM_NOT_FOUND'};
    }
    if (type === 'assert') {
      const actual = controlValue(el);
      let verified = true;
      if (action.equals != null) verified = actual === String(action.equals);
      if (verified && action.includes != null) verified = normLower(actual).includes(normLower(action.includes));
      if (verified && action.checked != null) verified = 'checked' in el && !!el.checked === !!action.checked;
      return {ok:verified,verified,type,actual,element:descriptor(el),locatorMethod:found.method,error:verified?undefined:'ASSERT_FAILED'};
    }
    if (type === 'read_value') {
      return {ok:true,verified:true,type,value:controlValue(el),element:descriptor(el),locatorMethod:found.method};
    }
    return {ok:false,error:`UNSUPPORTED_ACTION:${type}`};
  }

  async function handle(msg) {
    if (msg?.type === 'BH_PING') return {ok:true,url:location.href,title:document.title};
    if (msg?.type === 'BH_INSPECT') {
      const max = Math.min(Math.max(Number(msg.max || 160), 1), 400);
      const elements = collectInteractive().map(descriptor);
      elements.sort((a,b) => {
        const av = a.rect.y >= 0 && a.rect.y <= innerHeight ? 0 : 1;
        const bv = b.rect.y >= 0 && b.rect.y <= innerHeight ? 0 : 1;
        return av - bv || Math.abs(a.rect.y) - Math.abs(b.rect.y);
      });
      return {ok:true,url:location.href,title:document.title,elements:elements.slice(0,max),count:elements.length};
    }
    if (msg?.type === 'BH_READ') {
      const max = Math.min(Math.max(Number(msg.maxChars || 12000), 500), 250000);
      const raw = norm(document.body?.innerText || document.body?.textContent || '');
      const text = msg.tail ? raw.slice(-max) : raw.slice(0,max);
      return {ok:true,url:location.href,title:document.title,text};
    }
    if (msg?.type === 'BH_ACT') return act(msg.action || {});
    return {ok:false,error:'UNKNOWN_MESSAGE'};
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    Promise.resolve(handle(msg)).then(sendResponse).catch(err => sendResponse({ok:false,error:String(err?.message || err)}));
    return true;
  });
})();
