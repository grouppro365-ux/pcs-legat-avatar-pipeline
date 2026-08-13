/*
 * Browser-side half of Agency Browser Harness.
 * Directly adapted from the element-cache / proxy / visibility ideas in
 * scriby/browser-harness (MIT, 2013), but runs as an MV3 content script.
 *
 * Stable text-fix: keep the v0.1.1 controller/ChatGPT transport untouched,
 * while allowing the browser-side executor to traverse same-origin editor
 * iframes (including Gutenberg) and edit fields in their owning document.
 */
(() => {
  if (globalThis.__AGENCY_BROWSER_HARNESS_CLIENT__) return;
  globalThis.__AGENCY_BROWSER_HARNESS_CLIENT__ = true;

  const refByElement = new WeakMap();
  const elementByRef = new Map();
  let refSeq = 1;

  const norm = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const normLower = value => norm(value).toLowerCase();
  const docOf = el => el?.ownerDocument || document;
  const winOf = el => docOf(el)?.defaultView || window;

  function collectDocuments(rootDoc = document) {
    const out = [];
    const seen = new Set();
    const visit = doc => {
      if (!doc || seen.has(doc)) return;
      seen.add(doc); out.push(doc);
      let frames = [];
      try { frames = Array.from(doc.querySelectorAll('iframe,frame')); } catch {}
      for (const frame of frames) {
        try {
          const child = frame.contentDocument;
          if (child?.documentElement) visit(child);
        } catch {
          // Cross-origin frames remain opaque by design.
        }
      }
    };
    visit(rootDoc);
    return out;
  }

  function frameDepth(doc) {
    let depth = 0, w = doc?.defaultView;
    while (w && w !== w.top) {
      try { if (!w.frameElement) break; depth += 1; w = w.parent; }
      catch { break; }
    }
    return depth;
  }

  function topRect(el) {
    const r = el.getBoundingClientRect();
    let x = r.x, y = r.y, w = el.ownerDocument?.defaultView;
    while (w && w !== w.top) {
      try {
        const frame = w.frameElement;
        if (!frame) break;
        const fr = frame.getBoundingClientRect();
        x += fr.x; y += fr.y; w = w.parent;
      } catch { break; }
    }
    return {x:Math.round(x),y:Math.round(y),width:Math.round(r.width),height:Math.round(r.height)};
  }

  function queryAcrossDocuments(selector) {
    const out = [];
    for (const doc of collectDocuments()) {
      try { out.push(...doc.querySelectorAll(selector)); } catch {}
    }
    return out;
  }

  function isVisible(el) {
    if (!el || (!(el instanceof Element) && !el?.tagName) || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    let s;
    try { s = winOf(el).getComputedStyle(el); } catch { return false; }
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
    const doc = docOf(el);
    if (el.labels?.length) return norm(Array.from(el.labels).map(textOf).join(' '));
    const aria = el.getAttribute?.('aria-label');
    if (aria) return norm(aria);
    const labelledBy = el.getAttribute?.('aria-labelledby');
    if (labelledBy) {
      const t = labelledBy.split(/\s+/).map(id => doc.getElementById(id)).filter(Boolean).map(textOf).join(' ');
      if (t) return norm(t);
    }
    if (el.id) {
      try {
        const label = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
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
      const u = new URL(href, docOf(el)?.baseURI || location.href);
      return `${u.origin}${u.pathname}`;
    } catch { return ''; }
  }

  function descriptor(el) {
    return {
      ref: refFor(el),
      tag: el.tagName.toLowerCase(),
      role: roleOf(el),
      name: nameOf(el).slice(0, 220),
      label: labelOf(el).slice(0, 220),
      text: textOf(el).slice(0, 320),
      hints: {
        id: el.id || '',
        name: el.getAttribute('name') || '',
        testid: el.getAttribute('data-testid') || '',
        aria: el.getAttribute('aria-label') || '',
        placeholder: el.getAttribute('placeholder') || '',
        type: el.getAttribute('type') || '',
        hrefPath: hrefPath(el),
        frameDepth: frameDepth(docOf(el))
      },
      rect: topRect(el),
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
    const visitedRoots = new Set();

    const visitRoot = node => {
      if (!node || visitedRoots.has(node)) return;
      visitedRoots.add(node);
      const queryRoot = node?.querySelectorAll ? node : null;
      if (!queryRoot) return;
      let elements = [];
      try { elements = Array.from(queryRoot.querySelectorAll(selector)); } catch {}
      for (const el of elements) {
        if (!seen.has(el) && isVisible(el)) { seen.add(el); out.push(el); }
        if (el.shadowRoot) visitRoot(el.shadowRoot);
      }
      let hosts = [];
      try { hosts = Array.from(queryRoot.querySelectorAll('*')); } catch {}
      for (const host of hosts) if (host.shadowRoot) visitRoot(host.shadowRoot);
    };

    if (root === document) {
      for (const doc of collectDocuments()) visitRoot(doc);
    } else {
      visitRoot(root);
    }
    return out;
  }

  function byLabel(labelText) {
    const wanted = normLower(labelText);
    if (!wanted) return [];
    const out = [];
    for (const doc of collectDocuments()) {
      let labels = [];
      try { labels = Array.from(doc.querySelectorAll('label')); } catch {}
      for (const label of labels) {
        if (!normLower(textOf(label)).includes(wanted)) continue;
        if (label.control) out.push(label.control);
        else {
          const id = label.getAttribute('for');
          if (id && doc.getElementById(id)) out.push(doc.getElementById(id));
          const nested = label.querySelector('input,textarea,select,[contenteditable="true"]');
          if (nested) out.push(nested);
        }
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
        const found = uniqueVisible(queryAcrossDocuments(String(spec.selector)));
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
        const found = uniqueVisible(queryAcrossDocuments(sel));
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
    const wantedFrameDepth = hints.frameDepth == null ? null : Number(hints.frameDepth);

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
      if (wantedFrameDepth != null && d.hints.frameDepth === wantedFrameDepth) score += 6;
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
    const w = winOf(el);
    try { el.dispatchEvent(new w.InputEvent('beforeinput', {bubbles:true, composed:true, inputType, data})); } catch {}
    try { el.dispatchEvent(new w.InputEvent('input', {bubbles:true, composed:true, inputType, data})); }
    catch { el.dispatchEvent(new w.Event('input', {bubbles:true, composed:true})); }
    el.dispatchEvent(new w.Event('change', {bubbles:true, composed:true}));
  }

  function scrollElementIntoView(el) {
    try { el.scrollIntoView({block:'center', inline:'nearest'}); } catch {}
    let w = docOf(el)?.defaultView;
    while (w && w !== w.top) {
      try {
        const frame = w.frameElement;
        if (!frame) break;
        frame.scrollIntoView({block:'center', inline:'nearest'});
        w = w.parent;
      } catch { break; }
    }
  }

  function setValue(el, value) {
    const text = String(value ?? '');
    const doc = docOf(el), w = winOf(el);
    scrollElementIntoView(el);
    el.focus({preventScroll:true});
    if (el.isContentEditable) {
      const selection = w.getSelection?.();
      const range = doc.createRange();
      range.selectNodeContents(el);
      selection?.removeAllRanges();
      selection?.addRange(range);
      let inserted = false;
      try { inserted = doc.execCommand('insertText', false, text); } catch {}
      if (!inserted || controlValue(el) !== norm(text)) {
        el.textContent = text;
        dispatchValueEvents(el, 'insertText', text);
      }
      return;
    }
    const tag = el.tagName.toLowerCase();
    const proto = tag === 'input' ? w.HTMLInputElement?.prototype :
      tag === 'textarea' ? w.HTMLTextAreaElement?.prototype :
      tag === 'select' ? w.HTMLSelectElement?.prototype : null;
    const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, text); else el.value = text;
    dispatchValueEvents(el, 'insertText', text);
  }

  function readAllText() {
    const parts = [];
    for (const doc of collectDocuments()) {
      try {
        const t = norm(doc.body?.innerText || doc.body?.textContent || '');
        if (t) parts.push(t);
      } catch {}
    }
    return norm(parts.join('\n\n'));
  }

  async function act(action = {}) {
    const type = String(action.type || '').toLowerCase();
    if (type === 'scroll') {
      if (action.target) {
        const found = resolveTarget(action.target);
        if (found.error) return {ok:false,error:found.error,candidates:found.candidates,recoverable:true};
        scrollElementIntoView(found.el);
        return {ok:true,verified:true,type,element:descriptor(found.el),locatorMethod:found.method};
      }
      window.scrollBy({top:Number(action.deltaY || 650),left:Number(action.deltaX || 0),behavior:action.behavior || 'auto'});
      return {ok:true,verified:true,type,scrollX:window.scrollX,scrollY:window.scrollY};
    }

    if (type === 'wait') {
      const timeout = Math.min(Math.max(Number(action.timeoutMs || 10000), 100), 60000);
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        if (action.textIncludes && normLower(readAllText()).includes(normLower(action.textIncludes))) return {ok:true,verified:true,type,evidence:{textIncludes:action.textIncludes}};
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
      scrollElementIntoView(el); el.focus({preventScroll:true});
      return {ok:true,verified:docOf(el).activeElement === el,type,element:descriptor(el),locatorMethod:found.method};
    }
    if (type === 'click') {
      if ('disabled' in el && el.disabled) return {ok:false,error:'ELEMENT_DISABLED'};
      scrollElementIntoView(el); el.focus({preventScroll:true}); el.click();
      return {ok:true,verified:true,type,element:descriptor(el),locatorMethod:found.method};
    }
    if (type === 'fill') {
      setValue(el, action.value ?? '');
      await new Promise(r => setTimeout(r, 160));
      const actual = controlValue(el);
      const expected = el.isContentEditable ? norm(action.value ?? '') : String(action.value ?? '');
      const verified = el.isContentEditable ? norm(actual) === expected : actual === expected;
      return verified ? {ok:true,verified:true,type,actual,element:descriptor(el),locatorMethod:found.method} : {ok:false,error:'FIELD_VALUE_REVERTED',recoverable:true,actual};
    }
    if (type === 'select') {
      if (el.tagName?.toLowerCase() !== 'select') return {ok:false,error:'NOT_SELECT',recoverable:true};
      const wantedValue = action.value != null ? String(action.value) : null;
      const wantedText = action.optionText != null ? normLower(action.optionText) : null;
      let option = wantedValue != null ? Array.from(el.options).find(o => String(o.value) === wantedValue) : null;
      if (!option && wantedText) option = Array.from(el.options).find(o => normLower(o.textContent).includes(wantedText));
      if (!option) return {ok:false,error:'OPTION_NOT_FOUND',recoverable:true};
      setValue(el, option.value);
      await new Promise(r => setTimeout(r, 120));
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
      const form = el.tagName?.toLowerCase() === 'form' ? el : (el.form || el.closest?.('form'));
      if (form) {
        if (typeof form.requestSubmit === 'function') form.requestSubmit(); else form.submit();
        return {ok:true,verified:true,type,evidence:{method:'form_submit'}};
      }
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
    if (msg?.type === 'BH_PING') return {ok:true,url:location.href,title:document.title,documents:collectDocuments().length};
    if (msg?.type === 'BH_INSPECT') {
      const max = Math.min(Math.max(Number(msg.max || 160), 1), 500);
      const elements = collectInteractive().map(descriptor);
      elements.sort((a,b) => {
        const av = a.rect.y >= 0 && a.rect.y <= innerHeight ? 0 : 1;
        const bv = b.rect.y >= 0 && b.rect.y <= innerHeight ? 0 : 1;
        return av - bv || Math.abs(a.rect.y) - Math.abs(b.rect.y);
      });
      return {ok:true,url:location.href,title:document.title,elements:elements.slice(0,max),count:elements.length,documents:collectDocuments().length};
    }
    if (msg?.type === 'BH_READ') {
      const max = Math.min(Math.max(Number(msg.maxChars || 12000), 500), 250000);
      const raw = readAllText();
      const text = msg.tail ? raw.slice(-max) : raw.slice(0,max);
      return {ok:true,url:location.href,title:document.title,text,documents:collectDocuments().length};
    }
    if (msg?.type === 'BH_ACT') return act(msg.action || {});
    return {ok:false,error:'UNKNOWN_MESSAGE'};
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    Promise.resolve(handle(msg)).then(sendResponse).catch(err => sendResponse({ok:false,error:String(err?.message || err)}));
    return true;
  });
})();