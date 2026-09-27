import { parseRentalRange } from '../../../supabase/functions/_shared/rental-period.mjs';

const cityOf = (text) => {
  const value = String(text || '').toLowerCase();
  if (/паттай|pattaya/u.test(value)) return { label: 'Паттайя', aliases: ['паттайя', 'pattaya'] };
  if (/пхукет|phuket/u.test(value)) return { label: 'Пхукет', aliases: ['пхукет', 'phuket'] };
  if (/бангкок|bangkok/u.test(value)) return { label: 'Бангкок', aliases: ['бангкок', 'bangkok'] };
  if (/самуи|samui/u.test(value)) return { label: 'Самуи', aliases: ['самуи', 'samui'] };
  return null;
};

export function rentalRange(text, now = new Date()) {
  const range = parseRentalRange(text, now);
  return range ? { start: range.start, end: range.end } : null;
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
