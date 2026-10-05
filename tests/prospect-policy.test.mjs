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

test('forwarded irrelevant news and advertisements remain rejected instead of creating review leads',()=>{
 for(const change of [{forwarded:true},{published_at:null},{forwarded:true,published_at:'2026-09-01T12:00:00Z'}]){
  const classified=validateClassifications([{...message,...change}],{results:[{...result,decision:'rejected',direction:null,evidence:null}]},now)[0];
  assert.equal(classified.decision,'rejected');assert.equal(classified.outreach_status,'not_applicable');
 }
});

// Seller listings must fail even when the external model confidently labels them as buyers.
const negativeDemandCases=[
 ['Совершенно новый кондик пентхаус на 8 этаже в Чалонг. В квартире есть: кухня, мебель. Цена 25000 бат. Контакт: Viktoria','PROPERTY_PURCHASE'],
 ['Вилла в комплексе Peykaa Estate. Площадь участка: 700 кв. м. 1 месяц: 500000 THB. Дополнительные фото по запросу.','PROPERTY_PURCHASE'],
 ['Аренда авто MG5 Pro. Страховка включена. Почему выбирают нас? Напишите нам для бронирования.','CAR_RENTAL'],
 ['Сдаются в аренду Тойота Виос. Стоимость от 9000 бат. Депозит 5000.','CAR_RENTAL'],
 ['Интересует длительная аренда байка на Пхукете? Официальный прокат. Модели в нашем парке.','CAR_RENTAL'],
 ['Ищете квартиру? Предлагаем купить кондо в Паттайе','PROPERTY_PURCHASE'],
 ['Ищу жильё на зимовку, сниму квартиру на месяц','PROPERTY_PURCHASE'],
 ['Looking for an apartment to rent in Phuket','PROPERTY_PURCHASE'],
 ['Ищу квартиру в Паттайе','PROPERTY_PURCHASE'],
 ['Хочу купить машину на Пхукете','CAR_RENTAL'],
 ['Нужен байк в аренду','CAR_RENTAL'],
 ['Уже нашли квартиру, больше не ищу купить кондо','PROPERTY_PURCHASE'],
 ['Condo for sale, contact us for viewing','PROPERTY_PURCHASE'],
 ['We offer car rental in Phuket. Book now','CAR_RENTAL'],
 ['Если нужна машина в аренду, пишите нам','CAR_RENTAL'],
 ['Ищете купить квартиру? У нас лучшие предложения','PROPERTY_PURCHASE'],
 ['На консультацию обратились клиенты. Хотят купить кондо','PROPERTY_PURCHASE']
];
for(const [text,direction] of negativeDemandCases)test('never qualifies supplier/out-of-scope: '+text.slice(0,65),()=>{
 const out=validateClassifications([{...message,text}],{results:[{...result,direction,evidence:text}]},now)[0];
 assert.notEqual(out.decision,'qualified');
});
const positiveDemandCases=[
 ['Хочу купить кондо в Джомтьене для сдачи в аренду','PROPERTY_PURCHASE'],
 ['Рассматриваем покупку квартиры на Пхукете','PROPERTY_PURCHASE'],
 ['Кто продаёт кондо? Ищу купить для себя','PROPERTY_PURCHASE'],
 ['Подскажите варианты для покупки квартиры','PROPERTY_PURCHASE'],
 ['Looking to buy a condo in Phuket','PROPERTY_PURCHASE'],
 ['I want to buy a house in Pattaya','PROPERTY_PURCHASE'],
 ['ต้องการซื้อคอนโดภูเก็ต','PROPERTY_PURCHASE'],
 ['Кто сдаёт авто на месяц на Пхукете?','CAR_RENTAL'],
 ['Посоветуйте прокат авто, прилетаем завтра','CAR_RENTAL'],
 ['Ищу семиместную машину в аренду','CAR_RENTAL'],
 ['Looking for a car to rent in Phuket','CAR_RENTAL'],
 ['We need a car to rent in Pattaya','CAR_RENTAL'],
 ['ต้องการเช่ารถยนต์ภูเก็ต','CAR_RENTAL']
];
for(const [text,direction] of positiveDemandCases)test('preserves explicit client demand: '+text,()=>{
 assert.equal(validateClassifications([{...message,text}],{results:[{...result,direction,evidence:text}]},now)[0].decision,'qualified');
});
test('a literal object description cannot be used as buyer evidence inside a genuine request',()=>{
 const text='Хочу купить кондо. Пентхаус на 8 этаже';
 assert.equal(validateClassifications([{...message,text}],{results:[{...result,direction:'PROPERTY_PURCHASE',evidence:'Пентхаус на 8 этаже'}]},now)[0].decision,'review');
});
