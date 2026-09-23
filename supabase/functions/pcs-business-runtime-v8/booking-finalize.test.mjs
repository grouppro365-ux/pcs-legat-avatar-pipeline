import assert from 'node:assert/strict';
import test from 'node:test';
import {validateBookingFinalization, operationalBookingProjection} from './booking-finalize.mjs';

const request = {id:'request',contact_id:'contact',catalog_item_id:'car',status:'ready_for_booking',passport_status:'approved',international_permit_status:'approved',payment_status:'paid',finance_entry_id:'finance',booking_deposit_amount:650,currency:'THB'};
const finance = {id:'finance',contact_id:'contact',status:'paid',paid_at:'2026-09-23T00:00:00Z',payment_kind:'booking_deposit',metadata:{booking_request_id:'request'},amount:650,currency:'THB'};
const item = {id:'car',ownership_type:'pcs_owned'};

test('booking requires independently approved documents and exact paid finance evidence', () => {
  assert.doesNotThrow(() => validateBookingFinalization(request,finance,item));
  assert.throws(() => validateBookingFinalization({...request,passport_status:'received'},finance,item), /booking_request_not_verified/);
  assert.throws(() => validateBookingFinalization(request,{...finance,amount:600},item), /booking_payment_evidence_invalid/);
  assert.throws(() => validateBookingFinalization(request,{...finance,metadata:{booking_request_id:'other'}},item), /booking_payment_evidence_invalid/);
  assert.throws(() => validateBookingFinalization(request,finance,{...item,ownership_type:'partner'}), /booking_vehicle_not_owned/);
});

test('an operational request is not described as a confirmed booking', () => {
  assert.deepEqual(operationalBookingProjection('NEW'),{operationalStatus:'NEW',reservationStatus:'requested',requestStatus:'ready_for_booking'});
  assert.deepEqual(operationalBookingProjection('AWAITING_PARTNER_CONFIRMATION'),{operationalStatus:'AWAITING_PARTNER_CONFIRMATION',reservationStatus:'hold',requestStatus:'ready_for_booking'});
  assert.deepEqual(operationalBookingProjection('CONFIRMED'),{operationalStatus:'CONFIRMED',reservationStatus:'confirmed',requestStatus:'booked'});
  assert.throws(() => operationalBookingProjection('CANCELLED_BY_CLIENT'), /booking_operational_status_requires_review/);
});
