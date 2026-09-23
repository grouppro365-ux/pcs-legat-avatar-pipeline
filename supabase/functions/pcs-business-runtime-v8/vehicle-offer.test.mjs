import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { publicVehicleName, securityDepositLine } from './vehicle-offer.mjs';

test('hides internal fleet code but keeps the vehicle distinguishable', () => {
  assert.equal(publicVehicleName('LTC-001 · Ford Fiesta · красный · 3675'), 'Ford Fiesta · красный · 3675');
  assert.equal(publicVehicleName('MG MG5 Pro 1.5 CVT K-BRIT 2025'), 'MG MG5 Pro 1.5 CVT K-BRIT 2025');
});

test('shows the security deposit without inventing a missing value', () => {
  assert.match(securityDepositLine({security_deposit_thb: '5000'}), /5\s?000 THB/);
  assert.equal(securityDepositLine({}), '');
  assert.equal(securityDepositLine({security_deposit_thb: 'invalid'}), '');
});

test('runtime labels offers as conditional and includes deposit', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  assert.match(source, /securityDepositLine\(x\.metadata/);
  assert.match(source, /Наличие и итоговые условия подтвердим перед бронью/);
  assert.doesNotMatch(source, /Вот подтверждённые варианты/);
});
