import test from 'node:test';
import assert from 'node:assert/strict';
import { carOfferSnapshot, carOffersReply, publicCarTitle } from './car-rental-response.mjs';

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

test('Hub keeps ordered car IDs and quoted terms for a later customer choice', () => {
  const snapshot = carOfferSnapshot([
    { id: 'first', title: 'LTC-005 · Ford Focus III 2.0 · серебристый · 3152', total: 800, currency: 'THB', deposit: 5000 },
    { id: 'second', title: 'MG5', total: 1320, currency: 'THB', deposit: 10000 },
  ], { start: '2026-11-10', end: '2026-11-12' });
  assert.equal(snapshot.version, 1);
  assert.deepEqual(snapshot.options.map(option => option.catalog_item_id), ['first', 'second']);
  assert.equal(snapshot.options[0].total_before_extras, 800);
  assert.equal(snapshot.options[0].security_deposit_thb, 5000);
  assert.deepEqual([snapshot.start_date, snapshot.end_date], ['2026-11-10', '2026-11-12']);
  assert.throws(() => carOfferSnapshot([{ id: 'x', total: 0 }], { start: '2026-11-10', end: '2026-11-12' }), /invalid_car_offer_option/);
});
