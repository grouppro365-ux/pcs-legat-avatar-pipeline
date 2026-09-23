import assert from 'node:assert/strict';
import test from 'node:test';
import {bookingConfirmationText} from './booking-confirmation.mjs';

const request={status:'booked',start_date:'2026-11-10',end_date:'2026-11-12',rental_total:1320,booking_deposit_amount:600,currency:'THB'};
test('verified confirmation distinguishes advance, rental balance and security deposit',()=>{
  const text=bookingConfirmationText(request,'LTC-001 · MG5','APP-123');
  assert.match(text,/1\s?320 бат/);
  assert.match(text,/600 бат/);
  assert.match(text,/720 бат/);
  assert.match(text,/залог за сохранность авто/i);
  assert.doesNotMatch(text,/LTC-001/);
});
test('never sends a booking confirmation for an unbooked or invalid snapshot',()=>{
  assert.throws(()=>bookingConfirmationText({...request,status:'ready_for_booking'},'MG5','APP-123'),/snapshot_invalid/);
  assert.throws(()=>bookingConfirmationText({...request,booking_deposit_amount:2000},'MG5','APP-123'),/snapshot_invalid/);
});
