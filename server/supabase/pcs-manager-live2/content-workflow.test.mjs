import {test} from 'node:test';import assert from 'node:assert/strict';import {contentInput,actContentWorkflow,readContentWorkflow} from './content-workflow.mjs';
const id='11111111-1111-4111-8111-111111111111',payload={request_id:id,brand_id:id,platform:'telegram',language:'ru',title:'Title',body:'Real draft',source_facts:'Confirmed real business facts',source_url:'https://example.com/source'};
test('content input rejects unknown fields and unbounded editor body',()=>{assert.throws(()=>contentInput('create',{...payload,approved:true}));assert.throws(()=>contentInput('create',{...payload,body:'x'.repeat(12001)}));assert.throws(()=>contentInput('create',{...payload,source_url:'javascript:alert(1)'}));assert.deepEqual(contentInput('create',payload),payload);});
test('approval is scoped separately and explicit current revision fact check required',async()=>{assert.throws(()=>contentInput('approve',{request_id:id,id,expected_version:2,revision:1,facts_checked:false}));let calls=0;await assert.rejects(()=>actContentWorkflow({query:()=>{calls++;}},'approve',{request_id:id,id,expected_version:2,revision:1,facts_checked:true},'staff',['content.edit']),/Недостаточно/);assert.equal(calls,0);});
test('AI generation is unsaved draft using authoritative persisted guidelines',async()=>{const b={...payload};delete b.request_id;delete b.body;let calls=0;const result=await actContentWorkflow({query:async()=>{calls++;return calls===1?[{id,name:'PCS',guidelines:'No guarantees',version:3}]:[];}},'generate',b,'staff',['content.edit'],async input=>{assert.equal(input.brand.version,3);return 'Generated draft';});assert.equal(calls,2);assert.equal(result.editorial_history.count,0);assert.equal(result.semantic_duplicate_check,'NOT_PERFORMED');assert.equal(result.status,'UNSAVED_DRAFT');assert.equal(result.requires_fact_check,true);});
test('unconnected AI route cannot fabricate a draft',async()=>{const b={...payload};delete b.request_id;delete b.body;await assert.rejects(()=>actContentWorkflow({},'generate',b,'staff',['content.edit']),/пока не подключена/);});
test('history pagination keeps selected post and separates history offset',async()=>{const queries=[];await readContentWorkflow({query:async(q,p)=>{queries.push([q,p]);return[];}},{id,page:2});assert.equal(queries[1][1][1],0);assert.equal(queries[3][1][1],40);});

test('schedule requires an explicit timezone',()=>{const base={request_id:id,id,expected_version:2};assert.throws(()=>contentInput('schedule',{...base,scheduled_at:'2099-01-01T12:30:00'}));assert.equal(contentInput('schedule',{...base,scheduled_at:'2099-01-01T12:30:00+03:00'}).scheduled_at,'2099-01-01T12:30:00+03:00');});

test('publication verification rejects client-supplied observations and requires approval permission before database work',async()=>{
 const b={request_id:id,id,expected_version:2};
 assert.throws(()=>contentInput('verify-publication',{...b,observation:{outcome:'TEXT_MATCH'}}));
 let calls=0;await assert.rejects(()=>actContentWorkflow({query:async()=>{calls++;}},'verify-publication',b,'staff',['content.view']),e=>e.status===403);assert.equal(calls,0);
 await assert.rejects(()=>actContentWorkflow({query:async()=>{throw Object.assign(Error('content_forbidden'),{code:'42501'});}},'verify-publication',b,'staff',['content.approve']),e=>e.status===403);
});

test('draft history uses current revisions in the exact brand/platform/language scope and reports its bounded coverage',async()=>{
 const b={brand_id:id,platform:'telegram',language:'ru',title:'New topic',source_facts:'Confirmed facts',source_url:'https://example.com'};
 const queries=[],recent=Array.from({length:21},(_,i)=>({id:'post-'+i,status:'DRAFT',body_excerpt:'Prior text '+i}));
 const result=await actContentWorkflow({query:async(q,p)=>{queries.push([q,p]);return queries.length===1?[{id,name:'PCS',version:3}]:recent;}},'generate',b,'staff',['content.edit'],async input=>{
  assert.equal(input.editorial_history.items.length,20);assert.equal(input.editorial_history.items[0].status,'DRAFT');assert.equal(input.editorial_history.items[19].id,'post-19');return 'New draft';
 });
 assert.deepEqual(queries[1][1],[id,'telegram','ru']);
 assert.match(queries[1][0],/order by revision desc limit 1/);assert.match(queries[1][0],/left\(r.body,1200\)/);assert.match(queries[1][0],/p.brand_id=\$1::uuid and r.platform=\$2 and r.language=\$3/);
 assert.deepEqual(result.editorial_history,{count:20,limit:20,truncated:true,scope:'brand_platform_language'});
 assert.equal(result.semantic_duplicate_check,'NOT_PERFORMED');assert.equal(result.status,'UNSAVED_DRAFT');
});
test('history read failure stops generation instead of silently implying history was considered',async()=>{
 const b={brand_id:id,platform:'telegram',language:'ru',title:'Topic',source_facts:'Facts',source_url:'https://example.com'};let queries=0,generated=false;
 await assert.rejects(()=>actContentWorkflow({query:async()=>{if(++queries===1)return[{id}];throw Error('database unavailable');}},'generate',b,'staff',['content.edit'],async()=>{generated=true;return 'draft';}),/database unavailable/);
 assert.equal(generated,false);
});
