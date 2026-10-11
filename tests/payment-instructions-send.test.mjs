import test from 'node:test';
import assert from 'node:assert/strict';
import {id,fixture} from './runtime-send-fixture.mjs';
import {dispatchPaymentInstructions,paymentInstructionsText,enqueuePaymentInstructions,claimPaymentInstructions,currentPaymentInstructions,finishPaymentInstructions} from '../server/supabase/pcs-manager-live2/payment-instructions-send.mjs';
const payload=()=>({application_id:id,client_profile_id:id,contact_id:id,revision:'2026-10-11',public_id:'PCS-QA',recipient:'PARTNER',price:'1200.50',deposit:'2000.00',instructions:'QA Bank\nRecipient: Example Partner\nAccount: 001234567',payment_worker_owner:crypto.randomUUID()});
function setup(){
 const f=fixture();let current=true,finish=[],claimed=false;const job={id:crypto.randomUUID(),payload:payload(),attempts:1};
 const biz={query:async(q,p)=>{
  if(q===enqueuePaymentInstructions)return [];
  if(q===claimPaymentInstructions){if(claimed)return [];claimed=true;return [structuredClone(job)];}
  if(q===currentPaymentInstructions)return current?[{id}]:[];
  if(q===finishPaymentInstructions){finish.push(p);return [{id:job.id}];}
  assert.ok(q.startsWith('update pcs_workflow_outbox'));job.payload.channel=p[2];job.payload.delivery_text=p[3];return [{id:job.id}];
 }};
 return {...f,job,biz,finish,stale(){current=false},retry(){claimed=false;job.attempts++}};
}
test('saved recipient and bank details stay verbatim; service price and refundable deposit remain separate',()=>{
 for(const language of ['ru','en','th']){const p=payload(),text=paymentInstructionsText(p,language);assert.ok(text.includes(p.instructions));assert.ok(text.includes('1200.50 THB'));assert.ok(text.includes('2000.00 THB'));assert.ok(!text.includes('3200.50'));}
 for(const changes of [{recipient:'PCS'},{instructions:''},{price:'0'},{price:'NaN'},{price:'-10'}])assert.throws(()=>paymentInstructionsText({...payload(),...changes}));
});
test('stale instructions never reach transport',async()=>{
 const f=setup();f.stale();const result=await dispatchPaymentInstructions(f.biz,f.db,()=>assert.fail('stale send'));
 assert.equal(result.superseded,1);assert.equal(f.finish[0][2],'CANCELLED');assert.equal(f.finish[0][3],'superseded');
});
test('worker sends saved details, freezes channel, records history and reclaims without duplicate transport',async()=>{
 const f=setup();let sends=0;const transport=async out=>{sends++;assert.ok(out.text.includes(f.job.payload.instructions));return {message_id:123}};
 assert.equal((await dispatchPaymentInstructions(f.biz,f.db,transport)).sent,1);assert.equal(f.job.payload.channel,'telegram');assert.equal(f.finish[0][2],'SENT');assert.equal(f.tables.pcs_messages.length,1);
 f.retry();assert.equal((await dispatchPaymentInstructions(f.biz,f.db,transport)).duplicates,1);assert.equal(sends,1);
});
test('receipt survives history failure; retry repairs recording without repeating transfer details',async()=>{
 const f=setup();f.failHistory();let sends=0;const transport=async()=>{sends++;return {message_id:124}};
 assert.equal((await dispatchPaymentInstructions(f.biz,f.db,transport)).retry,1);assert.equal(f.finish[0][2],'FAILED');
 f.tables.pcs_contacts[0].detected_language='en';f.tables.pcs_contacts[0].preferred_channel='line';
 f.retry();assert.equal((await dispatchPaymentInstructions(f.biz,f.db,transport)).sent,1);assert.equal(sends,1);assert.equal(f.tables.pcs_messages.length,1);
});
test('uncertain delivery is held for operator review and reclaims cannot send again',async()=>{
 const f=setup();let sends=0;const transport=async()=>{sends++;throw Error('timeout')};
 assert.equal((await dispatchPaymentInstructions(f.biz,f.db,transport)).review,1);assert.equal(f.finish[0][2],'CANCELLED');assert.equal(f.tables.pcs_tasks.length,1);
 f.retry();await dispatchPaymentInstructions(f.biz,f.db,transport);assert.equal(sends,1);
});
test('missing contact and overlong payment data require review without truncation or external send',async()=>{
 for(const mutate of [f=>{f.tables.pcs_contacts=[]},f=>{f.job.payload.instructions='x'.repeat(4000)}]){
  const f=setup();mutate(f);assert.equal((await dispatchPaymentInstructions(f.biz,f.db,()=>assert.fail('invalid send'))).review,1);assert.equal(f.finish[0][2],'CANCELLED');
 }
});
