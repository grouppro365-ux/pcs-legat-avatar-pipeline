import test from 'node:test';import assert from 'node:assert/strict';
import {id,fixture} from './runtime-send-fixture.mjs';
import {dispatchWorkflowDelivery,workflowDeliveryText,enqueueWorkflowDelivery,claimWorkflowDelivery,currentWorkflowDelivery,finishWorkflowDelivery} from '../server/supabase/pcs-manager-live2/workflow-delivery.mjs';
function setup(){const f=fixture();let due=true,current=true;const finishes=[];const job={id:crypto.randomUUID(),attempts:1,payload:{application_id:id,client_profile_id:id,contact_id:id,public_id:'QA',kind:'PARTNER_FINAL_CONFIRMED',revision:'event:test',payment_worker_owner:crypto.randomUUID()}};
 const biz={query:async(q,p)=>{if(q===enqueueWorkflowDelivery)return [];if(q===claimWorkflowDelivery){if(!due)return [];due=false;return [structuredClone(job)];}if(q===currentWorkflowDelivery)return current?[{id}]:[];if(q===finishWorkflowDelivery){finishes.push(p);return [{id:job.id}];}job.payload.channel=p[2];job.payload.delivery_text=p[3];return [{id:job.id}];}};
 return {...f,biz,job,finishes,stale(){current=false},retry(){due=true;job.attempts++}};}
test('public messages use fixed RU/EN/TH stages and only approved offer public terms and separate deposit',()=>{
 for(const lang of ['ru','en','th']){const t=workflowDeliveryText({kind:'OFFER_READY',public_id:'QA',price:'1000',deposit:'200',terms:'Public terms',internal_net_thb:1},lang);assert.ok(t.includes('1000 THB'));assert.ok(t.includes('200 THB'));assert.ok(t.includes('Public terms'));assert.ok(!t.includes('internal_net'));}
 assert.throws(()=>workflowDeliveryText({kind:'UNKNOWN'}));assert.throws(()=>workflowDeliveryText({kind:'OFFER_READY',price:'0',terms:'test'}));
});
test('stage delivery freezes message and reclaims without duplicate transport; stale stages are cancelled',async()=>{
 const f=setup();let sends=0;const send=async()=>{sends++;return {message_id:543}};
 assert.equal((await dispatchWorkflowDelivery(f.biz,f.db,send)).sent,1);f.retry();assert.equal((await dispatchWorkflowDelivery(f.biz,f.db,send)).duplicates,1);assert.equal(sends,1);
 const stale=setup();stale.stale();assert.equal((await dispatchWorkflowDelivery(stale.biz,stale.db,()=>assert.fail('stale send'))).superseded,1);assert.equal(stale.finishes[0][2],'CANCELLED');
});
test('uncertain delivery requires review; successful receipt repairs history without resending',async()=>{
 const f=setup();f.failHistory();let sends=0;const send=async()=>{sends++;return {message_id:544}};
 assert.equal((await dispatchWorkflowDelivery(f.biz,f.db,send)).retry,1);f.retry();assert.equal((await dispatchWorkflowDelivery(f.biz,f.db,send)).sent,1);assert.equal(sends,1);
 const uncertain=setup();let attempts=0;const timeout=async()=>{attempts++;throw Error('timeout')};assert.equal((await dispatchWorkflowDelivery(uncertain.biz,uncertain.db,timeout)).review,1);uncertain.retry();await dispatchWorkflowDelivery(uncertain.biz,uncertain.db,timeout);assert.equal(attempts,1);
});
