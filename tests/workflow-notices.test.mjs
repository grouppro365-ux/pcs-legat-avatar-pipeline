import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkflowNotices,workflowNoticeQuery,workflowNoticeEvents} from '../server/supabase/pcs-manager-live2/workflow-notices.mjs';
test('operator projection preserves external outbox delivery ownership and limits the event scope',async()=>{
 let params;const r=await createWorkflowNotices({query:async(q,p)=>{assert.equal(q,workflowNoticeQuery);params=p;return[{created:2,marked:3}]}});
 assert.deepEqual(params,[workflowNoticeEvents]);assert.equal(r.client_messages_sent,0);
 assert.match(workflowNoticeQuery,/for update of e skip locked/);
 assert.match(workflowNoticeQuery,/on conflict\(dedupe_key\) do nothing/);
 assert.match(workflowNoticeQuery,/update pcs_workflow_outbox e set payload=/);
 assert.doesNotMatch(workflowNoticeQuery,/set status=|attempts=|sent_at=/);
});
test('malformed projection receipts do not claim successful automation',async()=>{
 for(const row of [{created:1,marked:0},{created:51,marked:51},{created:'0',marked:0},undefined])await assert.rejects(createWorkflowNotices({query:async()=>[row]}));
 assert.equal((await createWorkflowNotices({query:async()=>[{created:0,marked:0}]})).created,0);
});
