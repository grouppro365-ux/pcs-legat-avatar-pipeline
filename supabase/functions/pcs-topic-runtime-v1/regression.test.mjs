import assert from 'node:assert/strict';

const MONTHS = { сентября: 8, september: 8 };

function parseStartDate(text, now = new Date('2026-09-02T12:00:00Z')) {
  const match = String(text).toLowerCase().match(/\b(\d{1,2})\s+([\p{L}]+)(?=\s|$|[.,!?;:])/u);
  if (!match || !(match[2] in MONTHS)) return '';
  let year = now.getFullYear();
  let date = new Date(year, MONTHS[match[2]], Number(match[1]), 12);
  if (date.getTime() < now.getTime() - 604800000) date = new Date(year + 1, MONTHS[match[2]], Number(match[1]), 12);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function greeting(text) {
  return /^(здравствуй(?:те)?|добрый\s+(?:день|вечер|утро)|привет)/iu.test(String(text).trim()) ? 'Здравствуйте!' : '';
}

function firstReply(text) {
  return [greeting(text), 'Помогу подобрать машину.', 'С какой даты нужна аренда?'].filter(Boolean).join(' ');
}

function parseRooms(text) {
  const words = { одна: 1, одну: 1, две: 2, два: 2, три: 3, четыре: 4 };
  const raw = String(text).trim().toLowerCase();
  const match = raw.match(/^(\d{1,2})\s*(?:комнат[а-я]*|к|room(?:s)?)?$/iu);
  return match ? Number(match[1]) : words[raw] || 0;
}

function topicReference(text) {
  const value = String(text).toLowerCase();
  if (!/(верн(?:е|ё)мся|по поводу|насч(?:е|ё)т|теперь|а что с|back to|about)/iu.test(value)) return 'other';
  if (/квартир|жиль|апартамент|вилл|дом|condo|apartment|house/u.test(value)) return 'housing_rent';
  if (/машин|авто|car|vehicle/u.test(value)) return 'car_rent';
  return 'other';
}

function externalIntent(text) {
  const value = String(text).toLowerCase();
  if (/(виз|visa|dtv|ltr)/u.test(value)) return 'visa';
  if (/(трансфер|transfer|airport|аэропорт)/u.test(value)) return 'transfer';
  if (/(экскурс|tour\b)/u.test(value)) return 'tour';
  return '';
}

assert.equal(parseStartDate('С 11 сентября'), '2026-09-11');
assert.equal(parseStartDate('С 11 сентября.'), '2026-09-11');
assert.equal(parseStartDate('from 11 september'), '2026-09-11');
assert.equal(greeting('Здравствуйте. Нужна машина в Паттайе, на месяц'), 'Здравствуйте!');
assert.equal(greeting('Добрый день. Нужна машина'), 'Здравствуйте!');
assert.equal(greeting('С 11 сентября'), '');
assert.equal(firstReply('Здравствуйте. Нужна машина в Паттайе, на месяц'), 'Здравствуйте! Помогу подобрать машину. С какой даты нужна аренда?');
assert.equal(parseRooms('2'), 2);
assert.equal(parseRooms('две'), 2);
assert.equal(parseRooms('3 комнаты'), 3);
assert.equal(topicReference('Вернёмся к квартире'), 'housing_rent');
assert.equal(topicReference('А что с машиной?'), 'car_rent');
assert.equal(topicReference('Паттайя'), 'other');
assert.equal(externalIntent('Теперь нужен трансфер из аэропорта'), 'transfer');
assert.equal(externalIntent('Нужна виза DTV'), 'visa');
assert.equal(externalIntent('В 10 утра'), '');

console.log('topic runtime regression checks passed');
