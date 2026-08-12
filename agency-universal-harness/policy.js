(() => {
  const ALLOWED = new Set(['click','fill','select','navigate','assert','wait']);
  const DANGEROUS = /(publish|post|send|delete|remove|trash|pay|purchase|buy|transfer|withdraw|submit order|confirm order|sign|accept terms|grant|permission|share access|опубликов|отправ|удал|корзин|оплат|купить|перевест|вывест|подпис|принять условия|разреш|доступ)/i;
  const SECRET = /(password|passcode|otp|one[- ]?time|2fa|cvv|cvc|card number|номер карты|парол|код подтверждения|одноразов)/i;

  function normalizeUrl(url) {
    try {
      const u = new URL(url);
      return `${u.origin}${u.pathname}`;
    } catch { return ''; }
  }

  function validateAction(action, ctx = {}) {
    if (!action || typeof action !== 'object') return {ok:false, code:'BAD_ACTION'};
    if (!ALLOWED.has(action.type)) return {ok:false, code:'ACTION_NOT_ALLOWED'};
    if (action.type === 'navigate') {
      try {
        const target = new URL(action.url, ctx.currentUrl || undefined);
        const current = new URL(ctx.currentUrl || target.href);
        if (target.origin !== current.origin) return {ok:false, code:'CROSS_ORIGIN_REBIND_REQUIRED'};
      } catch { return {ok:false, code:'BAD_URL'}; }
    }
    const label = `${action.target?.name || ''} ${action.target?.text || ''} ${action.target?.label || ''}`.trim();
    if ((action.type === 'fill' || action.type === 'click') && SECRET.test(label)) {
      return {ok:false, code:'SECRET_FIELD_BLOCKED'};
    }
    if (action.type === 'click' && DANGEROUS.test(label)) {
      return {ok:false, code:'CONFIRM_REQUIRED', requiresConfirmation:true};
    }
    return {ok:true};
  }

  function abstractAction(action) {
    const safe = {type: action.type};
    if (action.target) {
      safe.target = {
        role: action.target.role || '',
        name: action.target.name || '',
        label: action.target.label || '',
        text: action.target.text || ''
      };
    }
    if (action.type === 'navigate') safe.path = normalizeUrl(action.url);
    if (action.type === 'assert') safe.assertion = action.assertion || {};
    return safe;
  }

  globalThis.AUH_POLICY = {validateAction, abstractAction, normalizeUrl};
})();
