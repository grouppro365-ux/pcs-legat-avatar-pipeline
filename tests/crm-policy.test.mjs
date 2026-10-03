import test from 'node:test';
import assert from 'node:assert/strict';
import {contactPatch,saveContact,createTask,completeTask,contactUpdateQuery,taskCreateQuery,taskCompleteQuery,readCrmBody} from '../server/supabase/pcs-manager-live2/crm-policy.mjs';
const cid='cmcontact123',version='2026-10-03 12:34:56.123456';
test('partial edits preserve other fields and reject forged identity, payment, or unsupported data',()=>{
 assert.deepEqual(contactPatch({expected_version:version,name:' Alice ',next_action_at:null}),{name:'Alice',next_action_at:null});
 for(const extra of [{telegram_user_id:1},{id:'other'},{preferred_channel:'telegram'},{updated_at:'x'},{payment_route:'paid'}])assert.throws(()=>contactPatch({expected_version:version,name:'Alice',...extra}));
 for(const patch of [{priority:'Обычный'},{status:'made_up'},{need:[]},{name:'x'.repeat(201)},{next_action_at:'2026-02-31T00:00:00.000Z'}])assert.throws(()=>contactPatch({expected_version:version,...patch}));
});
test('edits require an exact version and conflicts never report success',async()=>{
 assert.throws(()=>contactPatch({name:'Alice'}));
 let requests=[];await assert.rejects(saveContact({query:async(q,p)=>{requests.push({q,p});return[]}},cid,{expected_version:version,name:'Alice'}),e=>e.status===409);
 assert.equal(requests.length,1);assert.equal(requests[0].p[2],version);
});
test('contact updates parameterize values, check versions, and insert audit atomically',async()=>{
 const q=contactUpdateQuery(cid,{expected_version:version,need:"'); DROP TABLE contacts; --"},'audit');
 assert.doesNotMatch(q.query,/DROP TABLE/);assert.match(q.query,/updated_at::text=\$3/);assert.match(q.query,/insert into audit_logs/);assert.match(q.query,/exists\(select 1 from audited\)/);
 const r=await saveContact({query:async()=>[{id:cid,edit_version:'next'}]},cid,{expected_version:version,status:'WAITING_CLIENT'});assert.equal(r.contact.edit_version,'next');
});
test('task creation accepts existing text contact IDs and requires a stable request ID',async()=>{
 let p;const sql={query:async(q,params)=>{p=params;return[{id:'task1'}]}};
 assert.equal((await createTask(sql,cid,{id:'task1',title:' Call ',due_at:null})).task.id,'task1');assert.equal(p[0],'task1');assert.equal(p[1],cid);
 for(const b of [{title:'x'},{id:'task1',title:' '},{id:'task1',title:'x',due_at:'2026-02-31T00:00:00.000Z'},{id:'task1',title:'x',contact_id:'other'}])await assert.rejects(createTask(sql,cid,b));
 const q=taskCreateQuery(cid,{id:'task1',title:'Call'},'audit');assert.match(q.query,/on conflict\(id\) do nothing/);assert.match(q.query,/contact_id=\$2/);
});
test('task completion is scoped to its client and returns missing instead of false success',async()=>{
 const q=taskCompleteQuery(cid,'task1','audit');assert.match(q.query,/id=\$1 and contact_id=\$2 and completed_at is null/);assert.match(q.query,/completed_at is not null/);
 await assert.rejects(completeTask({query:async()=>[]},cid,'task1'),e=>e.status===404);
 assert.equal((await completeTask({query:async()=>[{completed_at:'done'}]},cid,'task1')).ok,true);
});
test('CRM bodies reject malformed, non-object, and oversized requests',async()=>{
 for(const b of ['broken','[]','null',JSON.stringify({need:'x'.repeat(33000)})])await assert.rejects(readCrmBody(new Request('https://test.invalid',{method:'POST',body:b})));
 assert.deepEqual(await readCrmBody(new Request('https://test.invalid',{method:'POST',body:'{"title":"Call"}'})),{title:'Call'});
});
