import test from 'node:test';
import assert from 'node:assert/strict';
import {decideApproval,approvalInput} from '../server/supabase/pcs-manager-live2/approval-policy.mjs';
import {ProviderRejection} from '../server/supabase/pcs-manager-live2/manual-send.mjs';
const input={id:'generation1',action:'send',expected_version:'before',text:'Reviewed AI answer'};
function fixture(){
 const g={id:input.id,conversation_id:'conversation1',status:'APPROVAL_REQUIRED',answer:input.text,edit_version:'before'};let m=null,enabled=true,failReceipt=false;const audits=[];let sends=0;
 const sql={query:async(q,p)=>{
  if(q.startsWith('select id,conversation_id,status,answer'))return[{...g}];
  if(q.startsWith('select id,conversation_id,direction'))return m?[structuredClone(m)]:[];
  if(q.startsWith('with claimed')){
   if(g.status!=='APPROVAL_REQUIRED'||g.edit_version!==p[1]||g.answer!==p[2]||!enabled)return[];
   g.edit_version='after';
   if(m&&!(m.status==='FAILED'&&m.raw.approval_send.stage==='rejected'))return[];
   m={id:p[3],conversation_id:g.conversation_id,business_connection_id:'connection1',direction:'OUT',status:'PROCESSING',text:p[2],raw:{approval_send:{generation_id:g.id,stage:'sending'}}};
   return[{...m,chat_id:'4503599627370495'}];
  }
  if(q.startsWith('with changed')){
   if(g.status!=='APPROVAL_REQUIRED'||g.edit_version!==p[1]||m&&m.status!=='FAILED')return[];
   g.status='REJECTED';g.edit_version='rejected';audits.push('reject');return[{id:g.id}];
  }
  if(q.startsWith('update messages')){m.status='FAILED';m.raw.approval_send.stage='rejected';return[{id:m.id}]}
  if(q.startsWith('with written')){if(failReceipt)throw Error('DB unavailable');m.status='SENT';m.raw.approval_send.stage='sent';m.telegram_message_id=p[1];g.status='SENT';audits.push('sent');return[{id:m.id}]}
  throw Error('Unexpected SQL');
 }};
 return{g,get m(){return m},sql,audits,disable:()=>enabled=false,failReceipt:()=>failReceipt=true,get sends(){return sends},deliver:async p=>{sends++;assert.equal(p.chat_id,'4503599627370495');return{message_id:123}}};
}
test('approval requires valid identity, bounded reviewed text and version',()=>{
 for(const b of [{...input,id:'<id>'},{...input,action:'auto'},{...input,text:'x'.repeat(4001)},{...input,expected_version:''},{...input,force:true}])assert.throws(()=>approvalInput(b));
});
test('approval receipt replays without another provider call, including after UI reopens',async()=>{
 const f=fixture();await decideApproval(f.sql,input,f.deliver);const r=await decideApproval(f.sql,{...input,expected_version:'new version'},f.deliver);
 assert.equal(r.replayed,true);assert.equal(f.sends,1);assert.deepEqual(f.audits,['sent']);
});
test('changed answer, version, status or disabled connection never sends',async()=>{
 for(const change of [f=>f.g.answer='Changed',f=>f.g.edit_version='Changed',f=>f.g.status='REJECTED',f=>f.disable()]){
  const f=fixture();change(f);await assert.rejects(decideApproval(f.sql,input,f.deliver));assert.equal(f.sends,0);
 }
});
test('parallel sends and reject cannot overtake a claimed delivery',async()=>{
 const f=fixture();let resume,called=false;const wait=new Promise(r=>resume=r);
 const first=decideApproval(f.sql,input,async()=>{called=true;await wait;return{message_id:123}});
 while(!called)await new Promise(r=>setImmediate(r));
 await assert.rejects(decideApproval(f.sql,input,f.deliver),e=>e.code==='delivery_uncertain');
 await assert.rejects(decideApproval(f.sql,{...input,action:'reject',expected_version:f.g.edit_version},f.deliver),e=>e.code==='delivery_uncertain');
 resume();await first;assert.equal(f.g.status,'SENT');assert.deepEqual(f.audits,['sent']);
});
test('uncertain delivery and failed receipt remain held after reopening',async()=>{
 for(const failedReceipt of [true,false]){
  const f=fixture();if(failedReceipt)f.failReceipt();let calls=0;
  await assert.rejects(decideApproval(f.sql,input,async()=>{calls++;if(!failedReceipt)throw Error('timeout');return{message_id:123}}),e=>e.code==='delivery_uncertain');
  await assert.rejects(decideApproval(f.sql,{...input,expected_version:f.g.edit_version},f.deliver),e=>e.code==='delivery_uncertain');
  assert.equal(calls,1);assert.equal(f.sends,0);assert.equal(f.m.status,'PROCESSING');
 }
});
test('definitive provider rejection permits a refreshed retry, never an old stale decision',async()=>{
 const f=fixture();await assert.rejects(decideApproval(f.sql,input,async()=>{throw new ProviderRejection()}),e=>e.code==='send_rejected');
 await assert.rejects(decideApproval(f.sql,input,f.deliver));assert.equal(f.sends,0);
 await decideApproval(f.sql,{...input,expected_version:f.g.edit_version},f.deliver);assert.equal(f.sends,1);
});
test('rejection audits once and blocks subsequent sending',async()=>{
 const f=fixture();await decideApproval(f.sql,{...input,action:'reject'},f.deliver);await decideApproval(f.sql,{...input,action:'reject'},f.deliver);
 await assert.rejects(decideApproval(f.sql,input,f.deliver));assert.deepEqual(f.audits,['reject']);assert.equal(f.sends,0);
});
test('stored receipt cannot be rebound to another conversation or different reviewed text',async()=>{
 const f=fixture();await decideApproval(f.sql,input,f.deliver);
 await assert.rejects(decideApproval(f.sql,{...input,text:'Different'},f.deliver));f.g.conversation_id='foreign';
 await assert.rejects(decideApproval(f.sql,input,f.deliver));assert.equal(f.sends,1);
});
