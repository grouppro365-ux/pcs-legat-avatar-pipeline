import assert from 'node:assert/strict';
import test from 'node:test';
import {validateBookingFinalization, operationalBookingProjection} from './booking-finalize.mjs';

const request = {id:'request',contact_id:'contact',catalog_item_id:'car',status:'ready_for_booking',passport_status:'approved',international_permit_status:'approved',passport_media_intake_id:'passport-file',permit_media_intake_id:'permit-file',payment_status:'paid',finance_entry_id:'finance',booking_deposit_amount:650,currency:'THB'};
const finance = {id:'finance',contact_id:'contact',status:'paid',paid_at:'2026-09-23T00:00:00Z',payment_kind:'booking_deposit',metadata:{booking_request_id:'request'},amount:650,currency:'THB'};
const item = {id:'car',ownership_type:'pcs_owned'};
const intakes = ['passport','international_permit'].map((classification,index)=>({id:index?'permit-file':'passport-file',contact_id:'contact',classification,review_status:'approved',extracted:{booking_request_id:'request',storage_bucket:'pcs-contracts',storage_path:`booking-requests/request/${classification}.pdf`}}));

test('booking requires independently approved documents and exact paid finance evidence', () => {
  assert.doesNotThrow(() => validateBookingFinalization(request,finance,item,intakes));
  assert.throws(() => validateBookingFinalization({...request,passport_status:'received'},finance,item,intakes), /booking_request_not_verified/);
  assert.throws(() => validateBookingFinalization(request,{...finance,amount:600},item,intakes), /booking_payment_evidence_invalid/);
  assert.throws(() => validateBookingFinalization(request,{...finance,metadata:{booking_request_id:'other'}},item,intakes), /booking_payment_evidence_invalid/);
  assert.throws(() => validateBookingFinalization(request,finance,{...item,ownership_type:'partner'},intakes), /booking_vehicle_not_owned/);
  assert.throws(() => validateBookingFinalization(request,finance,item,[intakes[0]]), /booking_document_evidence_invalid/);
  assert.throws(() => validateBookingFinalization(request,finance,item,[{...intakes[0],review_status:'needs_review'},intakes[1]]), /booking_document_evidence_invalid/);
  assert.throws(() => validateBookingFinalization(request,finance,item,[{...intakes[0],extracted:{...intakes[0].extracted,storage_bucket:'public'}},intakes[1]]), /booking_document_evidence_invalid/);
});

test('an operational request is not described as a confirmed booking', () => {
  assert.deepEqual(operationalBookingProjection('NEW'),{operationalStatus:'NEW',reservationStatus:'requested',requestStatus:'ready_for_booking'});
  assert.deepEqual(operationalBookingProjection('AWAITING_PARTNER_CONFIRMATION'),{operationalStatus:'AWAITING_PARTNER_CONFIRMATION',reservationStatus:'hold',requestStatus:'ready_for_booking'});
  assert.deepEqual(operationalBookingProjection('CONFIRMED'),{operationalStatus:'CONFIRMED',reservationStatus:'confirmed',requestStatus:'booked'});
  assert.throws(() => operationalBookingProjection('CANCELLED_BY_CLIENT'), /booking_operational_status_requires_review/);
});
