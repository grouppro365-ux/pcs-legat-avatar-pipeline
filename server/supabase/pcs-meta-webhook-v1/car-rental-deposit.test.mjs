import test from 'node:test';
import assert from 'node:assert/strict';
import {selectedVehicleReply,continueVehicleBooking} from '../../../supabase/functions/pcs-business-runtime-v8/vehicle-offer.mjs';
import {carOfferSnapshot} from './car-rental-response.mjs';

test('selection retains the deposit quoted to the client after a catalog price change', () => {
  const offer={start:'2026-11-10',end:'2026-11-12'};
  const selected={title:'Ford Fiesta',total:600,currency:'THB',security_deposit_thb:5000};
  const catalog={title:'Ford Fiesta',metadata:{security_deposit_thb:10000}};
  const answer=selectedVehicleReply(offer,selected,catalog);
  assert.match(answer,/5\s*000 бат/);
  assert.doesNotMatch(answer,/10\s*000 бат/);
});

test('Instagram snapshot selection preserves the offered deposit before any booking is created', async () => {
  const now=Date.parse('2026-10-01T10:00:00Z');
  const snapshot=carOfferSnapshot([{id:'car-1',title:'Ford Fiesta',total:600,currency:'THB',deposit:5000}],
    {start:'2026-11-10',end:'2026-11-12'});
  const offer={...snapshot,id:'offer-1',created_at:new Date(now).toISOString(),
    start:snapshot.start_date,end:snapshot.end_date,
    items:snapshot.options.map(option=>({id:option.catalog_item_id,title:option.title,
      total:option.total_before_extras,currency:option.currency}))};
  let requests=0;
  const result=await continueVehicleBooking({text:'1',offer,contactId:'client-1',now,
    store:{item:async()=>({id:'car-1',title:'Ford Fiesta',status:'available',customer_visible:true,
      deleted_at:null,ownership_type:'pcs_owned',metadata:{security_deposit_thb:10000}}),
      available:async()=>true,request:async()=>{requests++;throw Error('must_not_book');}}});
  assert.equal(result.action,'select');
  assert.match(result.answer,/5\s*000 бат/);
  assert.doesNotMatch(result.answer,/10\s*000 бат/);
  assert.equal(requests,0);
});
