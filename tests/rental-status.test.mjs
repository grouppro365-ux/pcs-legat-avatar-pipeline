import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {confirmationRequest,handoverInput} from '../server/supabase/pcs-contract-api/confirmation-policy.mjs';
import {carryVersionFields} from '../server/supabase/pcs-contract-api/version-policy.mjs';

function fixture({handover=true,returned=false,newer=false,phase='CONFIRMED',failRpc=false,failManager=false}={}){
 let handler,writes=[],rpcs=[],fail=failRpc;
 const contract={id:'aaaa',reservation_id:'bbbb',version:1,status:'ready_to_sign',handover_data:{...(handover?{handover_confirmation:{occurred_at:'2026-10-01T00:00:00Z'}}:{}),...(returned?{return_confirmation:{occurred_at:'2026-10-02T00:00:00Z'}}:{})}};
 const db={from:table=>{
  const q={select(){return this},eq(){return this},gt(){return this},not(){return this},limit(){return this},single(){return this},maybeSingle(){return this},then(resolve){resolve({data:table==='pcs_sessions'?{token_hash:'test'}:table==='pcs_reservations'?{source:'neon_contract_projection',status:'confirmed'}:this.isNewer?(newer?[{id:'cccc'}]:[]):contract,error:null})}};
  q.gt=function(){this.isNewer=true;return this};return q;
 },rpc:async(name,args)=>{rpcs.push({name,args});if(fail){fail=false;return{error:{message:'temporary_storage_error'}}}return{data:{reservation_id:'bbbb',status:args.p_status}}}};
 const context={confirmationRequest,handoverInput,carryVersionFields,createClient:()=>db,crypto:globalThis.crypto,TextEncoder,URL,Request,Response,Date,fetch:async(url,opts)=>{
  const op=new URL(url).searchParams.get('op');
  if(op==='application-detail')return Response.json({category:'booking',operational_status:phase});
  if(op==='application-rental-phase'){const b=JSON.parse(opts.body);writes.push(b);if(failManager||b.expected_status!==phase)return Response.json({error:'conflict'},{status:409});phase=b.status;return Response.json({ok:true})}
  throw Error('Unexpected external call');
 },Deno:{env:{get:key=>key==='SUPABASE_URL'?'https://test.invalid':'test'},serve:fn=>{handler=fn}}};
 const source=stripTypeScriptTypes(readFileSync(new URL('../server/supabase/pcs-contract-api/index.ts',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
 vm.runInNewContext(source,context);
 return{writes,rpcs,call:async(status,confirmed=true)=>handler(new Request('https://test.invalid/pcs-contract-api/contracts/aaaa/rental-status',{method:'POST',headers:{authorization:'Bearer test','content-type':'application/json'},body:JSON.stringify({status,confirmed})})),phase:()=>phase};
}
test('handover advances the actual booking and records the projection/audit',async()=>{
 const f=fixture();const r=await f.call('active');assert.equal(r.status,200);assert.equal(f.phase(),'SERVICE_IN_PROGRESS');assert.equal(f.writes.length,1);assert.equal(f.rpcs[0].name,'pcs_record_rental_phase');
});
test('missing checkbox, handover, return, stale version and completed reversal never write',async()=>{
 for(const [options,status,confirmed] of [[{},'active',false],[{handover:false},'active',true],[{},'completed',true],[{newer:true},'active',true],[{phase:'COMPLETED'},'active',true]]){
  const f=fixture(options);assert.ok((await f.call(status,confirmed)).status>=400);assert.equal(f.writes.length,0);assert.equal(f.rpcs.length,0);
 }
});
test('a historical returned rental advances through both guarded booking phases',async()=>{
 const f=fixture({returned:true});assert.equal((await f.call('completed')).status,200);assert.equal(f.phase(),'COMPLETED');assert.deepEqual(f.writes.map(x=>x.expected_status),['CONFIRMED','SERVICE_IN_PROGRESS']);
});
test('failed local recording can be retried without repeating the remote transition',async()=>{
 const f=fixture({failRpc:true});assert.equal((await f.call('active')).status,500);assert.equal((await f.call('active')).status,200);assert.equal(f.writes.length,1);assert.equal(f.rpcs.length,2);
});
test('a concurrent manager status conflict cannot write a success audit',async()=>{
 const f=fixture({failManager:true});assert.equal((await f.call('active')).status,409);assert.equal(f.rpcs.length,0);
});
