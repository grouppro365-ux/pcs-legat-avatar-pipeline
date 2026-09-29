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

export function carOfferSnapshot(offers, range) {
  if (!Array.isArray(offers) || !offers.length || !/^\d{4}-\d{2}-\d{2}$/.test(range?.start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(range?.end || '')) {
    throw new Error('invalid_car_offer_snapshot');
  }
  return {
    version: 1,
    intent: 'car_rent',
    start_date: range.start,
    end_date: range.end,
    options: offers.map((offer) => {
      const total = Number(offer.total);
      if (!offer.id || !Number.isFinite(total) || total <= 0) throw new Error('invalid_car_offer_option');
      return {
        catalog_item_id: String(offer.id),
        title: String(offer.title),
        total_before_extras: total,
        currency: String(offer.currency),
        security_deposit_thb: offer.deposit == null ? null : Number(offer.deposit),
      };
    }),
  };
}
