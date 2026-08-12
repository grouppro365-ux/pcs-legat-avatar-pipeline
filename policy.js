(() => {
  const HIGH_RISK = [
    /publish|post now|send\b|delete|remove|trash|pay\b|purchase|buy\b|transfer|withdraw|sign\b|accept terms|grant access|revoke access|invite user/i,
    /опубликов|отправить|удалить|корзин|оплат|купить|перевест|подписать|принять условия|дать доступ|отозвать доступ|пригласить/i
  ];
  const SENSITIVE = /password|passwd|passcode|otp|one.?time|cvv|cvc|card.?number|bank.?account|iban|swift|secret|token|api.?key|private.?key|парол|код из смс|одноразов|номер карты|банковск|секрет|токен|ключ api/i;

  function safeOrigin(url) {
    try { return new URL(url).origin; } catch { return ''; }
  }

  function fingerprint(payload) {
    const s = JSON.stringify(payload || {});
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return `cfm_${(h >>> 0).toString(16)}`;
  }

  function assess(action, preflight, boundOrigin) {
    const type = String(action?.type || '');
    if (!['click','fill','select','navigate','wait'].includes(type)) {
      return { decision: 'block', reason: `Недопустимый тип действия: ${type}` };
    }

    if (type === 'wait') return { decision: 'allow' };

    if (type === 'navigate') {
      let u;
      try { u = new URL(String(action.url || ''), boundOrigin); }
      catch { return { decision: 'block', reason: 'Некорректный URL.' }; }
      if (!/^https?:$/.test(u.protocol)) return { decision: 'block', reason: 'Разрешены только http/https URL.' };
      if (u.origin !== boundOrigin) return { decision: 'block', reason: 'Переход на другой origin запрещён. Перепривяжите рабочий сайт явно.' };
      return { decision: 'allow' };
    }

    if (!preflight?.found) return { decision: 'block', reason: 'Элемент не найден на текущей странице.' };
    if (preflight.sensitive || SENSITIVE.test(`${preflight.label || ''} ${preflight.name || ''} ${preflight.type || ''}`)) {
      return { decision: 'block', reason: 'Чувствительные поля (пароли, OTP, карты, токены, банковские реквизиты) запрещены.' };
    }
    if (preflight.externalOrigin) {
      return { decision: 'block', reason: 'Действие ведёт на другой origin. Нужна явная перепривязка рабочего сайта.' };
    }

    const riskText = `${preflight.label || ''} ${preflight.title || ''} ${preflight.aria || ''}`.trim();
    if (type === 'click' && HIGH_RISK.some(rx => rx.test(riskText))) {
      const confirmationId = fingerprint({ type, ref: action.ref || '', riskText, boundOrigin });
      return { decision: 'confirm', confirmationId, reason: `Опасное внешнее действие: «${riskText || 'клик'}».` };
    }
    return { decision: 'allow' };
  }

  globalThis.AgencyPolicy = { assess, fingerprint, safeOrigin };
})();
