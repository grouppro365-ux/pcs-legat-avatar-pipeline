import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { specificVehicleIntent, specificVehicleModel } from './vehicle-model.mjs';
import { rentalDays } from '../_shared/rental-period.mjs';

test('recognizes the live Fiesta rental inquiry', () => {
  const text = 'Нужна аренда Ford Fiesta в Паттайе с 10 по 12 ноября 2026 года';
  assert.equal(specificVehicleIntent(text), 'car_rent');
  assert.equal(specificVehicleModel(text), 'Fiesta');
  assert.equal(rentalDays('2026-11-10', '2026-11-12'), 2);
});

test('recognizes Focus and MG5 in Russian and English', () => {
  for (const [input, model] of [
    ['Форд Фокус', 'Focus'], ['Ford Focus 2.0', 'Focus'],
    ['Фиеста', 'Fiesta'], ['MG 5', 'MG5'], ['МГ5', 'MG5']
  ]) assert.equal(specificVehicleModel(input), model, input);
});

test('keeps purchase distinct from rental', () => {
  assert.equal(specificVehicleIntent('Хочу купить Ford Fiesta'), 'car_buy');
  assert.equal(specificVehicleIntent('Хочу арендовать Фиесту'), 'car_rent');
  assert.equal(specificVehicleModel('focused assistance'), '');
});

test('deployed runtime source uses the specific-model classifier', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  assert.match(source, /specificVehicleIntent\(t\)/);
  assert.match(source, /specificVehicleModel\(t\)/);
});
