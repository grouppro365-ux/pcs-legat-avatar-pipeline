import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applicationQueueQuery,readApplicationQueue,readApplicationWorkspace,applicationFollowupQuery,saveApplicationFollowup} from '../server/supabase/pcs-manager-live2/application-workspace.mjs';
const id='11111111-1111-4111-8111-111111111111',b={id,expected_version:'a'.repeat(32),follow_up_at:'2026-10-08T12:00:00.000Z',follow_up_note:'  Ask dates  '};
test('queue binds literal search, excludes terminal rows and pages all applications',async()=>{
 const q=applicationQueueQuery('attention','2'," %_' OR 1=1 -- ");assert.equal(q.params[2],"%_' OR 1=1 --");assert.equal(q.params[3],100);assert.ok(q.params[1].includes('COMPLETED'));assert.match(q.query,/strpos\(lower/);assert.doesNotMatch(q.query,/OR 1=1|select \*/);assert.match(q.query,/a.follow_up_at<=now\(\)/);assert.match(q.query,/a.human_review_required/);
 const d=await readApplicationQueue({query:async()=>Array.from({length:51},(_,i)=>({id:i}))},'all','2','');assert.equal(d.rows.length,50);assert.equal(d.truncated,true);assert.equal(d.page,2);
 for(const args of [['bad','0',''],['all','-1',''],['all','5001',''],['all','0','x'.repeat(121)],['all',null,'']])assert.throws(()=>applicationQueueQuery(...args),e=>e.status===400);
});
test('detail preserves numeric text and version without dumping private contact or documents',async()=>{
 let q;const r=await readApplicationWorkspace({query:async(sql,p)=>{q=sql;assert.deepEqual(p,[id]);return[{id,partner_proposed_client_price_thb:'10.25'}]}},id);assert.equal(r.application.partner_proposed_client_price_thb,'10.25');assert.match(q,/md5\(to_jsonb\(a\)::text\)/);assert.doesNotMatch(q,/select \*|client_contact|internal_notes|accepted_offer_snapshot|qualification_data,/);
 await assert.rejects(()=>readApplicationWorkspace({query:async()=>[]},id),e=>e.status===404);await assert.rejects(()=>readApplicationWorkspace({query:()=>assert.fail()},'bad'),e=>e.status===400);
});
test('followup only edits schedule/note with exact fingerprint, row lock and atomic audit',async()=>{
 const q=applicationFollowupQuery(b);assert.equal(q.params[2],b.follow_up_at);assert.equal(q.params[3],'Ask dates');assert.match(q.query,/for update/);assert.match(q.query,/md5\(to_jsonb\(a\)::text\)=\$2/);assert.match(q.query,/is distinct from/);assert.match(q.query,/insert into audit_events/);assert.match(q.query,/not exists\(select 1 from changed\)/);assert.doesNotMatch(q.query,/set operational_status|set client_payment_status|sendMessage/);
 assert.equal(applicationFollowupQuery({...b,follow_up_at:null,follow_up_note:' '}).params[3],null);
 assert.equal((await saveApplicationFollowup({query:async()=>[{id}]},b)).ok,true);await assert.rejects(()=>saveApplicationFollowup({query:async()=>[]},b),e=>e.status===409);
 for(const bad of [null,[],{...b,id:'bad'},{...b,expected_version:'bad'},{...b,follow_up_at:'2026-02-30T12:00:00.000Z'},{...b,follow_up_at:'2026-10-08T12:00:00+03:00'},{...b,follow_up_note:'x'.repeat(4001)},{...b,client_payment_status:'PAID_TO_PARTNER'}])assert.throws(()=>applicationFollowupQuery(bad),e=>e.status===400);
});
test('routes retain admin authentication and restrict HTTP methods',()=>{
 const s=readFileSync(new URL('../server/supabase/pcs-manager-live2/index.ts',import.meta.url),'utf8');for(const op of ['application-queue','application-workspace','application-followup'])assert.ok(s.indexOf("if(opName==='"+op+"')")>s.indexOf('if(!await verifyAdminToken'));
 assert.match(s,/application-followup'\)\{if\(req.method!=='POST'/);assert.match(s,/application-queue'\)\{if\(req.method!=='GET'/);
});
