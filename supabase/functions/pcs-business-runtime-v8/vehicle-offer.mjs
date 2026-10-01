export function vehicleOptionIndex(text) {
  const match = String(text || '').trim().match(/^(?:(?:вариант|выбираю|беру|номер)\s*)?([1-9])\s*[.!]?$/iu);
  return match ? Number(match[1]) - 1 : null;
}

export function resolveVehicleChoice(text, offer, now = Date.now()) {
  const option = vehicleOptionIndex(text);
  const confirming = isBookingConfirmation(text);
  if ((option === null && !confirming) || offer?.intent !== 'car_rent' || !Array.isArray(offer.items)) return null;
  if (confirming && !['awaiting_confirmation', 'awaiting_documents'].includes(offer.stage)) return {action: 'choose_first'};
  const index = confirming ? offer.selected_index : option;
  const item = Number.isInteger(index) ? offer.items[index] : null;
  if (!item) return {action: 'invalid_choice'};
  const issued = Date.parse((confirming && offer.selected_at) || offer.created_at || '');
  if (!Number.isFinite(issued) || now - issued > 24 * 3600000 || issued > now) return {action: 'expired'};
  const start = String(offer.start || ''), end = String(offer.end || '');
  if (!offer.id || !item.id || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)
      || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || start >= end
      || !Number.isFinite(Number(item.total)) || Number(item.total) <= 0 || !item.currency) return {action: 'invalid_quote'};
  return {action: confirming ? 'confirm' : 'select', index, item};
}

export async function continueVehicleBooking({text, offer, contactId, store, now = Date.now()}) {
  const choice = resolveVehicleChoice(text, offer, now);
  if (!choice) return null;
  const errors = {
    choose_first: 'Сначала выберите автомобиль из предложенных вариантов.',
    invalid_choice: 'Не нашёл такой вариант. Напишите номер автомобиля из предложения.',
    expired: 'Предложение устарело. Уточните даты — ещё раз проверим наличие и условия.',
    invalid_quote: 'Условия предложения требуют проверки. Пока автомобиль не забронирован.'
  };
  if (errors[choice.action]) return {action: choice.action, answer: errors[choice.action], offer};
  const item = await store.item(choice.item.id);
  if (!item || item.id !== choice.item.id || item.status !== 'available' || item.customer_visible !== true || item.deleted_at != null) {
    return {action: 'unavailable', offer, answer: 'Эта машина сейчас недоступна для предложения. Подберём другой вариант; ничего не забронировано.'};
  }
  if (item.ownership_type !== 'pcs_owned') return {action: 'partner_confirmation', offer, needsHuman: true,
    answer: 'Для этой машины требуется подтверждение партнёра. Уточним наличие и условия; пока автомобиль не забронирован.'};
  if (!await store.available(choice.item, offer)) return {action: 'unavailable', offer,
    answer: 'Пока не могу подтвердить доступность этой машины. Подберём другой вариант; ничего не забронировано.'};
  const selected = {...offer, selected_index: choice.index,
    selected_at: offer.selected_at || new Date(now).toISOString(), stage: 'awaiting_confirmation'};
  if (choice.action === 'select') return {action: 'select', offer: selected,
    answer: selectedVehicleReply(selected, choice.item, item)};
  const request = await store.request({contact_id: contactId, offer_id: offer.id,
    catalog_item_id: choice.item.id, start_date: offer.start, end_date: offer.end,
    rental_total: Number(choice.item.total), currency: choice.item.currency});
  return {action: 'confirm', request, offer: {...selected, stage: 'awaiting_documents', booking_request_id: request.id},
    answer: request.status === 'booked' ? 'Бронь по этой заявке уже оформлена. Повторно её не создаю.'
      : 'Приняла заявку. Для оформления пришлите, пожалуйста, фото паспорта и международного водительского удостоверения (МВУ). После проверки сообщим сумму бронировочной предоплаты и реквизиты. Залог за сохранность автомобиля — отдельная сумма. Пока автомобиль не забронирован; подтвердим бронь только после проверки документов и поступления оплаты.'};
}

export function publicVehicleName(title) {
  return String(title || '').replace(/^(?:LTC|LTR)-\d+\s*[·•-]\s*/iu, '')
    .replace(/\s*[·•-]\s*\d{3,8}\s*$/u, '')
    .replace(/^MG\s+MG5\b/iu, 'MG5').trim();
}

export function securityDepositLine(metadata, currency = 'THB') {
  const raw = metadata?.security_deposit_thb;
  if (raw == null || raw === '') return '';
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0) return '';
  return `\nЗалог за сохранность авто: ${new Intl.NumberFormat('ru-RU').format(amount)} ${currency}`;
}

export function bookingPaymentReply(request) {
  const amount = request?.booking_deposit_amount == null ? null : Number(request.booking_deposit_amount);
  const formatted = Number.isFinite(amount) && amount > 0 ? `${new Intl.NumberFormat('ru-RU').format(amount)} бат` : null;
  if (!formatted) return 'Сумму бронировочной предоплаты уточним именно для вашей заявки и сообщим вместе с проверенными реквизитами. Паспорт и МВУ тоже нужно проверить. Пока автомобиль не забронирован.';
  if (request.payment_status === 'requested') return `По вашей заявке предоплата — ${formatted}. Реквизиты мы уже прислали выше. После оплаты отправьте чек сюда; поступление проверим отдельно. Пока автомобиль не забронирован.`;
  return `По вашей заявке предоплата — ${formatted}. Реквизиты сообщим после проверки. Пожалуйста, не переводите деньги по старым реквизитам. Пока автомобиль не забронирован.`;
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
  return /^(?:да,?\s*)?(?:подтверждаю\s+(?:бронь|бронирование)|бронируйте|хочу\s+оформить)[.!]?$/iu.test(String(text || '').trim());
}

export function selectedVehicleReply(offer, item, catalogItem) {
  const dates = humanRentalDates(offer.start, offer.end);
  const name = publicVehicleName(catalogItem.title || item.title);
  const quotedDeposit = item.security_deposit_thb ?? catalogItem.metadata?.security_deposit_thb;
  const depositAmount = Number(quotedDeposit);
  const deposit = Number.isFinite(depositAmount) && depositAmount >= 0 && quotedDeposit != null ? ` Залог за сохранность авто — ${money(depositAmount, item.currency)}.` : '';
  return `Вы выбрали ${name} на ${dates}. Аренда — ${money(item.total, item.currency)}.${deposit}\n\nДля оформления нужны паспорт, международное водительское удостоверение и бронировочная предоплата. Её сумму согласуем отдельно для этой заявки; залог за сохранность авто — другая сумма. Если хотите продолжить, напишите «Хочу оформить». Пока автомобиль не забронирован.`;
}

