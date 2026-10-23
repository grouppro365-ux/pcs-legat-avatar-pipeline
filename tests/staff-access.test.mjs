import test from 'node:test';import assert from 'node:assert/strict';
import {authorizeStaff,staffTeam,staffWorkflowDb,redactStaffWorkflow} from '../server/supabase/pcs-manager-live2/staff-access.mjs';
const id='00000000-0000-4000-8000-000000000001';
const req=(op,method='GET',b)=>new Request('https://test/?op='+op,{method,headers:{authorization:'Bearer managed'},...(b?{body:JSON.stringify(b)}:{})});
const verify=async()=>({sub:id,role:'OWNER'});
const db=permissions=>({query:async()=>[{context:{user_id:id,permissions,roles:['TEST']}}]});
test('staff ignores JWT roles; uses current global PCS permissions and denies unknown/admin endpoints',async()=>{
 await assert.rejects(()=>authorizeStaff(req('staff-team'),db(['*']),verify,'staff-team'),e=>e.status===403);
 await assert.rejects(()=>authorizeStaff(req('catalog'),db(['catalog.view']),verify,'catalog'),e=>e.status===403);
 await assert.rejects(()=>authorizeStaff(req('workflow-action','POST'),{query:async()=>[{context:null}]},verify,'workflow-action'),e=>e.status===403);
 assert.equal((await authorizeStaff(req('audit'),db(['audit.view']),verify,'audit')).auth_user_id,id);
 await assert.rejects(()=>authorizeStaff(req('audit','POST'),db(['audit.view']),verify,'audit'),e=>e.status===405);
 await assert.rejects(()=>authorizeStaff(req('audit'),db(['*']),async()=>{throw Error('invalid')},'audit'),e=>e.status===401);
});
test('team cannot create owners, accept caller permissions, or silently coerce active values',async()=>{
 for(const b of [{auth_user_id:id,role:'OWNER',active:true},{auth_user_id:id,role:'OPS_ADMIN',active:'true'},{auth_user_id:id,role:'OPS_ADMIN',active:true,permissions:['*']}])await assert.rejects(()=>staffTeam(req('staff-team','POST',b),{query:()=>assert.fail('invalid write')}),e=>e.status===400);
});
test('staff workflow delegates with verified identity and redacts finance/access per actual permissions',async()=>{
 let params;const wrapped=staffWorkflowDb({query:async(q,p)=>{assert.match(q,/staff_workflow_action/);params=p;return [{result:{ok:true}}]}},{auth_user_id:id});
 await wrapped.query('select pcs.portal_admin_action($1,$2::jsonb) result',['review-offer','{}']);assert.deepEqual(params,[id,'review-offer','{}']);
 await assert.rejects(()=>wrapped.query('select * from secrets',[]));
 const r=redactStaffWorkflow({pagination:{offers:{page:1},payments:{page:5,has_more:true}},application:{payment_balance:{verified_amount:'1000'}},payments:[1],instructions:{secret:1},access:[1]},{permissions:['applications.view']});assert.deepEqual(r.payments,[]);assert.equal(r.instructions,null);assert.equal(r.application.payment_balance,undefined);assert.equal(r.pagination.payments,undefined);assert.equal(r.pagination.offers.page,1);assert.deepEqual(r.access,[]);
});

test('attachments and source qualification or follow-up enforce current scoped permissions',async()=>{await assert.rejects(()=>authorizeStaff(req('runtime-attachment'),db(['applications.view']),verify,'runtime-attachment'),e=>e.status===403);assert.equal((await authorizeStaff(req('runtime-attachment'),db(['clients.manage']),verify,'runtime-attachment')).auth_user_id,id);for(const op of ['application-client-followup','request-source-qualification']){for(const permissions of [['clients.manage'],['applications.assign']])await assert.rejects(()=>authorizeStaff(req(op,'POST'),db(permissions),verify,op),e=>e.status===403);assert.equal((await authorizeStaff(req(op,'POST'),db(['clients.manage','applications.assign']),verify,op)).auth_user_id,id);await assert.rejects(()=>authorizeStaff(req(op),db(['*']),verify,op),e=>e.status===405);}});
