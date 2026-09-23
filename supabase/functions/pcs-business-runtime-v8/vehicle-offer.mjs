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

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export function humanRentalDates(start, end, currentYear = new Date().getUTCFullYear()) {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(start || ''));
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(end || ''));
  if (!a || !b) return `${start} — ${end}`;
  const [ay, am, ad] = a.slice(1).map(Number);
  const [by, bm, bd] = b.slice(1).map(Number);
  if (!MONTHS[am - 1] || !MONTHS[bm - 1]) return `${start} — ${end}`;
  if (ay === by && am === bm) return `${ad}–${bd} ${MONTHS[am - 1]}${ay === currentYear ? '' : ` ${ay} года`}`;
  if (ay === by) return `${ad} ${MONTHS[am - 1]} – ${bd} ${MONTHS[bm - 1]} ${ay} года`;
  return `${ad} ${MONTHS[am - 1]} ${ay} года – ${bd} ${MONTHS[bm - 1]} ${by} года`;
}

function money(amount, currency) {
  const unit = currency === 'THB' ? 'бат' : currency;
  return `${new Intl.NumberFormat('ru-RU').format(Number(amount))} ${unit}`;
}

export function vehicleOffersReply(period, items, city = '') {
  const dates = humanRentalDates(period.start, period.end);
  const places = { 'Паттайя': 'в Паттайе', 'Пхукет': 'на Пхукете', 'Бангкок': 'в Бангкоке', 'Самуи': 'на Самуи', 'Чиангмай': 'в Чиангмае' };
  const place = city ? ` ${places[city] || `в ${city}`}` : '';
  const amount = Number(items[0]?.display_price);
  const currency = items[0]?.currency || 'THB';
  const sharedPrice = Number.isFinite(amount) && amount > 0 && items.every(x => Number(x.display_price) === amount && (x.currency || 'THB') === currency);
  const deposit = Number(items[0]?.metadata?.security_deposit_thb);
  const sharedDeposit = Number.isFinite(deposit) && deposit >= 0 && items.every(x => Number(x.metadata?.security_deposit_thb) === deposit);
  const list = items.map((x, index) => {
    const price = sharedPrice ? '' : ` — ${money(x.display_price, x.currency || 'THB')}`;
    const ownDeposit = sharedDeposit ? '' : securityDepositLine(x.metadata, x.currency || 'THB').replace(/^\n/, '; ');
    return `${index + 1}. ${publicVehicleName(x.title)}${price}${ownDeposit}`;
  }).join('\n');
  const priceLine = sharedPrice ? `Аренда${items.length > 1 ? ' любого варианта' : ''} — ${money(amount, currency)} за ${period.days} ${period.days === 1 ? 'день' : period.days >= 2 && period.days <= 4 ? 'дня' : 'дней'}.` : '';
  const depositLine = sharedDeposit ? `Залог за сохранность авто — ${money(deposit, currency)}.` : '';
  const introduction = items.length === 1 ? `На ${dates}${place} могу предложить ${publicVehicleName(items[0].title)}.` : `На ${dates}${place} могу предложить несколько автомобилей:\n${list}`;
  const question = items.length === 1 ? 'Подойдёт?' : 'Какой вариант вам нравится?';
  return `${introduction}\n${[priceLine, depositLine].filter(Boolean).join(' ')}\n${question} Перед бронью ещё раз проверю наличие.`;
}

export function isBookingConfirmation(text) {
  return /^(?:да,?\s*)?(?:подтверждаю\s+(?:бронь|бронирование)|бронируйте)[.!]?$/iu.test(String(text || '').trim());
}

export function selectedVehicleReply(offer, item, catalogItem) {
  const dates = humanRentalDates(offer.start, offer.end);
  const name = publicVehicleName(catalogItem.title || item.title);
  const depositAmount = Number(catalogItem.metadata?.security_deposit_thb);
  const deposit = Number.isFinite(depositAmount) && depositAmount >= 0 && catalogItem.metadata?.security_deposit_thb != null ? ` Залог за сохранность авто — ${money(depositAmount, item.currency)}.` : '';
  return `Вы выбрали ${name} на ${dates}. Аренда — ${money(item.total, item.currency)}.${deposit}\n\nЕсли всё подходит, напишите «Подтверждаю бронь». До этого машина не забронирована.`;
}
