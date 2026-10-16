import test from 'node:test';import assert from 'node:assert/strict';
import {authorizePurposeRequest,purposePermissions} from '../server/supabase/pcs-manager-live2/purpose-policy.mjs';
import {authorizeStaff} from '../server/supabase/pcs-manager-live2/staff-access.mjs';
const req=(body,method='POST')=>new Request('https://test/?op=authorize-purpose',{method,...(method==='POST'?{body:JSON.stringify(body)}:{})});
test('purpose authorization fails closed for session-only auditors and unknown/caller permissions',async()=>{
 for(const purpose of Object.keys(purposePermissions))await assert.rejects(()=>authorizePurposeRequest(req({purpose}),{permissions:['audit.view']}),e=>e.status===403);
 for(const body of [{purpose:'session'},{purpose:'contracts.write',permissions:['*']},{purpose:'__proto__'}])await assert.rejects(()=>authorizePurposeRequest(req(body),{permissions:['*']}),e=>e.status===400);
 await assert.rejects(()=>authorizePurposeRequest(req({purpose:'contracts.read'}),{permissions:['applications.view']}),e=>e.status===403);
 await assert.rejects(()=>authorizePurposeRequest(req({},'GET'),null,true),e=>e.status===405);
});
test('each purpose requires all current server-resolved permissions',async()=>{
 for(const [purpose,permissions] of Object.entries(purposePermissions))assert.deepEqual(await authorizePurposeRequest(req({purpose}),{permissions}),{ok:true,purpose});
 assert.equal((await authorizePurposeRequest(req({purpose:'bot.configure'}),null,true)).ok,true);
});
test('managed introspection verifies identity and current staff context before purpose',async()=>{
 const r=req({purpose:'contracts.read'});const id='00000000-0000-4000-8000-000000000001';
 assert.equal((await authorizeStaff(r,{query:async()=>[{context:{permissions:['audit.view']}}]},async()=>({sub:id,role:'OWNER'}),'authorize-purpose')).auth_user_id,id);
 await assert.rejects(()=>authorizeStaff(r,{query:async()=>[{context:null}]},async()=>({sub:id}),'authorize-purpose'),e=>e.status===403);
});
