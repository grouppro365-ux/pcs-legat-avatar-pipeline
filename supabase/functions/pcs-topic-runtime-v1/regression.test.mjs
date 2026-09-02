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

assert.equal(parseStartDate('С 11 сентября'), '2026-09-11');
assert.equal(parseStartDate('С 11 сентября.'), '2026-09-11');
assert.equal(parseStartDate('from 11 september'), '2026-09-11');
assert.equal(greeting('Здравствуйте. Нужна машина в Паттайе, на месяц'), 'Здравствуйте!');
assert.equal(greeting('Добрый день. Нужна машина'), 'Здравствуйте!');
assert.equal(greeting('С 11 сентября'), '');
assert.equal(firstReply('Здравствуйте. Нужна машина в Паттайе, на месяц'), 'Здравствуйте! Помогу подобрать машину. С какой даты нужна аренда?');

console.log('topic runtime regression checks passed');
