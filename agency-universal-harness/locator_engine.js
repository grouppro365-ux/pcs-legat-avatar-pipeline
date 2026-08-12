(() => {
  const clean = (s, max = 240) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const norm = s => clean(s, 300).toLowerCase();

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || 1) > 0 && r.width > 0 && r.height > 0;
  }

  function roleOf(el) {
    return clean(el.getAttribute('role') || ({
      BUTTON:'button', A:'link', INPUT:'input', TEXTAREA:'textbox', SELECT:'combobox'
    }[el.tagName] || el.tagName.toLowerCase()), 60);
  }

  function nameOf(el) {
    const labelled = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('name') || '';
    if (labelled) return clean(labelled, 160);
    const id = el.id;
    if (id) {
      const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (lab) return clean(lab.innerText || lab.textContent, 160);
    }
    return clean(el.innerText || el.textContent || el.getAttribute('placeholder') || '', 160);
  }

  function hintsOf(el) {
    return {
      id: clean(el.id, 120),
      name: clean(el.getAttribute('name'), 120),
      testid: clean(el.getAttribute('data-testid'), 120),
      aria: clean(el.getAttribute('aria-label'), 160),
      placeholder: clean(el.getAttribute('placeholder'), 160),
      type: clean(el.getAttribute('type'), 60),
      hrefPath: (() => {
        if (el.tagName !== 'A' || !el.href) return '';
        try { const u = new URL(el.href, location.href); return `${u.origin}${u.pathname}`; }
        catch { return ''; }
      })()
    };
  }

  function descriptor(el) {
    const hints = hintsOf(el);
    const name = nameOf(el);
    const text = clean(el.innerText || el.textContent, 180);
    return {
      role: roleOf(el),
      name,
      label: clean(`${name} ${hints.placeholder}`, 220),
      text,
      tag: el.tagName.toLowerCase(),
      hints
    };
  }

  function interactiveNodes(limit = 320) {
    const selector = [
      'button','a[href]','input','textarea','select','summary',
      '[contenteditable="true"]','[role="button"]','[role="link"]','[role="textbox"]',
      '[role="combobox"]','[role="checkbox"]','[role="radio"]','[role="menuitem"]','[tabindex]'
    ].join(',');
    return Array.from(document.querySelectorAll(selector)).filter(visible).slice(0, limit);
  }

  function same(a, b) { return !!a && !!b && norm(a) === norm(b); }
  function containsEither(a, b) {
    const x = norm(a), y = norm(b);
    return !!x && !!y && (x.includes(y) || y.includes(x));
  }

  function score(el, target = {}) {
    const d = descriptor(el);
    const th = target.hints || {};
    let n = 0;
    let strong = 0;

    if (th.id && d.hints.id && th.id === d.hints.id) { n += 120; strong++; }
    if (th.testid && d.hints.testid && th.testid === d.hints.testid) { n += 110; strong++; }
    if (th.name && d.hints.name && th.name === d.hints.name) { n += 80; strong++; }
    if (th.aria && d.hints.aria && same(th.aria, d.hints.aria)) { n += 75; strong++; }
    if (th.placeholder && d.hints.placeholder && same(th.placeholder, d.hints.placeholder)) n += 45;
    if (th.hrefPath && d.hints.hrefPath && th.hrefPath === d.hints.hrefPath) { n += 70; strong++; }

    if (target.role && same(target.role, d.role)) n += 28;
    if (target.tag && same(target.tag, d.tag)) n += 12;
    if (target.name && same(target.name, d.name)) n += 58;
    else if (target.name && containsEither(target.name, d.name)) n += 30;
    if (target.label && same(target.label, d.label)) n += 42;
    else if (target.label && containsEither(target.label, d.label)) n += 20;
    if (target.text && same(target.text, d.text)) n += 34;
    else if (target.text && containsEither(target.text, d.text)) n += 16;

    return {score:n, strong, descriptor:d};
  }

  function targetStillMatches(el, target = {}) {
    if (!visible(el)) return false;
    const s = score(el, target);
    return s.strong > 0 || s.score >= 55;
  }

  function resolve(target = {}, refs) {
    if (target.ref && refs?.has(target.ref)) {
      const el = refs.get(target.ref);
      if (el?.isConnected && targetStillMatches(el, target)) {
        return {ok:true, el, method:'exact_ref', score:999, recovered:false, descriptor:descriptor(el)};
      }
    }

    const ranked = interactiveNodes().map(el => {
      const s = score(el, target);
      return {el, ...s};
    }).filter(x => x.score > 0).sort((a,b) => b.score - a.score);

    const best = ranked[0];
    const second = ranked[1];
    if (!best || best.score < 48) {
      return {ok:false, error:'LOCATOR_NOT_FOUND', recoverable:true};
    }

    const ambiguous = second && best.strong === 0 && second.strong === 0 && (best.score - second.score) < 12;
    if (ambiguous) {
      return {
        ok:false,
        error:'LOCATOR_AMBIGUOUS',
        recoverable:true,
        candidates:[best, second].map(x => ({score:x.score, role:x.descriptor.role, name:x.descriptor.name, text:x.descriptor.text}))
      };
    }

    return {ok:true, el:best.el, method:best.strong ? 'stable_hint' : 'semantic_fallback', score:best.score, recovered:true, descriptor:best.descriptor};
  }

  globalThis.AUH_LOCATOR = {clean, visible, roleOf, nameOf, hintsOf, descriptor, interactiveNodes, resolve};
})();
