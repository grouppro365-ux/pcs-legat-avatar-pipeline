import test from 'node:test';
import assert from 'node:assert/strict';
import { continueVehicleBooking } from '../../../supabase/functions/pcs-business-runtime-v8/vehicle-offer.mjs';

test('Instagram deposit question reads the existing request without creating a booking or assuming cross-channel instructions', async () => {
  const offer = { id: 'offer-1', intent: 'car_rent', stage: 'awaiting_documents', booking_request_id: 'request-1' };
  const reads = [];
  const result = await continueVehicleBooking({
    text: 'Сколько внести предоплаты?', offer, contactId: 'client-1',
    store: {
      async paymentRequest(id, contactId) {
        reads.push([id, contactId]);
        return { id: 'request-1', contact_id: 'client-1', offer_id: 'offer-1', status: 'collecting', booking_deposit_amount: 1000, payment_status: 'requested' };
      },
      async item() { throw new Error('must_not_restart_catalog'); },
      async available() { throw new Error('must_not_restart_catalog'); },
      async request() { throw new Error('must_not_create_booking'); },
    },
  });
  assert.equal(result?.action, 'payment_info');
  assert.deepEqual(reads, [['request-1', 'client-1']]);
  assert.match(result.answer, /1\\s?000 бат/);
  assert.match(result.answer, /не забронирован/);
  assert.doesNotMatch(result.answer, /уже прислали выше/);
});
