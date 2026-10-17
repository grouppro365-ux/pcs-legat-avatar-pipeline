import test from 'node:test';import assert from 'node:assert/strict';
import {authorizeStaff} from '../server/supabase/pcs-manager-live2/staff-access.mjs';
const id='00000000-0000-4000-8000-000000000001';
const staff=permissions=>({query:async()=>[{context:{permissions}}]});
const request=method=>new Request('https://test/',{method});
test('qualification read permissions never imply write permissions',async()=>{
 const read=staff(['applications.view','clients.manage']);assert.equal((await authorizeStaff(request('GET'),read,async()=>({sub:id}),'request-qualification')).auth_user_id,id);
 await assert.rejects(()=>authorizeStaff(request('POST'),read,async()=>({sub:id}),'request-qualification'),e=>e.status===403);
 assert.equal((await authorizeStaff(request('POST'),staff(['applications.assign','clients.manage']),async()=>({sub:id}),'request-qualification')).auth_user_id,id);
});
test('content route checks current staff, method and read permission before action module applies exact write authority',async()=>{
 await assert.rejects(()=>authorizeStaff(request('GET'),staff(['audit.view']),async()=>({sub:id}),'content-workflow'),e=>e.status===403);
 await assert.rejects(()=>authorizeStaff(request('GET'),staff(['*']),async()=>({sub:id}),'content-action'),e=>e.status===405);
 await assert.rejects(()=>authorizeStaff(request('POST'),{query:async()=>[{context:null}]},async()=>({sub:id}),'content-action'),e=>e.status===403);
});
