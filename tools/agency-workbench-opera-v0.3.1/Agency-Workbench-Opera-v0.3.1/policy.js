(() => {
  const destructive = /(delete|remove|trash|erase|publish|send|submit|pay|purchase|buy|transfer|withdraw|confirm order|place order|accept|sign|revoke|grant access|permissions?|удал|опубликов|отправ|оплат|купить|перевод|подтверд|подписать|доступ)/i;
  const sensitive = /(password|passcode|otp|2fa|cvv|cvc|card number|iban|swift|secret|token|api[_ -]?key|парол|код подтверждения|карта|токен|секрет)/i;

  function text(action = {}) {
    return [action.type, action.label, action.text, action.selector, action.value, action.url].filter(Boolean).join(' ');
  }

  function classify(action = {}) {
    const t = text(action);
    if (action.type === 'fill' && sensitive.test(t)) {
      return { allow: false, reason: 'Запрещено автоматически заполнять чувствительные поля.' };
    }
    if (['click', 'navigate'].includes(action.type) && destructive.test(t)) {
      return { allow: false, needsConfirmation: true, reason: 'Действие требует ручного подтверждения.' };
    }
    return { allow: true };
  }

  self.AgencyPolicy = { classify };
})();
