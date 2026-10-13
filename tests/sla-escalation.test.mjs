import test from 'node:test';import assert from 'node:assert/strict';
import {createSlaEscalations,slaEscalationQuery} from '../server/supabase/pcs-manager-live2/sla-escalation.mjs';
import {internalFollowupReminders} from '../server/supabase/pcs-manager-live2/followup-reminders.mjs';
test('escalation uses existing deadlines, bounded row locks and atomic notification/flag/audit',async()=>{
 let call;const r=await createSlaEscalations({query:async(q,p)=>{call={q,p};return [{created:2}]}});
 assert.equal(r.created,2);assert.equal(r.client_messages_sent,0);assert.ok(call.p[0].includes('COMPLETED'));assert.ok(call.p[0].includes('CANCELLED_BY_PARTNER'));
 assert.match(call.q,/a.sla_due_at<=now\(\)/);assert.match(call.q,/for update of a skip locked/);assert.match(call.q,/limit 50/);assert.match(call.q,/on conflict\(dedupe_key\) do nothing/);assert.match(call.q,/human_review_required=true/);assert.match(call.q,/insert into audit_events/);assert.doesNotMatch(call.q,/set sla_due_at|set priority|client_contact|sendMessage|follow_up_note/);
 for(const created of ['0',51,-1,undefined])await assert.rejects(()=>createSlaEscalations({query:async()=>[{created}]}),/receipt_invalid/);
});
test('unauthorized workers cannot escalate; valid secret returns actual escalation result',async()=>{
 let escalations=0;const context={base:'https://test',key:'server',biz:{query:async q=>{if(q===slaEscalationQuery){escalations++;return [{created:2}]}return q.includes('pcs_workflow_outbox')?[{created:0,marked:0}]:[{created:0}]}}};
 const request=secret=>new Request('https://test',{method:'POST',headers:{'x-pcs-internal-secret':secret}}),auth=async()=>Response.json('expected');
 assert.equal((await internalFollowupReminders(request('wrong'),context,auth)).status,401);assert.equal(escalations,0);
 const r=await internalFollowupReminders(request('expected'),context,auth);assert.equal(r.status,200);assert.equal(r.body.sla_escalation.created,2);assert.equal(r.body.client_messages_sent,0);
});
