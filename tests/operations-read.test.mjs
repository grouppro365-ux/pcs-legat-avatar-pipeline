import test from 'node:test';
import assert from 'node:assert/strict';
import {notificationReadQuery,markNotificationRead} from '../server/supabase/pcs-manager-live2/operations-read.mjs';
test('explicit acknowledgement locks the exact shared event, audits first read, and supports retries',async()=>{
 const b={id:'11111111-1111-4111-8111-111111111111',expected_version:'a'.repeat(32)},q=notificationReadQuery(b);
 assert.deepEqual(q.params,[b.id,b.expected_version]);assert.match(q.query,/recipient_partner_id is null/);assert.match(q.query,/for update/);assert.match(q.query,/md5\(\(to_jsonb\(n\)-'read_at'\)::text\)=\$2/);
 assert.match(q.query,/c.read_at is null/);assert.match(q.query,/insert into audit_events/);assert.match(q.query,/from candidate where read_at is not null/);assert.doesNotMatch(q.query,/set status|actioned_at=|sent_at=/);
 assert.equal((await markNotificationRead({query:async()=>[{id:b.id,read_at:'2026-10-05T08:00:00Z'}]},b)).ok,true);
 await assert.rejects(()=>markNotificationRead({query:async()=>[]},b),e=>e.status===409);
 await assert.rejects(()=>markNotificationRead({query:async()=>{throw Error('offline')}},b),/offline/);
 for(const bad of [null,[],{...b,id:'invalid'},{...b,expected_version:'x'},{...b,recipient_partner_id:null}])assert.throws(()=>notificationReadQuery(bad),e=>e.status===400);
});
import {readOperationalOverview,readNotifications,readOperationalApplication,overviewQueries,terminalApplicationStatuses} from '../server/supabase/pcs-manager-live2/operations-read.mjs';
test('overview reads full server counts independently from limited previews and excludes all terminal applications',async()=>{
 const calls=[],op={query:async q=>{calls.push(q);return[{data:{contacts:1005,clients:[{id:'last'}],tasks:{open:8,overdue:3}}}];}},biz={query:async(q,p)=>{assert.deepEqual(p,[terminalApplicationStatuses]);return[{data:{catalog:900,available:800,active_bookings:4}}];}};
 const r=await readOperationalOverview(op,biz,'https://existing.invalid','server-key',async(url,options)=>{assert.equal(new URL(url).searchParams.get('resolved_at'),'is.null');assert.equal(options.headers.prefer,'count=exact');return new Response('[]',{headers:{'content-range':'0-0/27'}});});
 assert.equal(r.sections.crm.data.contacts,1005);assert.equal(r.sections.business.data.catalog,900);assert.equal(r.sections.runtime.data.unresolved_jobs,27);
 assert.ok(terminalApplicationStatuses.includes('CANCELLED_BY_CLIENT'));assert.ok(terminalApplicationStatuses.includes('CANCELLED_BY_PARTNER'));
 assert.match(overviewQueries.business,/publication_status='PUBLISHED'.*moderation_status='APPROVED'.*availability_status='AVAILABLE'/);assert.match(overviewQueries.business,/publication_ends_at>now\(\)/);
});
test('failed sources and missing exact counts stay explicit rather than becoming zero',async()=>{
 const r=await readOperationalOverview({query:async()=>{throw Error('private database URI')}},{query:async()=>[{data:{catalog:12}}]},'https://existing.invalid','server-key',async()=>new Response('[]'));
 assert.ok(r.sections.crm.error);assert.equal(r.sections.crm.data,undefined);assert.ok(r.sections.runtime.error);assert.equal(r.sections.business.data.catalog,12);assert.ok(!JSON.stringify(r).includes('private database URI'));
});
test('notifications are paginated and partner-private notifications are excluded, with no mutation',async()=>{
 let call;const r=await readNotifications({query:async(q,p)=>{call={q,p};return Array.from({length:51},(_,i)=>({id:String(i)}));}},'all','2');assert.deepEqual(call.p,['all',100]);assert.match(call.q,/recipient_partner_id is null/);assert.doesNotMatch(call.q,/select \*|update |insert /i);assert.equal(r.rows.length,50);assert.equal(r.truncated,true);
 for(const args of [['invalid','0'],['all','-1'],['all','5001']])await assert.rejects(()=>readNotifications({query:()=>assert.fail('unsafe SQL')},...args),e=>e.status===400);
});
test('attention application read binds identity and projects only operational fields',async()=>{
 const id='11111111-1111-4111-8111-111111111111';let call;const r=await readOperationalApplication({query:async(q,p)=>{call={q,p};return[{id}];}},id);assert.equal(r.application.id,id);assert.deepEqual(call.p,[id]);assert.doesNotMatch(call.q,/select \*|internal_notes|client_contact|qualification_data/);
 await assert.rejects(()=>readOperationalApplication({query:()=>assert.fail('unsafe SQL')},'bad'),e=>e.status===400);
 await assert.rejects(()=>readOperationalApplication({query:async()=>[]},id),e=>e.status===404);
});
test('due actions page all contacts with stable order, bounded projection and UTC cutoff',async()=>{
 const {readDueActions}=await import('../server/supabase/pcs-manager-live2/operations-read.mjs');let call;
 const result=await readDueActions({query:async(q,p)=>{call={q,p};return Array.from({length:51},(_,i)=>({id:String(i)}));}},'2');
 assert.equal(result.page,2);assert.equal(result.rows.length,50);assert.equal(result.truncated,true);assert.deepEqual(call.p,[100]);
 assert.match(call.q,/next_action_at<=now\(\) at time zone 'UTC'/);assert.match(call.q,/order by next_action_at,id limit 51/);assert.doesNotMatch(call.q,/select \*|update |insert /i);
 assert.match(overviewQueries.crm,/'attention_contacts'.*next_action_at<=.*order by next_action_at,id limit 5/s);
 for(const page of ['-1','5001','1;drop table contacts',null])await assert.rejects(()=>readDueActions({query:()=>assert.fail('unsafe query')},page),e=>e.status===400);
 await assert.rejects(()=>readDueActions({query:async()=>{throw Error('Unavailable')}},'0'),/Unavailable/);
});
