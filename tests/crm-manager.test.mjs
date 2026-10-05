import * as operations from '../server/supabase/pcs-manager-live2/operations-read.mjs';
import * as prospectWorker from '../server/supabase/pcs-manager-live2/prospect-worker.mjs';
import * as prospect from '../server/supabase/pcs-manager-live2/prospect-engine.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import * as policy from '../server/supabase/pcs-manager-live2/crm-policy.mjs';
import * as search from '../server/supabase/pcs-manager-live2/search-policy.mjs';
import * as finance from '../server/supabase/pcs-manager-live2/finance-read.mjs';
import * as taskEdit from '../server/supabase/pcs-manager-live2/task-edit.mjs';
import * as deliveryReview from '../server/supabase/pcs-manager-live2/delivery-review.mjs';
import * as monitor from '../server/supabase/pcs-manager-live2/error-monitor.mjs';
import * as approvals from '../server/supabase/pcs-manager-live2/approval-policy.mjs';
import * as delivery from '../server/supabase/pcs-manager-live2/manual-send.mjs';
import * as login from '../server/supabase/pcs-manager-live2/login-policy.mjs';
const cid='cmcontact1',secret='unit-test-only';
async function fixture({taskRows,applicationRows}={}){
 let handler;const writes=[],reads=[];
 const sql=async(strings,...params)=>{
  const q=strings.join('?');reads.push({q,params});if(q.startsWith('update applications')){writes.push({q,p:params});return []}if(q.includes('from applications'))return applicationRows||[];if(q.includes('from contacts'))return[{id:cid,edit_version:'2026-10-03 00:00:00',status:'NEW',priority:'NORMAL'}];
  if(q.includes('from tasks'))return taskRows||[{id:'task1',contact_id:cid,title:'Real task'}];return[];
 };sql.query=async(q,p)=>{writes.push({q,p});return[{id:cid,edit_version:'2026-10-03 01:00:00'}]};
 const context={...policy,...login,...delivery,...approvals,...monitor,...search,...finance,...taskEdit,...deliveryReview,...prospect,...prospectWorker,...operations,neon:()=>sql,crypto:globalThis.crypto,TextEncoder,TextDecoder,URL,Request,Response,Date,atob,btoa,fetch:async()=>Response.json({neon_database_url:'test',business_neon_database_url:'test',edge_session_secret:secret}),Deno:{env:{get:()=> 'test'},serve:fn=>{handler=fn}}};
 vm.runInNewContext(stripTypeScriptTypes(readFileSync(new URL('../server/supabase/pcs-manager-live2/index.ts',import.meta.url),'utf8')).replace(/^import .*;\n/gm,''),context);
 const b64=s=>Buffer.from(s).toString('base64url'),data=b64(JSON.stringify({role:'admin',exp:Date.now()+60000}));
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const token=data+'.'+Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(data))).toString('base64url');
 return{writes,reads,call:async(op,{method='POST',body={},auth=token}={})=>handler(new Request('https://test.invalid?op='+op+'&id='+cid,{method,headers:auth?{authorization:'Bearer '+auth}:{},body:method==='GET'?undefined:JSON.stringify(body)}))};
}
test('all new mutations require a valid admin token before any write',async()=>{
 const f=await fixture();for(const op of ['client-save','task-create','task-complete','send','approval-action'])for(const auth of ['', 'forged.token'])assert.equal((await f.call(op,{auth})).status,401);assert.equal(f.writes.length,0);
});
test('client detail returns tasks from the same operational database',async()=>{
 const f=await fixture(),r=await f.call('client',{method:'GET'});assert.equal(r.status,200);assert.equal((await r.json()).tasks[0].contact_id,cid);
});
test('manager binds contact mutation to route identity and rejects unsupported fields and methods',async()=>{
 const f=await fixture();assert.equal((await f.call('client-save',{method:'GET'})).status,405);
 assert.equal((await f.call('client-save',{body:{expected_version:'2026-10-03 00:00:00',id:'other',name:'X'}})).status,400);assert.equal(f.writes.length,0);
 assert.equal((await f.call('client-save',{body:{expected_version:'2026-10-03 00:00:00',name:'X'}})).status,200);assert.equal(f.writes[0].p[1],cid);
});

test('long conversations select the newest bounded window before rendering chronological history',async()=>{
 const f=await fixture();await f.call('client',{method:'GET'});
 const q=f.reads.find(x=>x.q.includes('from messages m join conversations'));
 assert.ok(q);assert.equal(q.params[0],cid);
 assert.match(q.q,/order by coalesce\(m.sent_at,m.created_at\) desc,m.id desc limit 1000\) recent order by coalesce\(recent.sent_at,recent.created_at\) asc,recent.id asc/);
});

test('task queue is authenticated, read-only, and validates its filter',async()=>{
 const f=await fixture();
 assert.equal((await f.call('tasks',{method:'GET',auth:''})).status,401);
 assert.equal((await f.call('tasks',{method:'POST'})).status,405);
 assert.equal((await f.call('tasks&view=unknown',{method:'GET'})).status,400);
 for(const view of ['open','overdue','undated']){
  const r=await f.call('tasks&view='+view,{method:'GET'});assert.equal(r.status,200);assert.equal((await r.json()).view,view);
 }
 assert.equal((await f.call('tasks&page=-1',{method:'GET'})).status,400);
 assert.equal((await f.call('tasks&page=5001',{method:'GET'})).status,400);
 assert.equal((await f.call('tasks&page=1junk',{method:'GET'})).status,400);
 assert.equal(f.writes.length,0);
 const q=f.reads.find(x=>x.q.includes('from tasks t'));assert.ok(q);
 assert.match(q.q,/t.completed_at is null/);assert.match(q.q,/join contacts c on c.id=t.contact_id/);
 assert.match(q.q,/limit 201/);assert.match(q.q,/t.due_at asc nulls last/);
 assert.doesNotMatch(q.q,/select \*/);
});
test('task queue bounds its response and reports truncation honestly',async()=>{
 const rows=Array.from({length:201},(_,i)=>({id:'task'+i,contact_id:cid,title:'Task'}));
 const f=await fixture({taskRows:rows}),r=await f.call('tasks',{method:'GET'}),d=await r.json();
 assert.equal(d.tasks.length,200);assert.equal(d.truncated,true);assert.equal(d.limit,200);
});

test('task queue pagination remains parameterized and does not claim a total',async()=>{
 const f=await fixture(),r=await f.call('tasks&page=2',{method:'GET'}),d=await r.json();
 assert.equal(r.status,200);assert.equal(d.page,2);assert.equal(d.total,undefined);
 const q=f.reads.find(x=>x.q.includes('from tasks t'));assert.equal(q.params.at(-1),400);assert.match(q.q,/offset \?/);
});

const applicationId='11111111-1111-4111-8111-111111111111';
test('generic booking routes cannot forge handover or return',async()=>{
 const f=await fixture({applicationRows:[{id:applicationId,category:'booking',operational_status:'CONFIRMED'}]});
 for(const status of ['SERVICE_IN_PROGRESS','COMPLETED']){
  assert.equal((await f.call('application-status',{body:{id:applicationId,status}})).status,409);
  assert.equal((await f.call('application-save',{body:{id:applicationId,category:'booking',operational_status:status}})).status,409);
  assert.equal((await f.call('application-save',{body:{category:'booking',operational_status:status}})).status,409);
 }
 assert.equal(f.writes.length,0);
});
test('existing active, completed and cancelled bookings cannot be edited, reclassified or reversed',async()=>{
 for(const operational_status of ['SERVICE_IN_PROGRESS','COMPLETED','CANCELLED_BY_CLIENT','CANCELLED_BY_PARTNER']){
  const f=await fixture({applicationRows:[{id:applicationId,category:'booking',operational_status}]});
  assert.equal((await f.call('application-save',{body:{id:applicationId,category:'general',operational_status:'NEW'}})).status,409);
  assert.equal((await f.call('application-status',{body:{id:applicationId,status:'NEW'}})).status,409);
  assert.equal(f.writes.length,0);
 }
});
test('booking changes racing with handover cannot report a successful generic update',async()=>{
 const f=await fixture({applicationRows:[{id:applicationId,category:'booking',operational_status:'CONFIRMED'}]});
 const r=await f.call('application-save',{body:{id:applicationId,category:'booking',operational_status:'CONFIRMED'}});
 assert.equal(r.status,409);assert.match(f.writes[0].q,/operational_status not in \('SERVICE_IN_PROGRESS','COMPLETED','CANCELLED_BY_CLIENT','CANCELLED_BY_PARTNER'\)/);
});
test('missing bookings do not produce success and ordinary non-booking flows keep their status route',async()=>{
 const f=await fixture();assert.equal((await f.call('application-status',{body:{id:applicationId,status:'NEW'}})).status,404);
 const g=await fixture({applicationRows:[{id:applicationId,category:'general',operational_status:'NEW'}]});
 assert.equal((await g.call('application-status',{body:{id:applicationId,status:'SERVICE_IN_PROGRESS'}})).status,409);
 assert.equal(g.writes.length,1,'non-booking status reaches conditional SQL, which returned no updated row in this fixture');
});

test('generic booking save retains its category when omitted and rejects invented booking states',async()=>{
 const f=await fixture({applicationRows:[{id:applicationId,category:'booking',operational_status:'CONFIRMED'}]});
 assert.equal((await f.call('application-save',{body:{id:applicationId,operational_status:'CONFIRMED'}})).status,409);
 assert.ok(f.writes[0].p.includes('booking'));
 assert.equal((await f.call('application-status',{body:{id:applicationId,status:'FAKE'}})).status,400);
 assert.equal(f.writes.length,1);
});

test('approval queue reads narrow source context with validated server pagination',async()=>{
 const f=await fixture();assert.equal((await f.call('approvals&page=-1',{method:'GET'})).status,400);
 assert.equal((await f.call('approvals&page=2',{method:'GET'})).status,200);
 const q=f.reads.find(x=>x.q.includes('from ai_generations'));assert.ok(q);assert.match(q.q,/m.text source_text/);assert.match(q.q,/updated_at::text edit_version/);assert.match(q.q,/limit 200 offset/);assert.equal(q.params.at(-1),400);assert.doesNotMatch(q.q,/g.\*/);
});

test('error reads require admin auth and cannot be used as write routes',async()=>{
 const f=await fixture();assert.equal((await f.call('errors',{method:'GET',auth:''})).status,401);assert.equal((await f.call('errors',{method:'POST'})).status,405);assert.equal(f.writes.length,0);
});

test('global search is admin-only and rejects mutation requests before reading search sources',async()=>{
 const f=await fixture();assert.equal((await f.call('search',{auth:'',method:'GET'})).status,401);assert.equal((await f.call('search',{method:'POST'})).status,405);assert.equal(f.writes.length,0);
});

test('finance and task editing reject unauthenticated and unsupported requests before source access',async()=>{
 const f=await fixture();for(const op of ['finance','finance-balance','task','task-update'])assert.equal((await f.call(op,{method:'GET',auth:''})).status,401);
 for(const [op,method] of [['finance','POST'],['finance-balance','POST'],['task','POST'],['task-update','GET']])assert.equal((await f.call(op,{method})).status,405);assert.equal(f.writes.length,0);
});

test('manual delivery review requires admin POST before changing a receipt',async()=>{const f=await fixture();assert.equal((await f.call('delivery-review',{auth:''})).status,401);assert.equal((await f.call('delivery-review',{method:'GET'})).status,405);assert.equal(f.writes.length,0)});

test('prospecting sources, scanning and reads require admin auth and correct methods',async()=>{
 const f=await fixture();for(const op of ['prospecting','prospecting-source','prospecting-scan','prospecting-classify-review','prospecting-settings'])assert.equal((await f.call(op,{method:'GET',auth:''})).status,401);
 for(const [op,method] of [['prospecting','POST'],['prospecting-source','GET'],['prospecting-scan','GET'],['prospecting-classify-review','GET'],['prospecting-settings','GET']])assert.equal((await f.call(op,{method})).status,405);
 assert.equal(f.writes.length,0);
});

test('internal scanner rejects anonymous access and wrong methods before any database write',async()=>{const f=await fixture();assert.equal((await f.call('prospecting-worker',{auth:''})).status,401);assert.equal((await f.call('prospecting-worker',{auth:'',method:'GET'})).status,405);assert.equal(f.writes.length,0);});

test('operational overview and notification/application reads are admin-only and GET-only',async()=>{const f=await fixture();for(const op of ['dashboard','notifications','operational-application']){assert.equal((await f.call(op,{method:'GET',auth:''})).status,401);assert.equal((await f.call(op,{method:'POST'})).status,405);}assert.equal(f.writes.length,0);});
