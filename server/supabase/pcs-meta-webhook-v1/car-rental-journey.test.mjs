import assert from 'node:assert/strict';
import test from 'node:test';
import { carRentalJourney, rentalRange } from './car-rental-journey.mjs';
import { parseRentalRange, rentalDays } from '../../../supabase/functions/_shared/rental-period.mjs';

const now = new Date('2026-09-27T12:00:00Z');

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
