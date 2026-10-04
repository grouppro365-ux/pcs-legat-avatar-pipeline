import test from 'node:test';
import assert from 'node:assert/strict';
import {sendManualMessage,validateManualSend,manualTelegram,ProviderRejection} from '../server/supabase/pcs-manager-live2/manual-send.mjs';
const cid='contact1',rid='11111111-1111-4111-8111-111111111111',input={request_id:rid,text:'Reviewed text'};
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}}
function fixture(){
 const rows=new Map(),queries=[],sent=[],audits=[];let enabled=true,canReply=true,failReceipt=false,failClaim=false;
 const sql={query:async(q,p)=>{
  queries.push({q,p});
  if(q.startsWith('select m.*'))return rows.has(p[0])?[structuredClone(rows.get(p[0]))]:[];
  if(q.startsWith('select cv.id'))return[{id:'conv1',connection_id:'connection1',chat_id:'4503599627370495',enabled,rights:{can_reply:canReply}}];
  if(q.startsWith('insert into messages')){
   if(failClaim)throw Error('claim storage failed');if(rows.has(p[0]))return[];
   rows.set(p[0],{id:p[0],conversation_id:p[1],text:p[3],raw:JSON.parse(p[4]),request_contact:cid,direction:'OUT',status:'PROCESSING'});return[{id:p[0]}];
  }
  if(q.startsWith('update messages set status=\'PROCESSING\'')){
   const r=rows.get(p[0]);if(r.status!=='FAILED'||r.raw.manual_send.stage!=='rejected')return[];r.status='PROCESSING';r.raw=JSON.parse(p[1]);return[{id:r.id}];
  }
  if(q.startsWith('update messages set status=\'FAILED\'')){const r=rows.get(p[0]);r.status='FAILED';r.raw.manual_send.stage='rejected';return[{id:r.id}]}
  if(q.startsWith('with written')){
   if(failReceipt)throw Error('receipt storage failed');const r=rows.get(p[0]);r.status='SENT';r.telegram_message_id=p[1];r.raw.manual_send.stage='sent';audits.push(r.id);return[{id:r.id}];
  }
  throw Error('Unexpected SQL');
 }};
 const deliver=async payload=>{sent.push(payload);return{message_id:123}};
 return{sql,rows,queries,sent,audits,deliver,disable:()=>enabled=false,denyReply:()=>canReply=false,failReceipt:()=>failReceipt=true,failClaim:()=>failClaim=true};
}
test('manual sends require bounded reviewed text, a contact and a UUID before writing',()=>{
 for(const b of [{text:'x'},{...input,text:''},{...input,text:'x'.repeat(4001)},{...input,contact_id:'foreign'}])assert.throws(()=>validateManualSend(cid,b));
 assert.throws(()=>validateManualSend("<contact>",input));assert.equal(validateManualSend(cid,input).id,rid);
});
test('successful retries reuse the receipt without sending twice or duplicating audit',async()=>{
 const f=fixture();const first=await sendManualMessage(f.sql,cid,input,f.deliver),second=await sendManualMessage(f.sql,cid,input,f.deliver);
 assert.equal(first.message_id,123);assert.equal(second.replayed,true);assert.equal(f.sent.length,1);assert.equal(f.audits.length,1);
 assert.equal(f.sent[0].chat_id,'4503599627370495');assert.equal(f.rows.get(rid).status,'SENT');
});
test('concurrent requests have one durable claim and one provider call',async()=>{
 const f=fixture(),pending=deferred();let sends=0;
 const first=sendManualMessage(f.sql,cid,input,async()=>{sends++;await pending.promise;return{message_id:123}});
 while(!sends)await new Promise(r=>setImmediate(r));
 await assert.rejects(sendManualMessage(f.sql,cid,input,f.deliver),e=>e.code==='delivery_uncertain');pending.resolve();await first;assert.equal(sends,1);assert.equal(f.sent.length,0);
});
test('a lost provider response holds the claim and never resends on retry',async()=>{
 const f=fixture();let sends=0;await assert.rejects(sendManualMessage(f.sql,cid,input,async()=>{sends++;throw Error('timeout')}),e=>e.code==='delivery_uncertain');
 await assert.rejects(sendManualMessage(f.sql,cid,input,f.deliver),e=>e.code==='delivery_uncertain');assert.equal(sends,1);assert.equal(f.sent.length,0);assert.equal(f.rows.get(rid).status,'PROCESSING');
});
test('an accepted send whose database receipt fails is not falsely declared unsent',async()=>{
 const f=fixture();f.failReceipt();await assert.rejects(sendManualMessage(f.sql,cid,input,f.deliver),e=>e.code==='delivery_uncertain');
 await assert.rejects(sendManualMessage(f.sql,cid,input,f.deliver),e=>e.code==='delivery_uncertain');assert.equal(f.sent.length,1);assert.equal(f.audits.length,0);
});
test('only a definitive rejection can be retried with the same request',async()=>{
 const f=fixture();await assert.rejects(sendManualMessage(f.sql,cid,input,async()=>{throw new ProviderRejection()}),e=>e.code==='send_rejected');
 assert.equal(f.rows.get(rid).status,'FAILED');await sendManualMessage(f.sql,cid,input,f.deliver);assert.equal(f.sent.length,1);assert.equal(f.audits.length,1);
});
test('changed content or a foreign contact cannot reuse a receipt',async()=>{
 const f=fixture();await sendManualMessage(f.sql,cid,input,f.deliver);
 await assert.rejects(sendManualMessage(f.sql,cid,{...input,text:'Different'},f.deliver),e=>e.code==='send_conflict');
 await assert.rejects(sendManualMessage(f.sql,'other',input,f.deliver),e=>e.code==='send_conflict');assert.equal(f.sent.length,1);
});
test('disabled connections, absent reply rights and a failed durable claim never send',async()=>{
 for(const deny of ['disable','denyReply','failClaim']){const f=fixture();f[deny]();await assert.rejects(sendManualMessage(f.sql,cid,input,f.deliver));assert.equal(f.sent.length,0)}
});
test('provider JSON rejects distinguish definite rejection from unknown or malformed outcomes',async()=>{
 const transport=data=>async()=>Response.json(data);
 await assert.rejects(manualTelegram('fixture',{},transport({ok:false,error_code:429})),ProviderRejection);
 for(const data of [{ok:false,error_code:500},{ok:true,result:{}},{ok:true,result:{message_id:0}}])await assert.rejects(manualTelegram('fixture',{},transport(data)),e=>!(e instanceof ProviderRejection));
 assert.equal((await manualTelegram('fixture',{},transport({ok:true,result:{message_id:123}}))).message_id,123);
});
