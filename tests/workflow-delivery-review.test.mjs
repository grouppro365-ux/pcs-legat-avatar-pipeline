import test from 'node:test';import assert from 'node:assert/strict';
import {readWorkflowDeliveries,workflowDeliveryList,reviewWorkflowInput,reviewWorkflowDelivery,reviewWorkflowDeliveryQuery} from '../server/supabase/pcs-manager-live2/workflow-delivery-review.mjs';
const id='00000000-0000-4000-8000-000000000001',body=()=>({id,request_id:id,expected_version:'a'.repeat(32),decision:'DELIVERED',note:'Checked exact message in the real conversation',confirmed:true});
test('outbox views are bounded, bind filters and expose frozen text only to authorized reviewers',async()=>{
 let params;const result=await readWorkflowDeliveries({query:async(q,p)=>{assert.equal(q,workflowDeliveryList);params=p;return Array.from({length:51},()=>({id}))}},'review','2',false);assert.deepEqual(params,[['PAYMENT_INSTRUCTIONS_READY','CLIENT_WORKFLOW_NOTICE_READY','CLIENT_FOLLOWUP_READY'],'review',100,false]);assert.equal(result.rows.length,50);assert.equal(result.truncated,true);assert.equal(result.can_review,false);assert.match(workflowDeliveryList,/case when \$4::boolean then e.payload->>'delivery_text'/);assert.doesNotMatch(workflowDeliveryList,/select \*|e.payload,/);
 for(const [view,page] of [['bad','0'],['review','-1'],['all','5001']])await assert.rejects(()=>readWorkflowDeliveries({query:()=>assert.fail('invalid read')},view,page),e=>e.status===400);
});
test('operator review requires actual acknowledgement and cannot grant roles or silently rewrite a command',async()=>{
 for(const update of [{confirmed:false},{note:'short'},{decision:'RESEND'},{role:'OWNER'},{expected_version:'bad'},{request_id:'bad'}])assert.throws(()=>reviewWorkflowInput({...body(),...update}));
 let params;const r=await reviewWorkflowDelivery({query:async(q,p)=>{assert.equal(q,reviewWorkflowDeliveryQuery);params=p;return [{result:{ok:true,id,request_id:id,decision:'DELIVERED'}}]}},body(),id);assert.equal(r.id,id);assert.equal(params[5],id);
 await assert.rejects(()=>reviewWorkflowDelivery({query:async()=>[]},body()),e=>e.status===409);
 assert.match(reviewWorkflowDeliveryQuery,/pcs.staff_context/);assert.match(reviewWorkflowDeliveryQuery,/current_version=\$2/);assert.match(reviewWorkflowDeliveryQuery,/operator_attestation/);assert.match(reviewWorkflowDeliveryQuery,/delivery_review_required/);assert.match(reviewWorkflowDeliveryQuery,/fingerprint/);assert.match(reviewWorkflowDeliveryQuery,/insert into audit_events/);assert.doesNotMatch(reviewWorkflowDeliveryQuery,/set attempts|set next_attempt_at|message_id|sendMessage/);
});
