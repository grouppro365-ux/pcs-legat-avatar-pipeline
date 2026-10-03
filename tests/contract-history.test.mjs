import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
function ui(){
 const sheets=[],toasts=[],requests=[];
 const window={contractCall:async path=>{requests.push(path);return{versions:[],events:[]}},openSheet:(...args)=>sheets.push(args),toast:s=>toasts.push(s)};
 vm.runInNewContext(read('../pcs-ai-operator-v6/contract-history.js'),{window,Date});
 return{api:window.pcsContractHistory,window,sheets,toasts,requests};
}
test('history renders version, actual time and recorded time while escaping notes and names',()=>{
 const f=ui();const html=f.api.render({versions:[{id:'aaaa',version:2,status:'signed',created_at:'2026-10-01T10:00:00Z',has_signed_copy:true}],events:[{contract_id:'aaaa',event_type:'vehicle_return_confirmed',created_at:'2026-10-03T10:00:00Z',payload:{occurred_at:'2026-10-02T10:00:00Z',operator_name:'<admin>',note:'<img onerror=alert(1)>'}}]},'bbbb');
 assert.match(html,/Версия 2/);assert.match(html,/Фактическая дата/);assert.match(html,/Записано/);assert.match(html,/&lt;admin&gt;/);assert.doesNotMatch(html,/<img|onerror="/);assert.match(html,/Скачать PDF/);
});
test('drafts have no PDF action and malformed IDs cannot inject actions',()=>{
 const html=ui().api.render({versions:[{id:"a');alert(1)//",version:1,status:'draft'}],events:[]},"b');alert(1)//");
 assert.doesNotMatch(html,/onclick|Скачать PDF/);
});
test('opening history reads only; errors allow retry without false empty history',async()=>{
 const f=ui();await f.api.open('bbbb');assert.equal(f.requests[0],'/reservations/bbbb/contracts/history');assert.equal(f.sheets.length,1);
 f.window.contractCall=async()=>{throw Error('unavailable')};await f.api.open('bbbb');assert.equal(f.sheets.length,1);assert.match(f.toasts[0],/Не удалось загрузить/);
});
function server({auth=true,empty=false,eventFailure=false}={}){
 let handler;const queries=[];
 const db={from:table=>{
  const trace={table};queries.push(trace);
  const q={select(s){trace.select=s;return this},eq(k,v){trace.eq=[k,v];return this},gt(){return this},in(k,v){trace.in=[k,v];return this},order(){return this},limit(n){trace.limit=n;return this},maybeSingle(){return this},then(resolve){
   if(table==='pcs_sessions')return resolve({data:auth?{token_hash:'qa'}:null});
   if(table==='pcs_contracts')return resolve({data:empty?[]:[{id:'aaaa',reservation_id:'bbbb',version:1,status:'signed',signed_copy_path:'PRIVATE/PATH',handover_data:{generation_context:{client_contact:'PRIVATE-CONTACT'}}}]});
   return resolve(eventFailure?{error:{message:'storage_unavailable'}}:{data:[{id:'eeee',contract_id:'aaaa',event_type:'vehicle_handover_confirmed',created_at:'2026-10-01T00:00:00Z',actor:'PRIVATE-ACTOR',payload:{operator_name:'QA',note:'Synthetic test',id_or_passport:'PRIVATE-PASSPORT',actor:'PRIVATE-ACTOR',status:'active'}}]});
  }};return q;
 }};
 const source=stripTypeScriptTypes(read('../server/supabase/pcs-contract-api/index.ts')).replace(/^import .*;\n/gm,'');
 vm.runInNewContext(source,{createClient:()=>db,crypto:globalThis.crypto,TextEncoder,URL,Request,Response,Date,fetch:async()=>Response.json({ok:false}),Deno:{env:{get:()=> 'https://test.invalid'},serve:fn=>{handler=fn}}});
 return{queries,call:()=>handler(new Request('https://test.invalid/pcs-contract-api/reservations/bbbb/contracts/history',{headers:auth?{authorization:'Bearer qa'}:{}}))};
}
test('API bounds history and strips private paths, actor identifiers and unrelated payload fields',async()=>{
 const f=server(),r=await f.call();assert.equal(r.status,200);const body=await r.text();assert.doesNotMatch(body,/PRIVATE-/);assert.doesNotMatch(body,/PRIVATE\/PATH/);
 const eventQuery=f.queries.find(q=>q.table==='pcs_contract_events');assert.deepEqual(eventQuery.in[1],['aaaa']);assert.equal(eventQuery.limit,201);
 assert.equal(f.queries.find(q=>q.table==='pcs_contracts').limit,51);
});
test('empty contract list makes no event query and unauthenticated history returns 401',async()=>{
 const f=server({empty:true});assert.equal((await f.call()).status,200);assert.equal(f.queries.some(q=>q.table==='pcs_contract_events'),false);
 const unauth=server({auth:false});assert.equal((await unauth.call()).status,401);assert.equal(unauth.queries.length,0);
});
test('event storage failure returns an error rather than an empty successful journal',async()=>{
 assert.equal((await server({eventFailure:true}).call()).status,500);
});
