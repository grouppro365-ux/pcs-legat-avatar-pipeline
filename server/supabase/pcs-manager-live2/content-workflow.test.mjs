import {test} from 'node:test';import assert from 'node:assert/strict';import {contentInput,actContentWorkflow,readContentWorkflow} from './content-workflow.mjs';
const id='11111111-1111-4111-8111-111111111111',payload={request_id:id,brand_id:id,platform:'telegram',language:'ru',title:'Title',body:'Real draft',source_facts:'Confirmed real business facts',source_url:'https://example.com/source'};
test('content input rejects unknown fields and unbounded editor body',()=>{assert.throws(()=>contentInput('create',{...payload,approved:true}));assert.throws(()=>contentInput('create',{...payload,body:'x'.repeat(12001)}));assert.throws(()=>contentInput('create',{...payload,source_url:'javascript:alert(1)'}));assert.deepEqual(contentInput('create',payload),payload);});
test('approval is scoped separately and explicit current revision fact check required',async()=>{assert.throws(()=>contentInput('approve',{request_id:id,id,expected_version:2,revision:1,facts_checked:false}));let calls=0;await assert.rejects(()=>actContentWorkflow({query:()=>{calls++;}},'approve',{request_id:id,id,expected_version:2,revision:1,facts_checked:true},'staff',['content.edit']),/Недостаточно/);assert.equal(calls,0);});
test('AI generation is unsaved draft using authoritative persisted guidelines',async()=>{const b={...payload};delete b.request_id;delete b.body;let calls=0;const result=await actContentWorkflow({query:async()=>{calls++;return [{id,name:'PCS',guidelines:'No guarantees',version:3}];}},'generate',b,'staff',['content.edit'],async input=>{assert.equal(input.brand.version,3);return 'Generated draft';});assert.equal(calls,1);assert.equal(result.status,'UNSAVED_DRAFT');assert.equal(result.requires_fact_check,true);});
test('unconnected AI route cannot fabricate a draft',async()=>{const b={...payload};delete b.request_id;delete b.body;await assert.rejects(()=>actContentWorkflow({},'generate',b,'staff',['content.edit']),/пока не подключена/);});
test('history pagination keeps selected post and separates history offset',async()=>{const queries=[];await readContentWorkflow({query:async(q,p)=>{queries.push([q,p]);return[];}},{id,page:2});assert.equal(queries[1][1][1],0);assert.equal(queries[2][1][1],40);});

test('schedule requires an explicit timezone',()=>{const base={request_id:id,id,expected_version:2};assert.throws(()=>contentInput('schedule',{...base,scheduled_at:'2099-01-01T12:30:00'}));assert.equal(contentInput('schedule',{...base,scheduled_at:'2099-01-01T12:30:00+03:00'}).scheduled_at,'2099-01-01T12:30:00+03:00');});

test('publication verification rejects client-supplied observations and requires approval permission before database work',async()=>{
 const b={request_id:id,id,expected_version:2};
 assert.throws(()=>contentInput('verify-publication',{...b,observation:{outcome:'TEXT_MATCH'}}));
 let calls=0;await assert.rejects(()=>actContentWorkflow({query:async()=>{calls++;}},'verify-publication',b,'staff',['content.view']),e=>e.status===403);assert.equal(calls,0);
 await assert.rejects(()=>actContentWorkflow({query:async()=>{throw Object.assign(Error('content_forbidden'),{code:'42501'});}},'verify-publication',b,'staff',['content.approve']),e=>e.status===403);
});
