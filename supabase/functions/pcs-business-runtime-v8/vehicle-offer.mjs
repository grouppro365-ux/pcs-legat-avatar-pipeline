export function publicVehicleName(title) {
  return String(title || '').replace(/^LTC-\d+\s*·\s*/iu, '').trim();
}

export function securityDepositLine(metadata, currency = 'THB') {
  const raw = metadata?.security_deposit_thb;
  if (raw == null || raw === '') return '';
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0) return '';
  return `\nЗалог за сохранность авто: ${new Intl.NumberFormat('ru-RU').format(amount)} ${currency}`;
}
