(() => {
  if (globalThis.__AGENCY_PAGE_AGENT_V3__) return;
  globalThis.__AGENCY_PAGE_AGENT_V3__ = true;

  let refSeq = 1;
  const RISK_RE = /(publish|delete|remove|trash|send|submit|pay|payment|purchase|transfer|confirm order|place order|approve|grant|permission|публик|удал|корзин|отправ|оплат|платеж|перевод|подтверд|разреш)/i;
  const SECRET_RE = /(password|passcode|otp|2fa|one[- ]?time|card number|cvv|cvc|api.?key|token|secret|парол|код из sms|однораз|номер карты)/i;

  function visible(el) {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  }

  function textOf(el) {
    return String(
      el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      el.innerText ||
      el.textContent ||
      el.getAttribute('name') ||
      ''
    ).replace(/\s+/g, ' ').trim().slice(0, 220);
  }

  function refFor(el) {
    if (!el.dataset.agencyRef) el.dataset.agencyRef = `a${refSeq++}`;
    return el.dataset.agencyRef;
  }

  function safePageText() {
    let text = String(document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    text = text
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
      .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, '[PHONE]')
      .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[CARD]')
      .replace(/\b(?:api[_-]?key|token|secret)\s*[:=]\s*\S+/gi, '[SECRET]');
    return text.slice(0, 7000);
  }

  function safeUrl() {
    try { return `${location.origin}${location.pathname}`; }
    catch { return ''; }
  }

  function scan() {
    const selector = [
      'button','a[href]','input','textarea','select','[contenteditable="true"]',
      '[role="button"]','[role="textbox"]','[role="combobox"]','[role="tab"]','[role="menuitem"]'
    ].join(',');

    const elements = [...document.querySelectorAll(selector)]
      .filter(visible)
      .slice(0, 220)
      .map(el => ({
        ref: refFor(el),
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || '',
        role: el.getAttribute('role') || '',
        text: textOf(el),
        name: el.getAttribute('name') || '',
        disabled: !!el.disabled,
        valuePresent: ['INPUT','TEXTAREA','SELECT'].includes(el.tagName) ? !!String(el.value || '') : undefined
      }));

    return {
      url: safeUrl(),
      title: document.title,
      visibleText: safePageText(),
      elements
    };
  }

  function elByRef(ref) {
    if (!ref) return null;
    return document.querySelector(`[data-agency-ref="${CSS.escape(String(ref))}"]`);
  }

  function nativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : null;
    const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  }

  function fillElement(el, value) {
    const label = textOf(el);
    if (SECRET_RE.test(`${label} ${el.name || ''} ${el.type || ''}`)) {
      throw new Error('Это поле похоже на пароль/OTP/секрет. Автозаполнение запрещено.');
    }
    el.focus();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      nativeValue(el, String(value));
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(value) }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
      return String(el.value) === String(value);
    }
    if (el.isContentEditable) {
      el.replaceChildren(document.createTextNode(String(value)));
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(value) }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
      return (el.innerText || el.textContent || '').trim() === String(value).trim();
    }
    throw new Error('Элемент не поддерживает fill');
  }

  function checkCrossOrigin(el) {
    const a = el.closest?.('a[href]');
    if (a) {
      try {
        const u = new URL(a.href, location.href);
        if (u.origin !== location.origin) throw new Error(`Внешняя ссылка ${u.origin} заблокирована. Перепривяжите сайт явно.`);
      } catch (e) {
        if (String(e.message).includes('заблокирована')) throw e;
      }
    }
    const form = el.closest?.('form');
    if (form?.action) {
      const u = new URL(form.action, location.href);
      if (u.origin !== location.origin) throw new Error(`Cross-origin form ${u.origin} заблокирована.`);
    }
  }

  async function execute(action) {
    const type = String(action?.type || '');
    if (type === 'wait') {
      await new Promise(r => setTimeout(r, Math.min(Number(action.ms) || 700, 5000)));
      return { ok: true, type };
    }

    if (type === 'assertText') {
      const hay = action.ref ? textOf(elByRef(action.ref) || {}) : safePageText();
      const expected = String(action.expected || '');
      const ok = hay.toLowerCase().includes(expected.toLowerCase());
      return { ok, type, proof: ok ? `Найден текст: ${expected}` : `Не найден текст: ${expected}` };
    }

    if (type === 'assertUrl') {
      const expected = String(action.expected || '');
      const actual = safeUrl();
      const ok = actual.includes(expected);
      return { ok, type, proof: ok ? `URL содержит ${expected}` : `URL не содержит ${expected}`, actual };
    }

    const el = elByRef(action.ref);
    if (!el) throw new Error(`Элемент ${action.ref} больше не найден. Нужен новый scan.`);
    el.scrollIntoView({ block: 'center', inline: 'nearest' });

    if (type === 'fill') {
      const verified = fillElement(el, action.value ?? '');
      return { ok: verified, type, verified, proof: verified ? 'Значение перечитано из поля и совпадает' : 'Readback не совпал' };
    }

    if (type === 'select') {
      if (!(el instanceof HTMLSelectElement)) throw new Error('Элемент не является select');
      const wanted = String(action.value ?? action.option ?? '');
      const option = [...el.options].find(o => o.value === wanted || o.text.trim() === wanted || o.text.includes(wanted));
      if (!option) throw new Error(`Опция не найдена: ${wanted}`);
      el.value = option.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: el.value === option.value, type, verified: el.value === option.value, proof: `Выбрано: ${option.text}` };
    }

    if (type === 'click') {
      checkCrossOrigin(el);
      const label = textOf(el);
      if (RISK_RE.test(label) && !action.confirmed) {
        return {
          ok: false,
          confirmationRequired: true,
          label,
          type,
          action: { ...action, confirmed: true }
        };
      }
      el.click();
      return { ok: true, type, label, proof: `Клик выполнен: ${label || action.ref}` };
    }

    throw new Error(`Неизвестный action.type: ${type}`);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'AGENCY_PAGE_PING') {
      sendResponse({ ok: true, bridge: 'page-v3', url: safeUrl() });
      return;
    }
    if (message?.type === 'AGENCY_PAGE_SCAN') {
      try { sendResponse({ ok: true, scan: scan() }); }
      catch (e) { sendResponse({ ok: false, error: e.message }); }
      return;
    }
    if (message?.type === 'AGENCY_PAGE_EXECUTE') {
      (async () => {
        try {
          const result = await execute(message.action || {});
          sendResponse(result);
        } catch (e) {
          sendResponse({ ok: false, error: e?.message || String(e) });
        }
      })();
      return true;
    }
  });
})();