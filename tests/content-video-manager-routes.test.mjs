import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import * as policy from '../server/supabase/pcs-manager-live2/crm-policy.mjs';
import * as staff from '../server/supabase/pcs-manager-live2/staff-access.mjs';
import * as portal from '../server/supabase/pcs-manager-live2/portal-workflow.mjs';
import * as booking from '../server/supabase/pcs-manager-live2/booking-create.mjs';
import * as delivery from '../server/supabase/pcs-manager-live2/manual-send.mjs';
import * as login from '../server/supabase/pcs-manager-live2/login-policy.mjs';
const id='11111111-1111-4111-8111-111111111111';
async function fixture(){
 let handler;const calls=[],secret='video-route-test-only';
 const biz=()=>[];biz.query=async()=>[];
 const c={...policy,...staff,...portal,...booking,...delivery,...login,crypto,TextEncoder,TextDecoder,URL,Request,Response,Date,atob,btoa,neon:()=>biz,
  verifyAccount:async()=>{throw Error('invalid_token');},
  fetch:async()=>Response.json({neon_database_url:'test',business_neon_database_url:'test',edge_session_secret:secret}),
  createClient:()=>({storage:{testStorage:true}}),verifyGithubVideoJWT:()=>{},
  readContentVideo:async(db,p)=>{calls.push(['read',p]);return {ok:true,post:{id},jobs:[{id,stage:'READY'}]};},
  actContentVideo:async(db,a,p,actor,permissions)=>{calls.push(['act',a,p,actor,permissions]);return {ok:true,job:{id}};},
  signVideoRead:async(storage,job,kind)=>{calls.push(['asset',storage,job,kind]);return {ok:true,url:'private'};},
  contentVideoWorkerRoute:async(req,options)=>{calls.push(['worker',options]);throw new policy.CrmError('bad worker identity',401);},
  Deno:{env:{get:()=> 'test'},serve:fn=>{handler=fn;}}};
 vm.runInNewContext(stripTypeScriptTypes(readFileSync(new URL('../server/supabase/pcs-manager-live2/index.ts',import.meta.url),'utf8')).replace(/^import .*;\n/gm,''),c);
 const data=Buffer.from(JSON.stringify({role:'admin',exp:Date.now()+60000})).toString('base64url');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const token=data+'.'+Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(data))).toString('base64url');
 return {calls,call:(op,{method='GET',body,auth=token}={})=>handler(new Request('https://test/?op='+op,{method,headers:auth?{authorization:'Bearer '+auth}:{},body:body?JSON.stringify(body):undefined}))};
}
test('actual manager dispatch protects staff video routes and enforces HTTP methods',async()=>{
 const f=await fixture();
 for(const op of ['content-video','content-video-action','content-video-asset']){
  for(const auth of ['', 'forged.token'])assert.equal((await f.call(op,{auth})).status,401);
 }
 assert.equal(f.calls.length,0);
 assert.equal((await f.call('content-video',{method:'POST'})).status,405);
 assert.equal((await f.call('content-video-action')).status,405);
 assert.equal((await f.call('content-video-asset',{method:'POST'})).status,405);
 assert.equal(f.calls.length,0);
 const read=await f.call('content-video&post_id='+id+'&page=2');assert.equal(read.status,200);assert.deepEqual((await read.json()).permissions,['*']);assert.equal(f.calls[0][1].post_id,id);assert.equal(f.calls[0][1].page,'2');
 const action=await f.call('content-video-action',{method:'POST',body:{action:'cancel',job_id:id}});assert.equal(action.status,200);assert.equal(f.calls[1][1],'cancel');assert.equal(f.calls[1][3],'pcs-manager-admin');
 const media=await f.call('content-video-asset&job_id='+id+'&kind=cover');assert.equal(media.status,200);assert.equal(f.calls.at(-1)[3],'cover');
});
test('worker endpoint delegates to dedicated OIDC authorization before staff auth and cannot borrow admin token',async()=>{
 const f=await fixture();assert.equal((await f.call('content-video-worker',{method:'POST',body:{action:'claim'}})).status,401);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'worker');assert.equal(f.calls[0][1].storage.testStorage,true);assert.equal(typeof f.calls[0][1].verifyJWT,'function');
});
test('staff read permissions do not imply video write or approval authority',async()=>{
 const db={query:async()=>[{context:{permissions:['audit.view']}}]};
 for(const op of ['content-video','content-video-asset'])await assert.rejects(staff.authorizeStaff(new Request('https://test/'),db,async()=>({sub:id}),op),e=>e.status===403);
 await assert.rejects(staff.authorizeStaff(new Request('https://test/'),{query:async()=>[{context:{permissions:['*']}}]},async()=>({sub:id}),'content-video-action'),e=>e.status===405);
});
