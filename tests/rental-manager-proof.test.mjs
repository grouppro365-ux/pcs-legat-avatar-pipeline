import test from 'node:test';import assert from 'node:assert/strict';
import {advanceRentalPhase} from '../server/supabase/pcs-manager-live2/rental-phase.mjs';
const id='00000000-0000-4000-8000-000000000001',item='00000000-0000-4000-8000-000000000002';
const fact={method:'operator_attestation',actor:'admin-session:test',occurred_at:'2026-10-01T00:00:00Z'};
const request=(status='SERVICE_IN_PROGRESS')=>new Request('https://test',{method:'POST',body:JSON.stringify({id,expected_status:status==='COMPLETED'?'SERVICE_IN_PROGRESS':'CONFIRMED',status})});
function fixture(override={},options={}){
 let writes=0;
 const app={id,item_id:item,execution_issue_status:options.issue||'NONE',category:'booking',operational_status:options.status||'CONFIRMED',edit_version:'v1',qualification_data:{start_date:'2026-10-01',end_date:'2026-10-03'}};
 const c={status:'ready_to_sign',missing_fields:[],rental_data:{start_date:'2026-10-01',end_date:'2026-10-03'},handover_data:{handover_confirmation:fact,generation_context:{catalog_item_id:item}},...override};
 const biz={query:async(sql,args)=>{if(sql.startsWith('select'))return [app];writes++;assert.equal(args[3],'v1');return options.concurrent?[]:[{id}];}};
 const db={from:t=>{const q={select(){return q},eq(){return q},not(){return q},order(){return q},limit(){return q},maybeSingle:async()=>({data:t==='pcs_contracts'?c:{id,source:'neon_contract_projection',catalog_item_id:item},error:options.failed?{}:null})};return q;}};
 return{call:s=>advanceRentalPhase(request(s),biz,db),writes:()=>writes};
}
test('authenticated direct rental phase still requires server-side finalized contract and handover facts',async()=>{
 for(const override of [{handover_data:{}},{status:'draft'},{missing_fields:['passport']},{rental_data:{start_date:'2026-09-01',end_date:'2026-10-03'}},{handover_data:{generation_context:{catalog_item_id:item},handover_confirmation:{...fact,method:'client_claim'}}},{handover_data:{generation_context:{catalog_item_id:id},handover_confirmation:fact}}]){
 const f=fixture(override);await assert.rejects(()=>f.call(),e=>e.status===409);assert.equal(f.writes(),0);
 }
 const f=fixture();assert.deepEqual(await f.call(),{ok:true});assert.equal(f.writes(),1);
});
test('completion requires chronological return; proof outages and concurrent edits fail closed',async()=>{
 const noReturn=fixture({},{status:'SERVICE_IN_PROGRESS'});await assert.rejects(()=>noReturn.call('COMPLETED'),e=>e.message==='return_required');
 const returned=fixture({handover_data:{generation_context:{catalog_item_id:item},handover_confirmation:fact,return_confirmation:{...fact,occurred_at:'2026-10-02T00:00:00Z'}}},{status:'SERVICE_IN_PROGRESS'});assert.equal((await returned.call('COMPLETED')).ok,true);
 const issue=fixture({handover_data:{generation_context:{catalog_item_id:item},handover_confirmation:fact,return_confirmation:fact}},{status:'SERVICE_IN_PROGRESS',issue:'OPEN'});await assert.rejects(()=>issue.call('COMPLETED'),e=>e.message==='execution_issue_unresolved');
 const outage=fixture({},{failed:true});await assert.rejects(()=>outage.call(),e=>e.status===503);assert.equal(outage.writes(),0);
 await assert.rejects(()=>fixture({},{concurrent:true}).call(),e=>e.message==='rental_status_changed');
});
