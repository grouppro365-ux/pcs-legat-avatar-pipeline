import test from 'node:test';import assert from 'node:assert/strict';
import {inspectTelegramTarget,verifyContentTarget} from '../server/supabase/pcs-manager-live2/content-targets.mjs';
import {actContentWorkflow,contentInput,readContentWorkflow} from '../server/supabase/pcs-manager-live2/content-workflow.mjs';
const id='11111111-1111-4111-8111-111111111111',input={request_id:id,brand_id:id,username:'public_channel'},observation={username:'public_channel',chat_id:'-10012345678',bot_id:'123456',title:'PCS Channel',can_post_messages:true};
const token='123456:synthetic_private_token_abcdefghijklmnopqrstuvwxyz';
function telegram(overrides={}){const calls=[];return{calls,fetch:async(url,init)=>{calls.push({url,init});if(url.includes('pcs_secret_get'))return Response.json(overrides.secret??token);const method=url.split('/').at(-1);if(overrides.http)return new Response('',{status:overrides.http});const values={getMe:{id:123456,is_bot:true},getChat:{id:-10012345678,type:'channel',username:'Public_Channel',title:'PCS Channel'},getChatMember:{status:'administrator',user:{id:123456,is_bot:true},can_post_messages:true},...overrides};return Response.json({ok:true,result:values[method]});}};}
test('read-only target inspection binds channel, bot identity and actual posting right without sending messages',async()=>{
 const t=telegram();assert.deepEqual(await inspectTelegramTarget('https://service.test','service-key',{username:input.username},t.fetch),observation);
 assert.deepEqual(t.calls.map(x=>x.url.split('/').at(-1)),['pcs_secret_get','getMe','getChat','getChatMember']);
 assert.deepEqual(JSON.parse(t.calls[2].init.body),{chat_id:'@public_channel'});assert.deepEqual(JSON.parse(t.calls[3].init.body),{chat_id:observation.chat_id,user_id:123456});
 assert.equal(JSON.stringify(observation).includes(token),false);for(const c of t.calls)assert.equal(c.init.redirect,'error');
});
test('group, private chat, mismatched username/bot, malformed ids and missing posting rights cannot become verified targets',async()=>{
 for(const override of [{getMe:{id:1,is_bot:false}},{getChat:{id:-1,type:'supergroup',username:input.username,title:'Wrong type'}},{getChat:{id:-1,type:'channel',username:'other_channel',title:'Wrong target'}},{getChat:{id:'-1001',type:'channel',username:input.username,title:'Wrong ID type'}},{getChat:{id:-1001,type:'channel',username:input.username,title:''}},{getChatMember:{status:'member',user:{id:123456},can_post_messages:true}},{getChatMember:{status:'administrator',user:{id:999},can_post_messages:true}},{getChatMember:{status:'administrator',user:{id:123456},can_post_messages:false}},{secret:''},{http:302}]){
  const t=telegram(override);await assert.rejects(()=>inspectTelegramTarget('https://service.test','key',{username:input.username},t.fetch),e=>e.status===409&&!e.message.includes(token));assert.equal(t.calls.some(c=>/sendMessage|sendPhoto|sendVideo/.test(c.url)),false);
 }
});
test('untrusted username cannot control Telegram URL or trigger configuration reads',async()=>{
 for(const username of ['https://evil.test','channel/../sendMessage','@public_channel','PUBLIC_CHANNEL','a?chat_id=1']){let calls=0;await assert.rejects(()=>inspectTelegramTarget('https://service.test','key',{username},async()=>{calls++;}),e=>e.status===400);assert.equal(calls,0);}
});
test('completed target command reuses receipt before external reads; current permission is still checked in DB',async()=>{
 let inspected=0;const receipt={ok:true,target:{...observation,brand_id:id},replayed:true};assert.deepEqual(await verifyContentTarget({query:async()=>[{result:receipt}]},input,'actor',['content.approve'],async()=>{inspected++;}),receipt);assert.equal(inspected,0);
 await assert.rejects(()=>actContentWorkflow({query:async()=>{throw Object.assign(Error('content_forbidden'),{code:'42501'});}},'target',input,'actor',['*'],null,null,async()=>{inspected++;}),e=>e.status===403);assert.equal(inspected,0);
});
test('prepare is authoritative and only server-side inspection observation reaches completion',async()=>{
 const calls=[];const target={...observation,brand_id:id};const out=await verifyContentTarget({query:async(q,p)=>{calls.push(p);return[{result:calls.length===1?{ok:true,verification_required:true,snapshot:{username:input.username,brand_id:id}}:{ok:true,target}}];}},input,'actor',['content.approve'],async snapshot=>{assert.equal(snapshot.username,input.username);return observation;});
 assert.deepEqual(out.target,target);assert.equal(calls[0][3],null);assert.deepEqual(JSON.parse(calls[1][3]),observation);assert.deepEqual(JSON.parse(calls[1][0]),input);
});
test('failed or misbound inspections do not persist a success',async()=>{
 let calls=0;await assert.rejects(()=>verifyContentTarget({query:async()=>{calls++;return[{result:{ok:true,verification_required:true,snapshot:{username:'other_channel',brand_id:id}}}];}},input,'actor',['*'],async()=>observation),e=>e.status===503);assert.equal(calls,1);
 calls=0;await assert.rejects(()=>verifyContentTarget({query:async()=>{calls++;return[{result:{ok:true,verification_required:true,snapshot:{username:input.username,brand_id:id}}}];}},input,'actor',['*'],async()=>{throw Error('rights missing');}),/rights missing/);assert.equal(calls,1);
});
test('target API rejects browser observations, malformed identity/version and insufficient permission before DB access',async()=>{
 for(const bad of [{...input,can_post_messages:true},{...input,chat_id:observation.chat_id},{...input,brand_id:undefined},{...input,id},{...input,expected_version:1},{...input,username:'@public_channel'}])assert.throws(()=>contentInput('target',bad));
 assert.deepEqual(contentInput('target',{...input,id,expected_version:1}),{...input,id,expected_version:1});let calls=0;await assert.rejects(()=>actContentWorkflow({query:()=>{calls++;}},'target',input,'actor',['content.edit']),e=>e.status===403);assert.equal(calls,0);
});
test('target read is bounded and does not expose secret configuration',async()=>{
 const queries=[];const out=await readContentWorkflow({query:async(q)=>{queries.push(q);return q.includes('pcs.content_targets')?Array.from({length:101},()=>({id})):[];}});assert.equal(out.targets.length,100);assert.equal(out.targets_truncated,true);assert.match(queries[2],/limit 101/);assert.doesNotMatch(queries[2],/secret|token|\*/i);
});
