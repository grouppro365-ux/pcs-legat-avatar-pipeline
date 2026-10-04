import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceUsername,parsePublicPage,validateClassifications,classifyPublicMessages} from '../server/supabase/pcs-manager-live2/prospect-policy.mjs';
const now=Date.parse('2026-10-04T15:00:00Z');
const message={id:'42',text:'Нужна машина в аренду в Паттайе. Бюджет 15000 бат.',published_at:'2026-10-04T14:00:00Z',message_url:'https://t.me/test_channel/42',forwarded:false};
const result={id:'42',decision:'qualified',direction:'CAR_RENTAL',confidence:0.95,evidence:'Нужна машина в аренду',reason:'Автор ищет аренду автомобиля',language:'ru',city:'Паттайе',budget:'15000 бат',dates:null};
import {publicFixture} from './helpers/prospect-fixture.mjs';
test('public source normalization blocks non-Telegram URLs, private invites, messages and query injection',()=>{
 for(const v of ['@Test_Channel','https://t.me/s/Test_Channel','https://t.me/Test_Channel/'])assert.equal(sourceUsername(v),'test_channel');
 for(const v of ['https://evil.invalid/a','https://t.me/+private','https://t.me/test_channel/42','https://t.me/test_channel?before=1','foo/../bar',null,'https://t.me/share'])assert.throws(()=>sourceUsername(v),e=>e.status===400);
});
test('public parser binds source ids, dates, forward provenance, html entities and one record per message',()=>{
 const p=parsePublicPage(publicFixture([message,{...message,id:'43',text:'Ищу &lt;авто&gt;<br>на неделю',forwarded:true},message]),'test_channel');assert.equal(p.messages.length,2);assert.equal(p.messages[1].text,'Ищу <авто>\nна неделю');assert.equal(p.messages[1].forwarded,true);assert.equal(p.messages[0].message_url,message.message_url);
 assert.equal(parsePublicPage(publicFixture([message]),'other_channel').readable,false);assert.equal(parsePublicPage('<h1>Join group</h1>','test_channel').readable,false);
});
test('only explicit high-confidence quoted evidence qualifies; facts cannot be hallucinated and authors stay unverified',()=>{
 const good=validateClassifications([message],{results:[result]},now)[0];assert.equal(good.decision,'qualified');assert.equal(good.outreach_status,'blocked_identity');assert.deepEqual(good.facts,{city:'Паттайе',budget:'15000 бат',language:'ru'});
 for(const change of [{confidence:0.6},{evidence:'Хочу купить квартиру'},{direction:null}])assert.equal(validateClassifications([message],{results:[{...result,...change}]},now)[0].decision,'review');
 const facts=validateClassifications([message],{results:[{...result,city:'Phuket',budget:'20000',dates:'2026-12-01'}]},now)[0].facts;assert.deepEqual(facts,{language:'ru'});
});
test('unknown/old/future time and forwarded requests cannot bypass source/author review',()=>{
 for(const change of [{published_at:null},{published_at:'2026-09-01T12:00:00Z'},{published_at:'2026-10-06T12:00:00Z'},{forwarded:true}])assert.equal(validateClassifications([{...message,...change}],{results:[result]},now)[0].decision,'review');
});
test('missing or duplicated ids, invented directions and malformed confidence reject the full model batch',()=>{
 for(const data of [{results:[]},{results:[{...result,id:'other'}]},{results:[{...result,direction:'PROPERTY_RENTAL'}]},{results:[{...result,confidence:1.2}]}])assert.throws(()=>validateClassifications([message],data,now),/ai_invalid_response/);
 assert.throws(()=>validateClassifications([message,{...message,id:'43'}],{results:[result,result]},now),/ai_invalid_response/);
});
test('OpenRouter receives messages as untrusted user data and never a Telegram send',async()=>{
 let call;const out=await classifyPublicMessages([message],{openrouter_model:'existing/model'},'private-key',async(url,init)=>{call={url,init};return Response.json({choices:[{message:{content:JSON.stringify({results:[result]})}}]})},now);
 assert.equal(call.url,'https://openrouter.ai/api/v1/chat/completions');assert.equal(call.init.headers.authorization,'Bearer private-key');const request=JSON.parse(call.init.body);assert.equal(request.model,'existing/model');assert.match(request.messages[0].content,/недоверенные данные/);assert.equal(JSON.parse(request.messages[1].content).messages[0].text,message.text);assert.equal(out[0].outreach_status,'blocked_identity');
 for(const [response,code] of [[new Response('',{status:429}),'ai_rate_limited'],[Response.json({choices:[]}),'ai_invalid_response']])await assert.rejects(()=>classifyPublicMessages([message],{openrouter_model:'model'},'key',async()=>response,now),new RegExp(code));
});

test('partial 2-of-10 model response repairs only eight missing ids and requires keyed schema coverage',async()=>{
 const messages=Array.from({length:10},(_,i)=>({...message,id:String(i+1)}));let calls=0;
 const out=await classifyPublicMessages(messages,{openrouter_model:'model'},'key',async(url,init)=>{
  calls++;const request=JSON.parse(init.body),input=JSON.parse(request.messages[1].content).messages;
  assert.deepEqual(request.response_format.json_schema.schema.properties.results.required,input.map(m=>m.id));
  assert.equal(input.length,calls===1?10:8);
  const selected=calls===1?input.slice(0,2):input;
  const results=Object.fromEntries(selected.map(m=>[m.id,{...result,id:m.id}]));
  return Response.json({choices:[{message:{content:JSON.stringify({results})}}]});
 },now);
 assert.equal(calls,2);assert.equal(out.length,10);assert.equal(new Set(out.map(x=>x.id)).size,10);
});
test('still-incomplete repair cannot be promoted to a completed page; retries are bounded',async()=>{
 let calls=0;
 await assert.rejects(()=>classifyPublicMessages([message,{...message,id:'43'}],{openrouter_model:'model'},'key',async()=>{
  calls++;return Response.json({choices:[{message:{content:JSON.stringify({results:calls===1?[result]:[]})}}]});
 },now),/ai_invalid_response/);
 assert.equal(calls,2);
});
test('key/id mismatch and duplicate repair output fail validation without fabricated decisions',async()=>{
 for(const results of [{'42':{...result,id:'43'}},[result,result]])await assert.rejects(()=>classifyPublicMessages([message],{openrouter_model:'model'},'key',async()=>Response.json({choices:[{message:{content:JSON.stringify({results})}}]}),now),/ai_invalid_response/);
});
