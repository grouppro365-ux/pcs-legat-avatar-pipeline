import test from 'node:test';
import assert from 'node:assert/strict';
import {followupReminderQuery,createFollowupReminders,internalFollowupReminders} from '../server/supabase/pcs-manager-live2/followup-reminders.mjs';
const req=(method='POST',secret)=>new Request('https://existing.invalid/?op=followup-reminder-worker',{method,headers:secret?{'x-pcs-internal-secret':secret}:{}});
test('reminders are bounded, lock actual deadlines, dedupe exact dates and audit atomically',async()=>{
 assert.match(followupReminderQuery,/a.follow_up_at<=now\(\)/);assert.match(followupReminderQuery,/operational_status<>all/);assert.match(followupReminderQuery,/not exists/);assert.match(followupReminderQuery,/limit 50 for update of a skip locked/);assert.match(followupReminderQuery,/on conflict\(dedupe_key\) do nothing/);assert.match(followupReminderQuery,/insert into audit_events/);assert.doesNotMatch(followupReminderQuery,/client_contact|follow_up_note|set read_at|set sent_at|sendMessage/);
 const r=await createFollowupReminders({query:async(q,p)=>{assert.ok(p[0].includes('COMPLETED'));return [{created:2}]}});assert.equal(r.client_messages_sent,0);assert.equal(r.channel,'IN_APP');assert.equal(r.created,2);
 for(const created of [undefined,51,-1,'2'])await assert.rejects(()=>createFollowupReminders({query:async()=>[{created}]}),/receipt_invalid/);
});
test('internal worker refuses method/missing/wrong secrets and sanitizes failures',async()=>{
 const biz={query:()=>assert.fail('unauthorized write')};assert.equal((await internalFollowupReminders(req('GET'),{biz})).status,405);assert.equal((await internalFollowupReminders(req(),{biz})).status,401);
 assert.equal((await internalFollowupReminders(req('POST','wrong'),{base:'https://test',key:'server',biz},async()=>Response.json('expected'))).status,401);
 const r=await internalFollowupReminders(req('POST','expected'),{base:'https://test',key:'server',biz:{query:async()=>{throw Error('private database URI')}}},async()=>Response.json('expected'));assert.equal(r.status,503);assert.ok(!JSON.stringify(r).includes('private database'));
});
test('valid internal secret only creates in-app notifications without external sends',async()=>{
 const r=await internalFollowupReminders(req('POST','expected'),{base:'https://test',key:'server',biz:{query:async()=>[{created:0}]}},async(url,opts)=>{assert.equal(url,'https://test/rest/v1/rpc/pcs_secret_get');assert.equal(JSON.parse(opts.body).p_name,'internal_retry_secret');return Response.json('expected')});assert.equal(r.status,200);assert.equal(r.body.created,0);assert.equal(r.body.client_messages_sent,0);
});
