import assert from 'node:assert/strict';

const banned = (text = '') => /(дайте знать|сообщите.{0,30}предпочт|постараюсь помочь|уточните.{0,80}(интерес|конкрет)|если вас интересует|могут вас заинтересовать|доступны различные|есть несколько.{0,40}(музе|выстав|экскурс)|помогу с дополнительной информацией|фиксирую)/iu.test(text);

function effectiveIntent(generation, history) {
  if (generation.intent && generation.intent !== 'other') return generation.intent;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message.direction === 'in' && message.intent && message.intent !== 'other') return message.intent;
  }
  return generation.intent || 'other';
}

function requestTheme(text = '') {
  if (/музе|выстав|искусств|галер|museum|exhibition|gallery|\bart\b|культур/iu.test(text)) return 'art';
  if (/слон|elephant/iu.test(text)) return 'elephant';
  if (/храм|temple/iu.test(text)) return 'temple';
  return '';
}

function themeMatch(item, theme) {
  const haystack = [item.title, item.description].join(' ').toLowerCase();
  if (theme === 'art') return /(музе|выстав|искусств|галер|museum|exhibition|gallery|\bart\b)/iu.test(haystack);
  if (theme === 'elephant') return /(слон|elephant)/iu.test(haystack);
  return true;
}

const history = [
  { direction: 'in', intent: 'tour', text: 'Есть экскурсии в Паттайе?' },
  { direction: 'in', intent: 'other', text: 'На завтра, два человека' },
  { direction: 'in', intent: 'other', text: 'Культурные' },
  { direction: 'in', intent: 'other', text: 'Музей' },
];

assert.equal(effectiveIntent({ intent: 'other' }, history), 'tour');
assert.equal(requestTheme('Хочу на выставку искусства'), 'art');
assert.equal(requestTheme('Музей'), 'art');
assert.equal(requestTheme('Культурные'), 'art');
assert.equal(requestTheme('Хочу к слонам'), 'elephant');
assert.equal(requestTheme('Обычная экскурсия'), '');
assert.equal(themeMatch({ title: 'Pattaya Elephant Sanctuary' }, 'art'), false);
assert.equal(themeMatch({ title: 'Art in Paradise — музей иллюзий' }, 'art'), true);
assert.equal(themeMatch({ title: 'Pattaya Elephant Sanctuary' }, 'elephant'), true);
assert.equal(banned('На завтра доступны различные экскурсии.'), true);
assert.equal(banned('В Паттайе есть несколько музеев.'), true);
assert.equal(banned('Если вас интересует что-то конкретное, уточните.'), true);
assert.equal(banned('Уточните, какие мероприятия вас интересуют.'), true);
assert.equal(banned('Я помогу с дополнительной информацией.'), true);
assert.equal(banned('Фиксирую: Паттайя.'), true);
assert.equal(banned('Проверю актуальные варианты и вернусь сюда с конкретикой.'), false);

console.log('generation grounding regression checks passed');
