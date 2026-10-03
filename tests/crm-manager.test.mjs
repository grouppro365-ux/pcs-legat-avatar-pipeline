import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import * as policy from '../server/supabase/pcs-manager-live2/crm-policy.mjs';
import * as login from '../server/supabase/pcs-manager-live2/login-policy.mjs';
const cid='cmcontact1',secret='unit-test-only';
async function fixture(){
 let handler;const writes=[];
 const sql=async(strings,...params)=>{
  const q=strings.join('?');if(q.includes('from contacts'))return[{id:cid,edit_version:'2026-10-03 00:00:00',status:'NEW',priority:'NORMAL'}];
  if(q.includes('from tasks'))return[{id:'task1',contact_id:cid,title:'Real task'}];return[];
 };sql.query=async(q,p)=>{writes.push({q,p});return[{id:cid,edit_version:'2026-10-03 01:00:00'}]};
 const context={...policy,...login,neon:()=>sql,crypto:globalThis.crypto,TextEncoder,TextDecoder,URL,Request,Response,Date,atob,btoa,fetch:async()=>Response.json({neon_database_url:'test',business_neon_database_url:'test',edge_session_secret:secret}),Deno:{env:{get:()=> 'test'},serve:fn=>{handler=fn}}};
 vm.runInNewContext(stripTypeScriptTypes(readFileSync(new URL('../server/supabase/pcs-manager-live2/index.ts',import.meta.url),'utf8')).replace(/^import .*;\n/gm,''),context);
 const b64=s=>Buffer.from(s).toString('base64url'),data=b64(JSON.stringify({role:'admin',exp:Date.now()+60000}));
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const token=data+'.'+Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(data))).toString('base64url');
 return{writes,call:async(op,{method='POST',body={},auth=token}={})=>handler(new Request('https://test.invalid?op='+op+'&id='+cid,{method,headers:auth?{authorization:'Bearer '+auth}:{},body:method==='GET'?undefined:JSON.stringify(body)}))};
}
test('all new mutations require a valid admin token before any write',async()=>{
 const f=await fixture();for(const op of ['client-save','task-create','task-complete'])for(const auth of ['', 'forged.token'])assert.equal((await f.call(op,{auth})).status,401);assert.equal(f.writes.length,0);
});
test('client detail returns tasks from the same operational database',async()=>{
 const f=await fixture(),r=await f.call('client',{method:'GET'});assert.equal(r.status,200);assert.equal((await r.json()).tasks[0].contact_id,cid);
});
test('manager binds contact mutation to route identity and rejects unsupported fields and methods',async()=>{
 const f=await fixture();assert.equal((await f.call('client-save',{method:'GET'})).status,405);
 assert.equal((await f.call('client-save',{body:{expected_version:'2026-10-03 00:00:00',id:'other',name:'X'}})).status,400);assert.equal(f.writes.length,0);
 assert.equal((await f.call('client-save',{body:{expected_version:'2026-10-03 00:00:00',name:'X'}})).status,200);assert.equal(f.writes[0].p[1],cid);
});
