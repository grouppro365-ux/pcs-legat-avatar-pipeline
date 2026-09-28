import test from 'node:test';
import assert from 'node:assert/strict';
import { carOffersReply, publicCarTitle } from './car-rental-response.mjs';

test('customer title omits internal fleet ID and registration suffix', () => {
  assert.equal(publicCarTitle('LTC-001 · Ford Fiesta · красный · 3675'), 'Ford Fiesta · красный');
  assert.equal(publicCarTitle('LTR-010 · MG5 · белый · 1234'), 'MG5 · белый');
});

test('rental offer states quoted amount, refundable security deposit and confirmation caveat', () => {
  const answer = carOffersReply([{ title: 'LTC-001 · Ford Fiesta · красный · 3675',
    total: 600, currency: 'THB', deposit: 5000 }], { start: '2026-11-10', end: '2026-11-12' });
  assert.match(answer, /10 ноября — 12 ноября/);
  assert.match(answer, /600 THB за аренду/);
  assert.match(answer, /возвратный залог 5\s?000 THB/);
  assert.match(answer, /подтвердим наличие/);
  assert.doesNotMatch(answer, /LTC|3675/);
});
