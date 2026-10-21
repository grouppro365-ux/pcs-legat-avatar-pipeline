import test from 'node:test';import assert from 'node:assert/strict';
import {analyzeContentDuplicates,validateDuplicateResult,checkContentDuplicates} from '../server/supabase/pcs-manager-live2/content-duplicates.mjs';
import {actContentWorkflow,contentInput} from '../server/supabase/pcs-manager-live2/content-workflow.mjs';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',input={id,expected_version:3,request_id:id};
const snapshot={candidate:{post_id:id,body:'Only current facts'},corpus:[{post_id:other,body:'Previous full body',language:'th'}],corpus_truncated:true,snapshot_signature:'signature'};
const result={outcome:'POSSIBLE_DUPLICATE',matches:[{post_id:other,reason:'Одинаковое предложение и смысл'}],note:'Проверены только указанные материалы'};
test('semantic model uses the existing provider and exact authoritative full texts as untrusted data',async()=>{
 let sent,calls=0;const out=await analyzeContentDuplicates('https://service.test','key',snapshot,async(url,init)=>{if(url.includes('pcs_settings'))return Response.json([{openrouter_model:'synthetic'}]);if(url.includes('pcs_secret_get'))return Response.json('synthetic-secret');calls++;sent=JSON.parse(init.body);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]});});
 assert.equal(calls,1);assert.equal(out.method,'AI_SEMANTIC_COMPARISON');assert.deepEqual(JSON.parse(sent.messages[1].content).corpus,snapshot.corpus);assert.match(sent.messages[0].content,/untrusted data/);assert.match(sent.messages[0].content,/translations/);assert.equal(sent.messages[1].content.includes('synthetic-secret'),false);
});
test('semantic output rejects invented IDs, duplicate IDs, contradictory outcomes and oversized/unknown fields',()=>{
 for(const bad of [null,[],{...result,matches:[{post_id:id,reason:'Candidate is not corpus'}]},{...result,matches:[...result.matches,...result.matches]},{...result,outcome:'NO_SIMILARITY_FOUND'},{...result,matches:[]},{...result,note:'x'.repeat(1001)},{...result,approved:true},{...result,matches:[{...result.matches[0],reason:'short'}]}])assert.throws(()=>validateDuplicateResult(bad,snapshot),e=>e.status===502);
});
test('truncated or malformed AI result cannot clear the check and never retries paid call',async()=>{
 for(const choice of [{finish_reason:'length',message:{content:JSON.stringify(result)}},{finish_reason:'stop',message:{content:'```json\n{}\n```'}}]){let paid=0;await assert.rejects(()=>analyzeContentDuplicates('https://service.test','key',snapshot,async url=>url.includes('pcs_settings')?Response.json([{openrouter_model:'test'}]):url.includes('pcs_secret_get')?Response.json('secret'):(paid++,Response.json({choices:[choice]}))),e=>e.status===502);assert.equal(paid,1);}
});
test('completed or unresolved receipts cannot trigger another paid call',async()=>{
 for(const prepared of [{ok:true,id,version:4,replayed:true},{ok:true,pending:true,id}]){let calls=0,paid=0;const run=()=>checkContentDuplicates({query:async()=>{calls++;return[{result:prepared}];}},input,'staff',['content.approve'],async()=>{paid++;return result;});if(prepared.pending)await assert.rejects(run,e=>e.status===409);else assert.deepEqual(await run(),prepared);assert.equal(calls,1);assert.equal(paid,0);}
});
test('server completion binds the result to prepared snapshot and current revision rather than browser observations',async()=>{
 const queries=[];const out=await checkContentDuplicates({query:async(q,p)=>{queries.push(p);return[{result:queries.length===1?{ok:true,snapshot}:{ok:true,id,version:4}}];}},input,'actor',['content.approve'],async s=>{assert.equal(s,snapshot);return result;});
 assert.equal(out.version,4);assert.equal(queries.length,2);assert.deepEqual(JSON.parse(queries[0][0]),input);assert.equal(queries[0][3],null);assert.equal(JSON.parse(queries[1][0]).snapshot_signature,'signature');assert.equal(JSON.parse(queries[1][3]).method,'AI_SEMANTIC_COMPARISON');
});
test('empty corpus does not call a model or claim semantic clearance',async()=>{
 let calls=0,paid=0,saved;await checkContentDuplicates({query:async(q,p)=>{if(++calls===1)return[{result:{snapshot:{...snapshot,corpus:[],corpus_truncated:false}}}];saved=JSON.parse(p[3]);return[{result:{ok:true}}];}},input,'actor',['*'],async()=>{paid++;return result;});assert.equal(paid,0);assert.equal(saved.method,'EMPTY_CORPUS');assert.match(saved.note,/Оригинальность не подтверждена/);
});
test('permission and input validation precede model or DB work',async()=>{
 assert.throws(()=>contentInput('check-duplicates',{...input,result}),/поле/);assert.throws(()=>contentInput('approve',{...input,revision:1,facts_checked:true,duplicate_review_note:'x'.repeat(4001)}),/длину/);
 let calls=0;await assert.rejects(()=>actContentWorkflow({query:()=>{calls++;}},'check-duplicates',input,'actor',['content.edit'],null,()=>{calls++;}),e=>e.status===403);assert.equal(calls,0);
});
test('failed analyzer or stale completion never fabricates a successful check',async()=>{
 let calls=0;await assert.rejects(()=>checkContentDuplicates({query:async()=>{calls++;return[{result:{snapshot}}];}},input,'actor',['*'],async()=>{throw Error('provider failed');}),/provider failed/);assert.equal(calls,1);
 await assert.rejects(()=>actContentWorkflow({query:async()=>{throw Error('content_duplicate_stale');}},'check-duplicates',input,'actor',['*'],null,async()=>result),e=>e.status===409);
});
