import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { publicVehicleName, securityDepositLine, humanRentalDates, vehicleOffersReply, isBookingConfirmation, selectedVehicleReply } from './vehicle-offer.mjs';

test('hides internal fleet code but keeps the vehicle distinguishable', () => {
  assert.equal(publicVehicleName('LTC-001 · Ford Fiesta · красный · 3675'), 'Ford Fiesta · красный · 3675');
  assert.equal(publicVehicleName('MG MG5 Pro 1.5 CVT K-BRIT 2025'), 'MG5 Pro 1.5 CVT K-BRIT 2025');
});

test('shows the security deposit without inventing a missing value', () => {
  assert.match(securityDepositLine({security_deposit_thb: '5000'}), /5\s?000 THB/);
  assert.equal(securityDepositLine({}), '');
  assert.equal(securityDepositLine({security_deposit_thb: 'invalid'}), '');
});

test('runtime labels offers as conditional and includes deposit', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  assert.match(source, /vehicleOffersReply\(/);
  assert.doesNotMatch(source, /Вот подтверждённые варианты/);
});

test('rental offer sounds natural and keeps the verified price and deposit', () => {
  assert.equal(humanRentalDates('2026-11-10', '2026-11-12', 2026), '10–12 ноября');
  const items = ['синий металлик · 5564', 'белый · 3865', 'красный · 3675'].map((variant, i) => ({
    title: `LTC-00${i + 1} · Ford Fiesta · ${variant}`,
    display_price: 600,
    currency: 'THB',
    metadata: {security_deposit_thb: 5000},
  }));
  const reply = vehicleOffersReply({start:'2026-11-10',end:'2026-11-12',days:2},items,'Паттайя');
  assert.match(reply, /На 10–12 ноября в Паттайе/);
  assert.match(reply, /600 бат за 2 дня/);
  assert.match(reply, /5\s?000 бат/);
  assert.match(reply, /Перед бронью ещё раз проверю наличие/);
  assert.doesNotMatch(reply, /LTC-|2026-11-|по каталогу|Расчётный срок/);
  assert.equal((reply.match(/600 бат/g) || []).length, 1);
});

test('a numeric choice is not consent to create a booking', () => {
  assert.equal(isBookingConfirmation('1'), false);
  assert.equal(isBookingConfirmation('не подтверждаю бронь'), false);
  assert.equal(isBookingConfirmation('Подтверждаю бронь'), true);
  assert.equal(isBookingConfirmation('Хочу оформить'), true);
  assert.equal(isBookingConfirmation('Да, подтверждаю бронирование'), true);
  const reply = selectedVehicleReply({start:'2026-11-10',end:'2026-11-12'}, {total:600,currency:'THB'}, {title:'LTC-001 · Ford Fiesta · красный · 3675',metadata:{security_deposit_thb:5000}});
  assert.match(reply, /Пока автомобиль не забронирован/);
  assert.match(reply, /паспорт, международное водительское удостоверение и бронировочная предоплата/);
  assert.match(reply, /600 бат/);
  assert.match(reply, /5\s?000 бат/);
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  assert.match(source, /else if\(!confirming\)\{/);
  assert.match(source, /stage:'awaiting_confirmation'/);
  assert.match(source, /pcs_booking_requests/);
  assert.doesNotMatch(source, /createVehicleBooking\(/);
  assert.match(source, /not\('raw->pcs_offer','is',null\)/);
});
