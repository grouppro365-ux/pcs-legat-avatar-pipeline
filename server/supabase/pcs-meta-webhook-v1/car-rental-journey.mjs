const MONTHS = {
  января: 0, январь: 0, january: 0, jan: 0,
  февраля: 1, февраль: 1, february: 1, feb: 1,
  марта: 2, март: 2, march: 2, mar: 2,
  апреля: 3, апрель: 3, april: 3, apr: 3,
  мая: 4, май: 4, may: 4,
  июня: 5, июнь: 5, june: 5, jun: 5,
  июля: 6, июль: 6, july: 6, jul: 6,
  августа: 7, август: 7, august: 7, aug: 7,
  сентября: 8, сентябрь: 8, september: 8, sep: 8,
  октября: 9, октябрь: 9, october: 9, oct: 9,
  ноября: 10, ноябрь: 10, november: 10, nov: 10,
  декабря: 11, декабрь: 11, december: 11, dec: 11,
};

const cityOf = (text) => {
  const value = String(text || '').toLowerCase();
  if (/паттай|pattaya/u.test(value)) return { label: 'Паттайя', aliases: ['паттайя', 'pattaya'] };
  if (/пхукет|phuket/u.test(value)) return { label: 'Пхукет', aliases: ['пхукет', 'phuket'] };
  if (/бангкок|bangkok/u.test(value)) return { label: 'Бангкок', aliases: ['бангкок', 'bangkok'] };
  if (/самуи|samui/u.test(value)) return { label: 'Самуи', aliases: ['самуи', 'samui'] };
  return null;
};

const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const valid = (year, month, day) => {
  const date = new Date(year, month, day, 12);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
};

function yearFrom(value, now) {
  const parsed = Number(value || now.getFullYear());
  return parsed < 100 ? parsed + 2000 : parsed;
}

export function rentalRange(text, now = new Date()) {
  const value = String(text || '').toLowerCase();
  let match = value.match(/(?:с|от|from)?\s*(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?\s*(?:до|по|[-–—]|to)\s*(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?/u);
  if (match) {
    const start = valid(yearFrom(match[3], now), Number(match[2]) - 1, Number(match[1]));
    const end = valid(yearFrom(match[6] || match[3], now), Number(match[5]) - 1, Number(match[4]));
    if (start && end && end >= start) return { start: iso(start), end: iso(end) };
  }
  const names = Object.keys(MONTHS).join('|');
  match = value.match(new RegExp(`(?:с|от|from)?\\s*(\\d{1,2})\\s*(?:до|по|[-–—]|to)\\s*(\\d{1,2})\\s*(${names})(?:\\s+(\\d{4}))?`, 'iu'));
  if (match) {
    const year = Number(match[4] || now.getFullYear());
    const start = valid(year, MONTHS[match[3].toLowerCase()], Number(match[1]));
    const end = valid(year, MONTHS[match[3].toLowerCase()], Number(match[2]));
    if (start && end && end >= start) return { start: iso(start), end: iso(end) };
  }
  match = value.match(/(?:с|от|from)\s*(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?.{0,30}?(?:^|\s)(?:на|for)\s*(\d{1,2})\s*(?:дн|день|дня|дней|сут|day)/iu);
  if (match) {
    const start = valid(yearFrom(match[3], now), Number(match[2]) - 1, Number(match[1]));
    if (start) { const end = new Date(start); end.setDate(end.getDate() + Number(match[4]) - 1); return { start: iso(start), end: iso(end) }; }
  }
  return null;
}

export function isCarRental(text) {
  return /(аренд(?:а|ы|у|ой|овать|ую|овать)?\s*(?:авто|машин(?:а|ы|у|е|ой)?)|(?:авто|машин(?:а|ы|у|е|ой)?|car)\s*(?:в\s*)?аренд|rent\s*(?:a\s*)?car|прокат\s*(?:авто|машин(?:а|ы|у|е|ой)?)|нужн(?:а|ы|о)?\s*(?:авто|машин(?:а|ы|у|е|ой)?))/iu.test(String(text || ''));
}

export function carRentalJourney(history, text, now = new Date()) {
  const messages = [...(history || []), text].filter(Boolean).map(String);
  if (!messages.some(isCarRental)) return { matches: false };
  const city = [...messages].reverse().map(cityOf).find(Boolean) || null;
  const range = [...messages].reverse().map((message) => rentalRange(message, now)).find(Boolean) || null;
  if (!city) return { matches: true, city: null, range, question: 'В каком городе нужна аренда автомобиля?' };
  if (!range) return { matches: true, city, range: null, question: 'На какие даты нужна аренда автомобиля?' };
  return { matches: true, city, range, question: null };
}
