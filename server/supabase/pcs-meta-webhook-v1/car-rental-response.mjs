export function publicCarTitle(title) {
  return String(title || '').replace(/^(?:LTC|LTR)-\d+\s*[·•-]\s*/i, '')
    .replace(/\s*[·•-]\s*\d{3,8}\s*$/, '').trim();
}

export function carOffersReply(offers, range) {
  const dates = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  const label = `${dates.format(new Date(`${range.start}T12:00:00Z`))} — ${dates.format(new Date(`${range.end}T12:00:00Z`))}`;
  const money = value => new Intl.NumberFormat('ru-RU').format(value);
  const options = offers.map((offer, index) => `${index + 1}. ${publicCarTitle(offer.title)} — ${money(offer.total)} ${offer.currency} за аренду${offer.deposit ? `, возвратный залог ${money(offer.deposit)} THB` : ', залог уточним перед бронью'}`).join('\n');
  return `На ${label} могу предложить:\n\n${options}\n\nКакой вариант вам подходит? Перед бронью подтвердим наличие и условия.`;
}
