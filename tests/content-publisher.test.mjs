import test from 'node:test';import assert from 'node:assert/strict';
import {deliverTelegramPublication,dispatchContentPublication,verifyDispatchedPublication} from '../server/supabase/pcs-manager-live2/content-publisher.mjs';
import {actContentWorkflow,contentInput} from '../server/supabase/pcs-manager-live2/content-workflow.mjs';
const id='11111111-1111-4111-8111-111111111111',job={id,claim_id:id,post_id:id,username:'public_channel',chat_id:'-10012345678',bot_id:'123456',body:'Exact approved text',claimed_at:new Date().toISOString()};
const token='123456:synthetic_private_token_abcdefghijklmnopqrstuvwxyz',date=Math.floor(Date.now()/1000);
function transport({preflight=false,sendThrow=false,sendStatus=200,sendData}={}){let sends=0;const calls=[];return{calls,get sends(){return sends;},fetch:async(url,init)=>{calls.push({url,init});const method=url.split('/').at(-1);if(method==='pcs_secret_get')return Response.json(token);if(method==='getMe')return Response.json({ok:true,result:{id:123456,is_bot:true}});if(method==='getChat')return Response.json({ok:true,result:{id:-10012345678,type:'channel',username:job.username,title:'PCS'}});if(method==='getChatMember')return Response.json({ok:true,result:{user:{id:123456},status:'administrator',can_post_messages:!preflight}});assert.equal(method,'sendMessage');sends++;if(sendThrow)throw Error('network unknown '+token);return Response.json(sendData??{ok:true,result:{message_id:42,chat:{id:-10012345678,type:'channel',username:job.username},text:job.body,date}},{status:sendStatus});}};}
test('publisher validates current target and sends exactly frozen text with the same bot token once',async()=>{
 const t=transport();const out=await deliverTelegramPublication('https://service.test','key',job,t.fetch);assert.deepEqual(out,{outcome:'SENT',chat_id:job.chat_id,text:job.body,message_id:'42',date});assert.equal(t.sends,1);assert.deepEqual(JSON.parse(t.calls.at(-1).init.body),{chat_id:job.chat_id,text:job.body});assert.equal(t.calls.at(-1).init.redirect,'error');assert.equal(JSON.stringify(out).includes(token),false);
});
test('preflight or immutable target mismatch performs no send and is definitely unsent',async()=>{
 for(const candidate of [job,{...job,chat_id:'-100999'},{...job,bot_id:'999'},{...job,body:'x'.repeat(4097)}]){const t=transport({preflight:candidate===job});const out=await deliverTelegramPublication('https://service.test','key',candidate,t.fetch);assert.equal(out.outcome,'REJECTED');assert.equal(out.reason,'target_preflight_failed');assert.equal(t.sends,0);}
});
test('network ambiguity and malformed/mismatched receipts are terminal UNKNOWN without retries',async()=>{
 const valid={message_id:42,chat:{id:-10012345678,type:'channel',username:job.username},text:job.body,date};
 for(const options of [{sendThrow:true},{sendStatus:503,sendData:{ok:false,error_code:500}},{sendStatus:408,sendData:{ok:false,error_code:408}},{sendStatus:503,sendData:{ok:true,result:valid}},{sendData:{ok:'true',result:valid}},...[{...valid,text:'Different text'},{...valid,chat:{...valid.chat,id:-999}},{...valid,message_id:0},{...valid,date:'123'}].map(result=>({sendData:{ok:true,result}}))]){const t=transport(options);const out=await deliverTelegramPublication('https://service.test','key',job,t.fetch);assert.equal(out.outcome,'UNKNOWN');assert.equal(t.sends,1);assert.equal(JSON.stringify(out).includes(token),false);}
});
test('explicit provider rejection is distinct from an unknown transport outcome',async()=>{
 for(const code of [400,403,429]){const t=transport({sendStatus:code,sendData:{ok:false,error_code:code,description:'private provider detail '+token}});assert.deepEqual(await deliverTelegramPublication('https://service.test','key',job,t.fetch),{outcome:'REJECTED',reason:'provider_rejected'});assert.equal(t.sends,1);}
});
test('worker never delivers without a claimed job and completes an actual claim exactly once',async()=>{
 let sent=0;const empty=await dispatchContentPublication({query:async()=>[{result:{ok:true,job:null}}]},async()=>{sent++;});assert.equal(sent,0);assert.equal(empty.claimed,0);
 const calls=[];const out=await dispatchContentPublication({query:async(q,p)=>{calls.push([q,p]);return[{result:calls.length===1?{ok:true,job}:{ok:true,job:{state:'SENT'}}}];}},async input=>{sent++;assert.equal(input,job);return {outcome:'SENT',chat_id:job.chat_id,text:job.body,message_id:'42',date};});assert.equal(sent,1);assert.equal(out.sent,1);assert.equal(out.receipt_saved,true);assert.equal(calls.length,2);assert.deepEqual(calls[1][1].slice(0,2),[id,id]);
});
test('failed receipt persistence never repeats a potentially delivered post',async()=>{
 let calls=0,sends=0;const out=await dispatchContentPublication({query:async()=>{if(++calls===1)return[{result:{ok:true,job}}];throw Error('database unavailable');}},async()=>{sends++;return{outcome:'SENT',chat_id:job.chat_id,text:job.body,message_id:'42',date};});assert.equal(calls,2);assert.equal(sends,1);assert.equal(out.unknown,1);assert.equal(out.sent,0);assert.equal(out.receipt_saved,false);
});
test('unexpected delivery exception is persisted as UNKNOWN, never retried',async()=>{
 let calls=0,receipt;const out=await dispatchContentPublication({query:async(q,p)=>{if(++calls===1)return[{result:{ok:true,job}}];receipt=JSON.parse(p[2]);return[{result:{ok:true}}];}},async()=>{throw Error('private transport failure');});assert.deepEqual(receipt,{outcome:'UNKNOWN',reason:'transport_unknown'});assert.equal(out.unknown,1);
});
test('scheduling requires explicit exact-target confirmation, timezone, version and publication permission',async()=>{
 const input={request_id:id,id,expected_version:3,target_id:id,target_version:2,scheduled_at:'2099-01-01T12:00:00Z',publication_confirmed:true};
 for(const bad of [{...input,publication_confirmed:false},{...input,target_version:undefined},{...input,target_id:'bad'},{...input,scheduled_at:'2099-01-01T12:00:00'},{...input,body:'Injected text'}])assert.throws(()=>contentInput('schedule-publication',bad));
 assert.deepEqual(contentInput('schedule-publication',input),input);let calls=0;await assert.rejects(()=>actContentWorkflow({query:()=>{calls++;}},'schedule-publication',input,'actor',['content.edit']),e=>e.status===403);assert.equal(calls,0);
});

test('public verification runs only after a durable accepted receipt and cannot change delivery accounting',async()=>{
 for(const outcome of ['SENT','REJECTED','UNKNOWN']){let queries=0,verified=0;
  const r=await dispatchContentPublication({query:async()=>[{result:++queries===1?{ok:true,job}:{ok:true}}]},async()=>({outcome,reason:'transport_unknown'}),async()=>{verified++;throw Error('public site unavailable');});
  assert.equal(verified,outcome==='SENT'?1:0);assert.equal(r.sent,outcome==='SENT'?1:0);if(outcome==='SENT')assert.equal(r.verification.outcome,'VERIFICATION_UNAVAILABLE');
 }
 let verified=0,queries=0;await dispatchContentPublication({query:async()=>{if(++queries===1)return[{result:{ok:true,job}}];throw Error('receipt not saved');}},async()=>({outcome:'SENT'}),async()=>{verified++;});assert.equal(verified,0);
});
test('automatic observation uses exact accepted revision and public text; unavailable pages remain unverified',async()=>{
 for(const page of ['<html>Site Unavailable</html>','<div class="tgme_widget_message" data-post="public_channel/42"><div class="tgme_widget_message_text js-message_text">Exact approved text</div><time datetime="2026-10-21T12:00:00Z"></time></div>']){
  const calls=[];let observation;const biz={query:async(q,p)=>{calls.push([q,p]);if(calls.length===1)return[{id,version:9}];if(calls.length===2)return[{result:{ok:true,verification_required:true,snapshot:{body:job.body,publication_url:'https://t.me/public_channel/42'}}}];observation=JSON.parse(p[3]);return[{result:{ok:true,id,verification:observation}}];}};
  const out=await verifyDispatchedPublication(biz,{...job,revision:2},{fetcher:async()=>new Response(page)});assert.deepEqual(calls[0][1],[id,2]);assert.match(calls[0][0],/status='PUBLICATION_SENT'/);assert.equal(out.outcome,page.includes('Site Unavailable')?'UNREADABLE':'TEXT_MATCH');assert.equal(observation.message_id,'42');
 }
});
