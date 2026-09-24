import assert from 'node:assert/strict';
import test from 'node:test';
import {parseRentalRange,rentalDays} from './rental-period.mjs';

const today=new Date('2026-09-24T12:00:00Z');

test('numeric, ISO and named rental ranges use the same exclusive return date',()=>{
  const expected={start:'2026-11-10',end:'2026-11-12',duration:'2 дня'};
  assert.deepEqual(parseRentalRange('с 10 по 12 ноября 2026',today),expected);
  assert.deepEqual(parseRentalRange('10.11.2026 — 12.11.2026',today),expected);
  assert.deepEqual(parseRentalRange('2026-11-10 — 2026-11-12',today),expected);
  assert.equal(rentalDays(expected.start,expected.end),2);
});

test('ranges without a year roll forward, including December to January',()=>{
  assert.deepEqual(parseRentalRange('10.11–12.11',today),{start:'2026-11-10',end:'2026-11-12',duration:'2 дня'});
  assert.deepEqual(parseRentalRange('30.12–02.01',today),{start:'2026-12-30',end:'2027-01-02',duration:'3 дня'});
  assert.deepEqual(parseRentalRange('10 по 12 января',today),{start:'2027-01-10',end:'2027-01-12',duration:'2 дня'});
});

test('invalid and explicitly past dates never receive an automatic quote',()=>{
  assert.equal(parseRentalRange('31.11.2026 — 02.12.2026',today),null);
  assert.equal(parseRentalRange('12.11.2026 — 10.11.2026',today),null);
  assert.equal(parseRentalRange('10.09.2026 — 12.09.2026',today),null);
  assert.equal(parseRentalRange('10.11.2026 — 10.11.2026',today),null);
});
