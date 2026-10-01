import test from 'node:test';
import assert from 'node:assert/strict';
import {selectedVehicleReply} from '../../../supabase/functions/pcs-business-runtime-v8/vehicle-offer.mjs';

test('selection retains the deposit quoted to the client after a catalog price change', () => {
  const offer={start:'2026-11-10',end:'2026-11-12'};
  const selected={title:'Ford Fiesta',total:600,currency:'THB',security_deposit_thb:5000};
  const catalog={title:'Ford Fiesta',metadata:{security_deposit_thb:10000}};
  const answer=selectedVehicleReply(offer,selected,catalog);
  assert.match(answer,/5\s*000 бат/);
  assert.doesNotMatch(answer,/10\s*000 бат/);
});
