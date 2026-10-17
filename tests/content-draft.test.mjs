import test from 'node:test';import assert from 'node:assert/strict';
import {generateContentDraft} from '../server/supabase/pcs-manager-live2/content-draft.mjs';
const input={platform:'telegram',language:'th',title:'Source title',source_facts:'Only facts: 800 THB',source_url:'https://example.test/source',brand:{name:'PCS',guidelines:'Calm and accurate'}};
test('content generator uses existing provider and treats supplied brand/facts as untrusted data',async()=>{
 const calls=[];const transport=async(url,init)=>{calls.push({url,init});if(url.includes('pcs_settings'))return Response.json([{openrouter_model:'synthetic-model'}]);if(url.includes('pcs_secret_get'))return Response.json('synthetic-secret');return Response.json({choices:[{message:{content:'  Draft 800 THB  '}}]});};
 assert.equal(await generateContentDraft('https://service.test','synthetic-service-key',input,transport),'Draft 800 THB');
 assert.equal(calls.length,3);const sent=JSON.parse(calls.at(-1).init.body);assert.equal(sent.model,'synthetic-model');assert.match(sent.messages[0].content,/untrusted source data/);assert.match(sent.messages[0].content,/Never claim publication/);assert.equal(JSON.parse(sent.messages[1].content).language,'th');assert.equal(sent.messages[1].content.includes('synthetic-secret'),false);assert.equal(sent.messages[1].content.includes('synthetic-service-key'),false);
});
test('unavailable configuration never calls a model or invents a successful draft',async()=>{
 let calls=0;await assert.rejects(()=>generateContentDraft('https://service.test','key',input,async()=>{calls++;return new Response('',{status:503});}),e=>e.status===503);assert.equal(calls,2);
});
test('provider failure or unusable result remains an error without retrying a paid call',async()=>{
 for(const result of [new Response('',{status:429}),Response.json({choices:[{message:{content:42}}]})]){
 let modelCalls=0;await assert.rejects(()=>generateContentDraft('https://service.test','key',input,async url=>url.includes('pcs_settings')?Response.json([{openrouter_model:'synthetic'}]):url.includes('pcs_secret_get')?Response.json('synthetic'):(modelCalls++,result)),e=>e.status===502);assert.equal(modelCalls,1);
 }
});
