import assert from 'node:assert/strict';
import test from 'node:test';
import {requiresVerifiedBookingFlow} from './booking-action-policy.mjs';

test('old reservation buttons cannot confirm, cancel or mark operational bookings paid', () => {
  for (const action of ['bconfirm','bcancel','bpaid']) {
    assert.equal(requiresVerifiedBookingFlow(action,{source:'neon_contract_projection'},null),true);
    assert.equal(requiresVerifiedBookingFlow(action,{source:'legacy'},null),false);
  }
});

test('old finance buttons cannot approve or reject booking deposit evidence', () => {
  for (const action of ['rpay','rreject']) {
    assert.equal(requiresVerifiedBookingFlow(action,null,{payment_kind:'booking_deposit'}),true);
    assert.equal(requiresVerifiedBookingFlow(action,null,{metadata:{booking_request_id:'id'}}),true);
    assert.equal(requiresVerifiedBookingFlow(action,{source:'neon_contract_projection'},{payment_kind:'manual'}),true);
    assert.equal(requiresVerifiedBookingFlow(action,{source:'legacy'},{payment_kind:'manual'}),false);
  }
});
