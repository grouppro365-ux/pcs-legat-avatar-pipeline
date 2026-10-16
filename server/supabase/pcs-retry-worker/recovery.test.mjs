import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {readFile} from 'node:fs/promises';
import {generationIdentity,recoverableEvent} from '../pcs-meta-webhook-v1/inbound-recovery.mjs';
const source=stripTypeScriptTypes((await readFile(new URL('./index.ts',import.meta.url),'utf8')).replace(/^import .*;\n/gm,''));
function harness(jobs,fetcher=async()=>({ok:true,json:async()=>({ok:true})})){
 const tables={pcs_failed_jobs:structuredClone(jobs),pcs_channel_events:[],pcs_booking_requests:[],pcs_booking_confirmation_outbox:[]};
 const value=(row,k)=>k.startsWith('payload->>')?row.payload?.[k.slice(10)]:k.startsWith('payload->')?row.payload?.[k.slice(9)]:row[k];
 const db={from(table){let op='select',input,filters=[],one=false,options={},orderKey=null,limitCount=Infinity,conflict='id';
  const q={select(s,o){options=o||{};return q;},update(v){op='update';input=v;return q;},
    upsert(v,o){op='upsert';input=v;conflict=o?.onConflict||'id';return q;},
    eq(k,v){filters.push(r=>value(r,k)===v);return q;},neq(k,v){filters.push(r=>value(r,k)!==v);return q;},is(k,v){filters.push(r=>(value(r,k)??null)===v);return q;},
    lt(k,v){filters.push(r=>value(r,k)<v);return q;},gt(k,v){filters.push(r=>value(r,k)>v);return q;},
    in(k,v){filters.push(r=>v.includes(value(r,k)));return q;},not(k,operator,v){filters.push(r=>(value(r,k)??null)!==v);return q;},
    order(k){orderKey=k;return q;},limit(n){limitCount=n;return q;},single(){one=true;return q;},maybeSingle(){one=true;return q;},
    then(resolve,reject){return Promise.resolve().then(()=>{
      let rows=tables[table].filter(r=>filters.every(f=>f(r)));
      if(orderKey)rows.sort((a,b)=>value(a,orderKey)<value(b,orderKey)?-1:value(a,orderKey)>value(b,orderKey)?1:0);
      rows=rows.slice(0,limitCount);
      if(op==='upsert'){
       const keys=conflict.split(',');const existing=tables[table].find(r=>keys.every(k=>r[k]===input[k]));
       if(!existing){const row={id:crypto.randomUUID(),received_at:new Date().toISOString(),...structuredClone(input)};tables[table].push(row);rows=[row];}else rows=[];
      }
      if(op==='update')rows.forEach(r=>Object.assign(r,structuredClone(input)));
      return {data:structuredClone(one?rows[0]||null:rows),count:options.count?rows.length:null,error:null};
    }).then(resolve,reject);}};return q;}};
 let clock=Date.parse('2026-10-16T00:00:00Z');
 class ClockDate extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const requests=[];
 const context=vm.createContext({createClient:()=>db,Deno:{env:{get:()=> 'https://synthetic.test'},serve(){}},console,Date:ClockDate,crypto,TextEncoder,Response,AbortSignal,AbortController,setTimeout,clearTimeout,generationIdentity,recoverableEvent,
  fetch:async(url,init)=>{requests.push({url,...init});return fetcher(url,init,tables);}});
 vm.runInContext(source,context);vm.runInContext("sec=async()=> 'synthetic-internal-secret'",context);
 return {tables,requests,tick(ms){clock+=ms;},run:job=>context.runJob(job),recover:()=>context.recoverInterruptedJobs(),bookings:()=>context.reconcileBookings('synthetic-internal-secret')};
}
const job={id:'33333333-3333-4333-8333-333333333333',status:'failed',attempts:1,operation:'meta_inbound',payload:{channel:'instagram',event_row_id:'44444444-4444-4444-8444-444444444444'}};
test('worker retries normalized inbound by internal-auth recovery, never raw provider send',async()=>{
 const h=harness([job]);assert.equal(await h.run(job),true);assert.equal(h.tables.pcs_failed_jobs[0].status,'resolved');
 assert.equal(h.requests.length,1);assert.match(h.requests[0].url,/pcs-meta-webhook-v1\?op=recover&channel=instagram$/);
 assert.equal(h.requests[0].headers['x-pcs-internal-secret'],'synthetic-internal-secret');
 assert.deepEqual(JSON.parse(h.requests[0].body),{event_row_id:job.payload.event_row_id});
});
test('unconfirmed outbound send jobs are held for review without external fetch',async()=>{
 const outbound={...job,operation:'whatsapp_send'};const h=harness([outbound]);await h.run(outbound);
 assert.equal(h.tables.pcs_failed_jobs[0].status,'review_required');assert.equal(h.requests.length,0);
});
test('expired safe retry leases requeue; expired sends require review; active leases stay owned',async()=>{
 const old='2020-01-01T00:00:00Z',now='2026-10-16T00:00:00Z';
 const h=harness([{...job,status:'retrying',last_attempt_at:old},{...job,id:'outbound',operation:'telegram_send',status:'retrying',last_attempt_at:old},
  {...job,id:'active',status:'retrying',last_attempt_at:now}]);await h.recover();
 assert.equal(h.tables.pcs_failed_jobs[0].status,'failed');assert.equal(h.tables.pcs_failed_jobs[1].status,'review_required');assert.equal(h.tables.pcs_failed_jobs[2].status,'retrying');assert.equal(h.requests.length,0);
});
test('late attempt cannot resolve a newer claimed attempt',async()=>{
 const h=harness([job],async(url,init,tables)=>{tables.pcs_failed_jobs[0].attempts=3;return {ok:true,json:async()=>({ok:true})};});
 await h.run(job);assert.equal(h.tables.pcs_failed_jobs[0].status,'retrying');assert.equal(h.tables.pcs_failed_jobs[0].attempts,3);
});

test('persisted keyset scan visits every page with a five-minute cron and five pages, then wraps',async()=>{
 const h=harness([]);
 const events=Array.from({length:200},(_,i)=>({id:(i+1).toString(16).padStart(8,'0')+'-1111-4111-8111-111111111111',
   channel:'instagram',status:'failed',received_at:'2020-01-01T00:00:00Z',payload:{rows:[{message_id:'synthetic-'+i}]}}));
 h.tables.pcs_channel_events.push(...events);
 for(let page=1;page<=5;page++){
   await h.recover();assert.equal(h.tables.pcs_failed_jobs.length,page*40);
   h.tick(5*60*1000);
 }
 assert.equal(new Set(h.tables.pcs_failed_jobs.map(j=>j.payload.event_row_id)).size,200);
 await h.recover();
 const cursor=h.tables.pcs_channel_events.find(e=>e.channel==='internal');assert.equal(cursor.payload.after_id,null);
 await h.recover();assert.equal(h.tables.pcs_failed_jobs.length,200);assert.equal(cursor.payload.after_id,events[39].id);
});
test('concurrent scanners share the same keyset page idempotently and advance without skipping',async()=>{
 const h=harness([]);
 const events=Array.from({length:80},(_,i)=>({id:(i+1).toString(16).padStart(8,'0')+'-1111-4111-8111-111111111111',
  channel:'instagram',status:'failed',received_at:'2020-01-01T00:00:00Z',payload:{rows:[{message_id:'synthetic-'+i}]}}));
 h.tables.pcs_channel_events.push(...events);
 await Promise.all([h.recover(),h.recover()]);assert.equal(h.tables.pcs_failed_jobs.length,40);
 assert.equal(h.tables.pcs_channel_events.find(e=>e.channel==='internal').payload.after_id,events[39].id);
 await h.recover();assert.equal(h.tables.pcs_failed_jobs.length,80);
 assert.equal(new Set(h.tables.pcs_failed_jobs.map(j=>j.payload.event_row_id)).size,80);
});

test('booking keyset visits five pages on a five-minute cron and keeps unsent notification union',async()=>{
 const h=harness([]);
 const bookings=Array.from({length:25},(_,i)=>({id:(i+1).toString(16).padStart(8,'0')+'-2222-4222-8222-222222222222',status:'ready_for_booking'}));
 h.tables.pcs_booking_requests.push(...bookings);
 const notificationOnly='ffffffff-2222-4222-8222-222222222222';
 h.tables.pcs_booking_confirmation_outbox.push({request_id:bookings[0].id,status:'pending',updated_at:'2020-01-01'},
  {request_id:notificationOnly,status:'pending',updated_at:'2020-01-01'});
 for(let page=0;page<5;page++){
   const before=h.requests.length;await h.bookings();
   const ids=h.requests.slice(before).map(r=>JSON.parse(r.body).request_id);
   for(const expected of bookings.slice(page*5,page*5+5))assert.ok(ids.includes(expected.id));
   assert.ok(ids.includes(bookings[0].id));assert.ok(ids.includes(notificationOnly));
   assert.equal(new Set(ids).size,ids.length);h.tick(5*60*1000);
 }
 assert.equal(new Set(h.requests.map(r=>JSON.parse(r.body).request_id)).size,26);
 await h.bookings();
 assert.equal(h.tables.pcs_channel_events.find(e=>e.external_event_id==='booking-reconcile-scan-cursor').payload.after_id,null);
});
