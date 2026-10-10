import test from 'node:test';
import assert from 'node:assert/strict';
import {bookingEditQuery,updateBooking,validateBookingEditCatalog} from '../server/supabase/pcs-manager-live2/booking-edit.mjs';
const b=()=>({id:'11111111-1111-4111-8111-111111111111',expected_version:'2026-10-09 00:00:00.123456+00',operational_status:'CONFIRMED',status:'CANCELLED_BY_CLIENT',item_id:'22222222-2222-4222-8222-222222222222',client_name:'Private name',client_contact:'Private contact',internal_notes:'Private note',qualification_data:{start_date:'2026-10-10',end_date:'2026-10-20',total_amount:100,deposit_amount:10,currency:'THB',photo_url:'https://private.invalid/photo'}});
test('booking update and audit share one statement and the receipt depends on the audit',()=>{
 for(const kind of ['edit','status']){
  const q=bookingEditQuery(b(),kind);assert.match(q.query,/candidate as materialized/);assert.match(q.query,/updated_at::text=\$2/);assert.match(q.query,/for update/);assert.match(q.query,/insert into audit_events/);assert.match(q.query,/exists\(select 1 from audited/);
  assert.equal(q.params[4],kind==='edit'?'booking_updated':'booking_status_updated');assert.deepEqual(q.params[5],['NEW','AWAITING_PARTNER_CONFIRMATION','CONFIRMED']);
  const audit=q.query.slice(q.query.indexOf('insert into audit_events'));assert.doesNotMatch(audit,/client_contact|client_name|internal_notes|photo|total_amount|deposit_amount/);
  assert.match(audit,/'before'/);assert.match(audit,/'after'/);
 }
});
test('status change does not replace client, financial or qualification fields',()=>{
 const q=bookingEditQuery(b(),'status'),update=q.query.slice(q.query.indexOf('update applications'),q.query.indexOf('),audited'));
 assert.doesNotMatch(update,/client_name=|client_contact=|qualification_data=|client_payment_status=|settlement_status=/);
 assert.deepEqual(JSON.parse(q.params[3]),{});
 const edit=bookingEditQuery(b()).query;assert.doesNotMatch(edit,/client_payment_status=|partner_response_status=|settlement_status=/);
});
test('invalid inputs cannot reach the database and stale versions never return success',async()=>{
 const db={query:()=>assert.fail('invalid write')};
 for(const patch of [{id:'bad'},{expected_version:null},{expected_version:''},{operational_status:'SERVICE_IN_PROGRESS'},{operational_status:'COMPLETED'},{qualification_data:{total_amount:10,deposit_amount:11}}])await assert.rejects(()=>updateBooking(db,{...b(),...patch}),e=>e.status===400);
 await assert.rejects(()=>updateBooking({query:async()=>[]},b()),e=>e.status===409);
 await assert.rejects(()=>updateBooking({query:async()=>{throw Error('audit unavailable')}},b()),/audit unavailable/);
});
test('successful booking mutation returns only its persisted receipt',async()=>{
 let calls=0;const row={id:b().id,operational_status:'CONFIRMED',edit_version:'new-full-version'};
 const result=await updateBooking({query:async()=>{calls++;return[row]}},b());assert.deepEqual(result,{ok:true,...row});assert.equal(calls,1);
});

test('invalid calendar dates and vehicle identities are refused by the direct edit module',async()=>{
 const db={query:()=>assert.fail('invalid terms reached SQL')};
 for(const patch of [{item_id:null},{item_id:'bad'},{qualification_data:{}},{qualification_data:{start_date:'2026-02-30',end_date:'2026-03-05'}},{qualification_data:{start_date:'2026-10-20',end_date:'2026-10-10'}}])await assert.rejects(()=>updateBooking(db,{...b(),...patch}),e=>e.status===400);
});

test('catalog preflight is bound to the submitted item and skips unchanged terms or cancellation',async()=>{
 const input=b(),current={item_id:input.item_id,qualification_data:input.qualification_data};
 await validateBookingEditCatalog({query:()=>assert.fail('unchanged read')},input,current);
 await validateBookingEditCatalog({query:()=>assert.fail('cancel read')},{...input,item_id:'33333333-3333-4333-8333-333333333333',operational_status:'CANCELLED_BY_CLIENT'},current);
 const changed={...input,qualification_data:{...input.qualification_data,end_date:'2026-10-21'}};
 let calls=0;await validateBookingEditCatalog({query:async(q,p)=>{calls++;assert.equal(p[0],input.item_id);assert.match(q,/entity_type='VEHICLE'/);assert.match(q,/client_price_thb>0/);assert.match(q,/publication_status='PUBLISHED'/);assert.match(q,/moderation_status='APPROVED'/);assert.match(q,/publication_ends_at>now/);return[{id:p[0]}];}},changed,current);
 assert.equal(calls,1);
 await assert.rejects(()=>validateBookingEditCatalog({query:async()=>[]},changed,current),e=>e.status===409);
});
