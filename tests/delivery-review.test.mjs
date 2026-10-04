import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewInput,deliveryReviewQuery,confirmManualDelivery} from '../server/supabase/pcs-manager-live2/delivery-review.mjs';
import {sendManualMessage} from '../server/supabase/pcs-manager-live2/manual-send.mjs';
const cid='contact1',mid='11111111-1111-4111-8111-111111111111',base={message_id:mid,expected_version:'2026-10-04 12:30:00.123456',note:'Checked actual Telegram conversation',confirmed:true};
test('manual delivery review requires explicit attestation, note, identity and exact version',()=>{
 assert.equal(reviewInput(cid,{...base,note:' Checked conversation '}).note,'Checked conversation');
 for(const p of [{confirmed:false},{confirmed:'true'},{note:'short'},{note:'x'.repeat(1001)},{expected_version:'now'},{message_id:'approval:some'},{status:'SENT'},{telegram_message_id:12}])assert.throws(()=>reviewInput(cid,{...base,...p}));
});
test('review binds contact and message, checks held state, excludes AI attempts and audits atomically',async()=>{
 const q=deliveryReviewQuery(cid,{...base,note:"Checked '); DROP TABLE messages; --"},'audit1');assert.doesNotMatch(q.query,/DROP TABLE/);assert.deepEqual(q.params.slice(0,3),[mid,cid,base.expected_version]);assert.match(q.query,/cv.contact_id=\$2/);assert.match(q.query,/m.updated_at::text=\$3/);assert.match(q.query,/m.status='PROCESSING'/);assert.match(q.query,/not\(m.raw \? 'approval_send'\)/);assert.match(q.query,/insert into audit_logs/);assert.doesNotMatch(q.query,/set telegram_message_id|sent_at=/);
 await assert.rejects(()=>confirmManualDelivery({query:async()=>[]},cid,base),e=>e.code==='delivery_review_conflict');assert.equal((await confirmManualDelivery({query:async()=>[{id:mid,contact_id:cid}]},cid,base)).operator_confirmed,true);
});
test('operator-confirmed manual attempts replay without a Telegram call or fabricated provider ID',async()=>{
 let calls=0;const row={id:mid,request_contact:cid,status:'SENT',direction:'OUT',text:'Message',telegram_message_id:null,raw:{manual_send:{contact_id:cid,stage:'sent'},delivery_review:{method:'operator_attestation',outcome:'delivered'}}};
 const result=await sendManualMessage({query:async()=>[row]},cid,{text:'Message',request_id:mid},()=>{calls++;assert.fail('Telegram called')});assert.equal(calls,0);assert.equal(result.operator_confirmed,true);assert.equal(result.replayed,true);assert.equal(result.message_id,undefined);
 row.status='PROCESSING';await assert.rejects(()=>sendManualMessage({query:async()=>[row]},cid,{text:'Message',request_id:mid},()=>assert.fail('Telegram called')),e=>e.code==='delivery_uncertain');
});
