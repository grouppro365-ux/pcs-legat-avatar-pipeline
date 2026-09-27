import assert from 'node:assert/strict';
import test from 'node:test';
import { carRentalJourney, rentalRange, rentalCandidates } from './car-rental-journey.mjs';
import { parseRentalRange, rentalDays } from '../../../supabase/functions/_shared/rental-period.mjs';

const now = new Date('2026-09-27T12:00:00Z');

test('specific PCS model inquiries enter catalog qualification and retain the model', () => {
  for (const [name, model] of [['MG5', 'MG5'], ['Форд Фокус', 'Focus'], ['Ford Fiesta', 'Fiesta']]) {
    const journey = carRentalJourney([], `Нужна аренда ${name} в Паттайе 10.11.2026–12.11.2026`, now);
    assert.equal(journey.matches, true, name);
    assert.equal(journey.model, model, name);
    assert.equal(journey.question, null, name);
  }
});

test('latest model choice wins without confusing a purchase with a rental', () => {
  const history = ['Нужна машина в Паттайе 10.11.2026–12.11.2026', 'Ford Fiesta'];
  assert.equal(carRentalJourney(history, 'Лучше MG5', now).model, 'MG5');
  assert.equal(carRentalJourney(history, 'Хочу купить Ford Focus', now).matches, false);
});

test('catalog selection respects requested model, city, publication and sale status', () => {
  const item = { id: 'mg5', title: 'MG5 Pro 1.5 CVT K-BRIT 2025', category: 'car_rent', city: 'Pattaya', status: 'available', customer_visible: true, deleted_at: null };
  const catalog = [item,
    { ...item, id: 'fiesta', title: 'Ford Fiesta красная' },
    { ...item, id: 'hidden', customer_visible: false },
    { ...item, id: 'review', status: 'requires_confirmation' },
    { ...item, id: 'sold', status: 'sold' },
    { ...item, id: 'deleted', deleted_at: '2026-09-01T00:00:00Z' },
    { ...item, id: 'phuket', city: 'Phuket' },
    { ...item, id: 'purchase', category: 'car_buy' },
  ];
  const journey = carRentalJourney([], 'Аренда MG5 в Паттайе 10.11.2026–12.11.2026', now);
  assert.deepEqual(rentalCandidates(catalog, journey).map(x => x.id), ['mg5']);
  assert.deepEqual(rentalCandidates(catalog.slice(1), journey), [], 'never silently substitute another model');
  const generic = carRentalJourney([], 'Нужна машина в Паттайе 10.11.2026–12.11.2026', now);
  assert.deepEqual(rentalCandidates(catalog, generic).map(x => x.id), ['mg5', 'fiesta']);
  assert.deepEqual(rentalCandidates(catalog, carRentalJourney([], 'Нужна MG5', now)), []);
});

test('Hub and Telegram use the same pickup and return dates', () => {
  for (const text of ['10.11.2026–12.11.2026', '2026-11-10 — 2026-11-12', 'с 10 по 12 ноября 2026', '30.12–02.01', '10 по 12 января']) {
    const telegram = parseRentalRange(text, now);
    assert.ok(telegram, text);
    assert.deepEqual(rentalRange(text, now), { start: telegram.start, end: telegram.end }, text);
  }
});

test('two rental days end two days after pickup, not one', () => {
  const range = rentalRange('с 10.11.2026 на 2 дня', now);
  assert.deepEqual(range, { start: '2026-11-10', end: '2026-11-12' });
  assert.equal(rentalDays(range.start, range.end), 2);
});

test('Hub asks for dates instead of quoting impossible or past periods', () => {
  for (const dates of ['31.11.2026–02.12.2026', '10.09.2026–12.09.2026', '10.11.2026–10.11.2026', 'с 10.11.2026 на 0 дней']) {
    const journey = carRentalJourney([], `Нужна машина в Паттайе ${dates}`, now);
    assert.equal(journey.range, null, dates);
    assert.equal(journey.question, 'На какие даты нужна аренда автомобиля?', dates);
  }
});
