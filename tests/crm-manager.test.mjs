import * as bookingEdit from '../server/supabase/pcs-manager-live2/booking-edit.mjs';
import * as catalogEdit from '../server/supabase/pcs-manager-live2/catalog-edit.mjs';
import * as prospectEdit from '../server/supabase/pcs-manager-live2/prospect-source-edit.mjs';
import * as bookingCreate from '../server/supabase/pcs-manager-live2/booking-create.mjs';
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
async function fixture({taskRows,applicationRows,queryResult,catalogRows}={}){
 let handler;const writes=[],reads=[],uploads=[];
 const sql=async(strings,...params)=>{
  const q=strings.join('?');reads.push({q,params});if(q.startsWith('update applications')){writes.push({q,p:params});return []}if(q.includes('from applications'))return (applicationRows||[]).map(x=>({...validBookingTerms,...x,edit_version:x.edit_version||'2026-10-09 00:00:00.123456+00'}));if(q.includes('from contacts'))return[{id:cid,edit_version:'2026-10-03 00:00:00',status:'NEW',priority:'NORMAL'}];
  if(q.includes('from tasks'))return taskRows||[{id:'task1',contact_id:cid,title:'Real task'}];return[];
 };sql.query=async(q,p)=>{if(q.startsWith('select id from catalog_items')){reads.push({q,params:p});return catalogRows||[{id:p[0]}];}writes.push({q,p});return queryResult?queryResult(q,p):q.includes("'Explicit PCS booking change'")?[]:[{id:cid,edit_version:'2026-10-03 01:00:00'}]};
 const context={...bookingEdit,...catalogEdit,...bookingCreate,...policy,...login,...delivery,...approvals,...monitor,...search,...finance,...taskEdit,...deliveryReview,...prospect,...prospectEdit,...prospectWorker,...operations,neon:()=>sql,crypto:globalThis.crypto,TextEncoder,TextDecoder,URL,Request,Response,Date,atob,btoa,fetch:async(url)=>{if(String(url).includes('/storage/'))uploads.push(url);return Response.json({neon_database_url:'test',business_neon_database_url:'test',edge_session_secret:secret})},Deno:{env:{get:()=> 'test'},serve:fn=>{handler=fn}}};
 vm.runInNewContext(stripTypeScriptTypes(readFileSync(new URL('../server/supabase/pcs-manager-live2/index.ts',import.meta.url),'utf8')).replace(/^import .*;\n/gm,''),context);
 const b64=s=>Buffer.from(s).toString('base64url'),data=b64(JSON.stringify({role:'admin',exp:Date.now()+60000}));
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const token=data+'.'+Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(data))).toString('base64url');
 return{writes,reads,uploads,call:async(op,{method='POST',body={},auth=token}={})=>handler(new Request('https://test.invalid?op='+op+'&id='+cid,{method,headers:auth?{authorization:'Bearer '+auth}:{},body:method==='GET'?undefined:JSON.stringify(body)}))};
}
test('all new mutations require a valid admin token before any write',async()=>{
 const f=await fixture();for(const op of ['client-save','task-create','task-complete','send','approval-action','notification-read','prospecting-source-update','catalog-save'])for(const auth of ['', 'forged.token'])assert.equal((await f.call(op,{auth})).status,401);assert.equal(f.writes.length,0);
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

const validBookingTerms={item_id:'22222222-2222-4222-8222-222222222222',qualification_data:{start_date:'2026-10-10',end_date:'2026-10-20'}};
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
 const r=await f.call('application-save',{body:{...validBookingTerms,id:applicationId,expected_version:'2026-10-09 00:00:00.123456+00',category:'booking',operational_status:'CONFIRMED'}});
 assert.equal(r.status,409);assert.match(f.writes[0].q,/operational_status=any\(\$6::text\[\]\)/);
});
test('missing bookings do not produce success and ordinary non-booking flows keep their status route',async()=>{
 const f=await fixture();assert.equal((await f.call('application-status',{body:{id:applicationId,status:'NEW'}})).status,404);
 const g=await fixture({applicationRows:[{id:applicationId,category:'general',operational_status:'NEW'}]});
 assert.equal((await g.call('application-status',{body:{id:applicationId,status:'SERVICE_IN_PROGRESS'}})).status,409);
 assert.equal(g.writes.length,1,'non-booking status reaches conditional SQL, which returned no updated row in this fixture');
});

test('generic booking save retains its category when omitted and rejects invented booking states',async()=>{
 const f=await fixture({applicationRows:[{id:applicationId,category:'booking',operational_status:'CONFIRMED'}]});
 assert.equal((await f.call('application-save',{body:{...validBookingTerms,id:applicationId,expected_version:'2026-10-09 00:00:00.123456+00',operational_status:'CONFIRMED'}})).status,409);
 assert.match(f.writes[0].q,/category='booking'/);
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

test('operational overview and notification/application reads are admin-only and GET-only',async()=>{const f=await fixture();for(const op of ['dashboard','notifications','operational-application','audit']){assert.equal((await f.call(op,{method:'GET',auth:''})).status,401);assert.equal((await f.call(op,{method:'POST'})).status,405);}assert.equal(f.writes.length,0);});

test('notification acknowledgement rejects GET and malformed payload before mutation',async()=>{const f=await fixture();assert.equal((await f.call('notification-read',{method:'GET'})).status,405);assert.equal((await f.call('notification-read',{body:{id:'bad',expected_version:'bad'}})).status,400);assert.equal(f.writes.length,0);});

test('new booking requests cannot bypass audited creation by omitting the request UUID',async()=>{
 const f=await fixture(),base={category:'booking',item_id:'22222222-2222-4222-8222-222222222222',operational_status:'AWAITING_PARTNER_CONFIRMATION',qualification_data:{start_date:'2026-10-10',end_date:'2026-10-20'},photo:{content_base64:'QA',filename:'qa.jpg'}};
 for(const key of [undefined,null,'', 'not-a-uuid']){
 const body={...base,...(key===undefined?{}:{request_id:key})};
 const response=await f.call('application-save',{body});assert.equal(response.status,400);assert.match((await response.json()).error,/номер запроса/);
 }
 assert.equal(f.writes.length,0);assert.equal(f.reads.length,0);
 assert.equal((await f.call('application-save',{body:base,auth:''})).status,401);
});
test('the manager routes valid booking creation through the atomic booking/audit query',async()=>{
 const f=await fixture({queryResult:(q,p)=>q.startsWith('select')?[]:[{id:p[0],public_id:p[1]}]});
 const response=await f.call('application-save',{body:{category:'booking',request_id:'33333333-3333-4333-8333-333333333333',item_id:'22222222-2222-4222-8222-222222222222',qualification_data:{start_date:'2026-10-10',end_date:'2026-10-20'}}});
 assert.equal(response.status,200);const receipt=await response.json();assert.equal(receipt.ok,true);assert.equal(receipt.replayed,false);assert.match(receipt.public_id,/^APP-/);
 const mutations=f.writes.filter(x=>!x.q.startsWith('select'));assert.equal(mutations.length,1);assert.match(mutations[0].q,/insert into audit_events/);assert.equal(mutations[0].p[0],receipt.id);
 assert.equal(f.reads.filter(x=>x.q.includes('from catalog_items')).length,1,'one catalog preflight and no generic legacy INSERT');
});

const bookingVersion='2026-10-09 00:00:00.123456+00';
test('booking mutations reject missing and stale versions before writes or uploads',async()=>{
 for(const op of ['application-save','application-status'])for(const expected_version of [undefined,null,'',bookingVersion+'0','2026-10-09T00:00:00.123Z']){
  const f=await fixture({applicationRows:[{id:applicationId,category:'booking',operational_status:'CONFIRMED',edit_version:bookingVersion}]});
  const r=await f.call(op,{body:{...validBookingTerms,id:applicationId,status:'CONFIRMED',operational_status:'CONFIRMED',expected_version,photo:{content_base64:'must-not-upload'}}});
  assert.equal(r.status,expected_version?409:400);assert.equal(f.writes.length,0);
 }
});
test('booking save and status recheck exact versions inside SQL after the initial read',async()=>{
 for(const op of ['application-save','application-status']){
  const f=await fixture({applicationRows:[{id:applicationId,category:'booking',operational_status:'CONFIRMED',edit_version:bookingVersion}]});
  const r=await f.call(op,{body:{...validBookingTerms,id:applicationId,status:'CONFIRMED',operational_status:'CONFIRMED',expected_version:bookingVersion}});
  assert.equal(r.status,409);assert.equal(f.writes.length,1);
  assert.match(f.writes[0].q,/updated_at::text=\$2/);assert.ok(f.writes[0].p.includes(bookingVersion));assert.match(f.writes[0].q,/updated_at=clock_timestamp\(\)/);
 }
});
test('booking list and detail expose the full server timestamp without JavaScript rounding',async()=>{
 for(const op of ['applications','application-detail&id='+applicationId]){
  const f=await fixture({applicationRows:[{id:applicationId,category:'booking',edit_version:bookingVersion}]});
  assert.equal((await f.call(op,{method:'GET'})).status,200);
  assert.match(f.reads.find(x=>x.q.includes('from applications')).q,/a.updated_at::text edit_version/);
 }
});

test('existing booking edits and status changes require the single audited write path',async()=>{
 for(const op of ['application-save','application-status']){
  const f=await fixture({applicationRows:[{id:applicationId,category:'booking',operational_status:'CONFIRMED',edit_version:bookingVersion}],queryResult:()=>[{id:applicationId,operational_status:'CONFIRMED',edit_version:'new-version'}]});
  assert.equal((await f.call(op,{auth:''})).status,401);
  const r=await f.call(op,{body:{...validBookingTerms,id:applicationId,status:'CONFIRMED',operational_status:'CONFIRMED',expected_version:bookingVersion}});
  assert.equal(r.status,200);assert.equal((await r.json()).edit_version,'new-version');assert.equal(f.writes.length,1);
  assert.match(f.writes[0].q,/insert into audit_events/);assert.equal(f.writes[0].p[4],op==='application-save'?'booking_updated':'booking_status_updated');
 }
});
test('manager cannot return success after a booking audit write fails',async()=>{
 const f=await fixture({applicationRows:[{id:applicationId,category:'booking',operational_status:'CONFIRMED',edit_version:bookingVersion}],queryResult:()=>{throw Error('audit failure')}});
 const r=await f.call('application-status',{body:{id:applicationId,status:'CONFIRMED',expected_version:bookingVersion}});assert.equal(r.status,500);assert.equal(f.writes.length,1);
});

test('invalid booking terms fail before photo upload or SQL mutation',async()=>{
 for(const patch of [{item_id:null},{item_id:'bad'},{qualification_data:{}},{qualification_data:{start_date:'2026-02-30',end_date:'2026-03-05'}},{qualification_data:{start_date:'2026-10-20',end_date:'2026-10-10'}},{qualification_data:{start_date:'2026-10-10',end_date:'2026-10-10'}}]){
  const f=await fixture({applicationRows:[{id:applicationId,category:'booking',operational_status:'CONFIRMED',edit_version:bookingVersion}]});
  const r=await f.call('application-save',{body:{...validBookingTerms,...patch,id:applicationId,expected_version:bookingVersion,operational_status:'CONFIRMED',photo:{content_base64:'YQ==',filename:'qa.jpg'}}});
  assert.equal(r.status,400);assert.equal(f.uploads.length,0);assert.equal(f.writes.length,0);
 }
});

test('unavailable catalog terms are refused before upload and a valid catalog reaches the audited write',async()=>{
 const applicationRows=[{id:applicationId,category:'booking',operational_status:'CONFIRMED',edit_version:bookingVersion}];
 const body={...validBookingTerms,id:applicationId,expected_version:bookingVersion,operational_status:'CONFIRMED',qualification_data:{start_date:'2026-10-11',end_date:'2026-10-20'}};
 const denied=await fixture({applicationRows,catalogRows:[]});
 const response=await denied.call('application-save',{body:{...body,photo:{content_base64:'YQ==',filename:'qa.jpg'}}});
 assert.equal(response.status,409);assert.match((await response.json()).error,/опубликованный автомобиль/);assert.equal(denied.uploads.length,0);assert.equal(denied.writes.length,0);
 const allowed=await fixture({applicationRows,catalogRows:[{id:body.item_id}],queryResult:()=>[{id:applicationId,operational_status:'AWAITING_PARTNER_CONFIRMATION',edit_version:'new-version'}]});
 assert.equal((await allowed.call('application-save',{body})).status,200);assert.equal(allowed.writes.length,1);assert.match(allowed.writes[0].q,/eligible_item as materialized/);assert.match(allowed.writes[0].q,/exists\(select 1 from eligible_item\)/);
});

test('new booking catalog refusal happens before upload and the atomic INSERT',async()=>{
 const f=await fixture({catalogRows:[],queryResult:()=>[]});
 const r=await f.call('application-save',{body:{category:'booking',request_id:'33333333-3333-4333-8333-333333333333',...validBookingTerms,photo:{content_base64:'YQ==',filename:'qa.jpg'}}});
 assert.equal(r.status,409);assert.equal(f.uploads.length,0);assert.equal(f.writes.filter(x=>!x.q.startsWith('select')).length,0);
});
