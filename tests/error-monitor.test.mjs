import test from 'node:test';
import assert from 'node:assert/strict';
import {readErrorMonitor,safeError} from '../server/supabase/pcs-manager-live2/error-monitor.mjs';
test('runtime error queue uses existing worker storage, bounded fields and server credentials',async()=>{
 let called;const data=await readErrorMonitor(null,'https://test.invalid','server-key','runtime','2',async(url,init)=>{
  called={url:new URL(url),init};return Response.json(Array.from({length:201},(_,i)=>({id:'job'+i,status:'review_required',error:'Bearer hidden-token'})));
 });
 assert.equal(called.url.pathname,'/rest/v1/pcs_failed_jobs');assert.equal(called.url.searchParams.get('offset'),'400');assert.equal(called.url.searchParams.get('limit'),'201');
 assert.doesNotMatch(called.url.searchParams.get('select'),/payload|contact_id/);assert.equal(called.init.headers.authorization,'Bearer server-key');
 assert.equal(data.truncated,true);assert.equal(data.rows.length,200);assert.equal(data.rows[0].error,'Bearer [скрыто]');
});
test('delivery reviews are read-only and keep Neon contacts scoped to their conversation',async()=>{
 let called;const data=await readErrorMonitor({query:async(q,p)=>{called={q,p};return[{id:'attempt1',contact_id:'client1'}]}},'','', 'delivery','1',()=>{throw Error('No network expected')});
 assert.equal(data.source,'delivery');assert.equal(called.p[0],200);assert.match(called.q,/join conversations cv on cv.id=m.conversation_id/);assert.match(called.q,/manual_send/);assert.match(called.q,/approval_send/);assert.match(called.q,/'PROCESSING'/);assert.doesNotMatch(called.q,/update |insert |delete |m.text|m.raw,/);
});
test('invalid filters never query, and unavailable runtime reads never masquerade as empty',async()=>{
 let calls=0;const transport=async()=>{calls++;return Response.json({error:'unavailable'},{status:503})};
 for(const [s,p] of [['other','0'],['runtime','-1'],['runtime','5001'],['runtime','2junk']])await assert.rejects(readErrorMonitor(null,'https://test.invalid','key',s,p,transport));
 assert.equal(calls,0);await assert.rejects(readErrorMonitor(null,'https://test.invalid','key','runtime','0',transport),e=>e.status===503);
});
test('diagnostics redact connection strings and common credential formats and bound length',()=>{
 const text=safeError('postgresql://user:password@db/test Bearer a.b.c 12345678:ABCDEFGHIJKLMNOPQRSTUVWXYZ_123 sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ '+ 'x'.repeat(2000));
 assert.doesNotMatch(text,/password|a.b.c|ABCDEFGHIJKLMNOPQRSTUVWXYZ/);assert.ok(text.length<=1000);
});
