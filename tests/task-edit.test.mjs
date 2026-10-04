import test from 'node:test';
import assert from 'node:assert/strict';
import {taskPatch,taskUpdateQuery,updateTask,readTask} from '../server/supabase/pcs-manager-live2/task-edit.mjs';
const base={task_id:'task1',expected_version:'2026-10-04 12:30:00.123456'};
test('task edits are partial and validate dates, text, priority and field allowlist',()=>{
 assert.deepEqual(taskPatch({...base,due_at:null,assignee:' Alice ',priority:'HIGH'}),{due_at:null,assignee:'Alice',priority:'HIGH'});
 for(const p of [{title:' '},{title:'a'.repeat(301)},{priority:'HOT'},{contact_id:'other'},{completed_at:null},{due_at:'2026-02-31T00:00:00.000Z'},{due_at:'2026-10-04T12:00'},{assignee:42}])assert.throws(()=>taskPatch({...base,...p}));assert.throws(()=>taskPatch(base));
});
test('editing scopes identity, checks exact version and open state, and audits atomically',async()=>{
 const q=taskUpdateQuery('contact1',{...base,title:"'); DROP TABLE tasks; --"},'audit1');assert.doesNotMatch(q.query,/DROP TABLE/);assert.match(q.query,/t.id=\$2 and t.contact_id=\$3 and t.updated_at::text=\$4 and t.completed_at is null/);assert.match(q.query,/interval '1 microsecond'/);assert.match(q.query,/insert into audit_logs/);assert.equal(q.params[2],'contact1');assert.equal(q.params[3],base.expected_version);
 await assert.rejects(()=>updateTask({query:async()=>[]},'contact1',{...base,priority:'URGENT'}),e=>e.status===409);
 const data=await updateTask({query:async()=>[{id:'task1',contact_id:'contact1'}]},'contact1',{...base,title:'Updated'});assert.equal(data.ok,true);
});
test('reading a task binds both identities and missing tasks cannot be edited under another client',async()=>{
 const calls=[],sql={query:async(q,p)=>{calls.push({q,p});return[]}};await assert.rejects(()=>readTask(sql,'contact1','task1'),e=>e.status===404);assert.deepEqual(calls[0].p,['task1','contact1']);assert.match(calls[0].q,/t.id=\$1 and t.contact_id=\$2/);
});
