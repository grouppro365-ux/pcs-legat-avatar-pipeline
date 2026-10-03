import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import * as policy from '../server/supabase/pcs-contract-files/document-policy.mjs';
function fixture(contract){
 let handler,updates=[],events=[],uploads=[],filters=[];
 const db={from:table=>{
  let update;
  const query={select:()=>query,eq:(key,value)=>{filters.push([key,value]);return query},is:(key,value)=>{filters.push([key,value]);return query},single:async()=>({data:update?{id:contract.id,...update}:contract,error:null}),update:body=>{updates.push(body);update=body;return query},insert:async body=>{events.push(body);return{error:null}}};
  return query;
 },storage:{from:()=>({upload:async(path,data,opt)=>{uploads.push({path,size:data.length,opt});return{error:null}}})}};
 const context={...policy,createClient:()=>db,Request,Response,URL,TextEncoder,TextDecoder,Uint8Array,atob,btoa,AbortSignal,Date,crypto:webcrypto,fetch:async()=>new Response('{"ok":true}',{status:200}),Deno:{env:{get:name=>name==='SUPABASE_URL'?'https://example.test':'test-only'},serve:f=>{handler=f}}};
 const source=stripTypeScriptTypes(readFileSync(new URL('../server/supabase/pcs-contract-files/index.ts',import.meta.url),'utf8')).replace(/^import .*$/mg,'');vm.runInNewContext(source,context);
 const send=()=>handler(new Request('https://example.test/functions/v1/pcs-contract-files',{method:'POST',headers:{authorization:'Bearer test-only','content-type':'application/json'},body:JSON.stringify({contract_id:contract.id,mime:'image/jpeg',filename:'signed.jpg',base64:'YWJj'})}));
 return{send,updates,events,uploads,filters};
}
const base={id:'11111111-1111-4111-8111-111111111111',reservation_id:'22222222-2222-4222-8222-222222222222',version:2,signed_copy_path:null};
test('scan attached after attestation preserves original signing date and retains evidence',async()=>{
 const f=fixture({...base,status:'signed',signed_at:'2026-10-01T09:30:00Z',handover_data:{signature_confirmation:{method:'operator_attestation'}}});
 assert.equal((await f.send()).status,200);assert.equal(f.updates[0].signed_at,'2026-10-01T09:30:00Z');assert.equal(f.updates[0].status,'signed');assert.equal(f.events[0].event_type,'signed_copy_uploaded');assert.ok(f.filters.some(([key,value])=>key==='signed_copy_path'&&value===null));assert.equal(f.uploads.length,1);
});
test('signed contract without manual attestation cannot receive a second signing operation',async()=>{
 const f=fixture({...base,status:'signed',handover_data:{}});assert.equal((await f.send()).status,409);assert.equal(f.updates.length,0);assert.equal(f.uploads.length,0);
});
test('existing signed copy cannot be overwritten',async()=>{
 const f=fixture({...base,status:'signed',signed_copy_path:'private/existing.jpg',handover_data:{signature_confirmation:{method:'operator_attestation'}}});assert.equal((await f.send()).status,409);assert.equal(f.uploads.length,0);
});
