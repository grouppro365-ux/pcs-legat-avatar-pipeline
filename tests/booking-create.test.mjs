import test from 'node:test';
import assert from 'node:assert/strict';
import {createBooking,bookingDatabaseError} from '../server/supabase/pcs-manager-live2/booking-create.mjs';
const request_id='11111111-1111-4111-8111-111111111111',item_id='22222222-2222-4222-8222-222222222222';
const input=()=>({request_id,item_id,category:'booking',operational_status:'AWAITING_PARTNER_CONFIRMATION',client_name:'QA',qualification_data:{start_date:'2026-10-10',end_date:'2026-10-20',booking_idempotency_key:'forged',booking_request_hash:'forged'}});
function fixture(){let saved=null;const writes=[];return{writes,db:{query:async(q,p)=>{
 if(q.startsWith('select'))return saved?[saved]:[];
 writes.push({q,p});const data=JSON.parse(p[10]);saved={id:p[0],public_id:p[1],request_hash:data.booking_request_hash};return[{id:saved.id,public_id:saved.public_id}];
 }}};}
test('a repeated request returns its original receipt without another booking or upload',async()=>{
 const f=fixture(),b={...input(),photo:{content_base64:'QA',filename:'qa.jpg'}};let uploads=0;
 const first=await createBooking(f.db,b,async()=>{uploads++;return{url:'https://existing.invalid/qa.jpg'}}),second=await createBooking(f.db,b,()=>assert.fail('repeat upload'));
 assert.equal(second.id,first.id);assert.equal(second.replayed,true);assert.equal(f.writes.length,1);assert.equal(uploads,1);
 const q=JSON.parse(f.writes[0].p[10]);assert.equal(q.booking_idempotency_key,request_id);assert.match(q.booking_request_hash,/^[0-9a-f]{64}$/);assert.match(f.writes[0].q,/on conflict.*booking_idempotency_key/s);
 await assert.rejects(()=>createBooking(f.db,{...b,qualification_data:{...b.qualification_data,end_date:'2026-10-21'}},null),e=>e.status===409);
});
test('the loser of an idempotency insert race reads the committed original receipt',async()=>{
 let hash,reads=0;const db={query:async(q,p)=>{if(q.startsWith('select')){reads++;return reads===1?[]:[{id:'original',public_id:'APP-original',request_hash:hash}];}hash=JSON.parse(p[10]).booking_request_hash;return[];}};
 const result=await createBooking(db,input(),null);assert.equal(result.id,'original');assert.equal(result.replayed,true);
});
test('invalid identities, dates and reused request content cannot reach a write',async()=>{
 const db={query:()=>assert.fail('invalid write')};for(const b of [{...input(),request_id:'bad'},{...input(),id:'existing'},{...input(),item_id:null},{...input(),qualification_data:{start_date:'2026-02-30',end_date:'2026-03-10'}}])await assert.rejects(()=>createBooking(db,b,null),e=>e.status===400);
});
test('canonical booking errors receive clear responses without hiding unrelated database failures',()=>{
 assert.equal(bookingDatabaseError({code:'23P01',constraint:'vehicle_booking_no_overlap'}).status,409);
 assert.equal(bookingDatabaseError({code:'22023',message:'booking_dates_invalid'}).status,400);
 for(const e of [{code:'23P01',constraint:'other'},new Error('offline'),null])assert.equal(bookingDatabaseError(e),null);
});
