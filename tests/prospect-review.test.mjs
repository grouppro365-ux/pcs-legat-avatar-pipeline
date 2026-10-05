import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyReviewProspects,saveReviewClassifications} from '../server/supabase/pcs-manager-live2/prospect-engine.mjs';
import {publicFixture} from './helpers/prospect-fixture.mjs';
const published=new Date().toISOString();
function fixture(){
 const calls=[],record={id:'record-uuid',telegram_message_id:'42',message_url:'https://t.me/test_channel/42',published_at:published,updated_at:'2026-10-04 20:12:34.123456+00',message_text:'Нужна машина',username:'test_channel'};
 const sql={query:async(q,p)=>{calls.push({q,p});if(q.startsWith('select value'))return[{value:{enabled:true}}];if(q.startsWith('select r.id'))return[record];if(q===saveReviewClassifications)return[{id:record.id,decision:'review'}];return[];}};
 return{sql,calls,record};
}
test('review classification re-reads source provenance and saves only the original reviewed record with an audit',async()=>{
 const h=fixture();const result=await classifyReviewProspects(h.sql,async()=>({model:'test-model',classify:async messages=>{assert.equal(messages[0].forwarded,true);assert.equal(messages[0].id,h.record.id);return messages.map(m=>({...m,decision:'review',direction:'CAR_RENTAL',reason:'Переслано',evidence:'Нужна машина',facts:{},outreach_status:'blocked_identity'}));}}),{transport:async(url,options)=>{assert.equal(url,'https://t.me/s/test_channel?before=43');assert.equal(options.redirect,'manual');return new Response(publicFixture([{id:'42',text:h.record.message_text,published_at:published,forwarded:true}]));}});
 assert.equal(result.classified,1);assert.equal(result.review,1);assert.equal(result.outreach_sent,0);
 const saved=h.calls.find(c=>c.q===saveReviewClassifications);assert.match(saved.q,/r.message_text=x.message_text/);assert.match(saved.q,/r.updated_at=x.expected_updated_at/);assert.match(saved.q,/audit_logs/);assert.equal(JSON.parse(saved.p[0])[0].id,h.record.id);
 assert.equal(JSON.parse(saved.p[0])[0].expected_updated_at,h.record.updated_at);assert.match(h.calls.find(c=>c.q.startsWith('select r.id')).q,/r.updated_at::text updated_at/);
 assert.ok(!h.calls.some(c=>/cursor_id=|insert into contacts|insert into conversations/.test(c.q)));
});
test('changed or unavailable public messages are not classified from stale stored text',async()=>{
 const h=fixture();const result=await classifyReviewProspects(h.sql,()=>assert.fail('stale AI call'),{transport:async()=>new Response(publicFixture([{id:'42',text:'Changed',published_at:published}]))});assert.equal(result.classified,0);assert.ok(!h.calls.some(c=>c.q===saveReviewClassifications));
 const other=fixture();await assert.rejects(()=>classifyReviewProspects(other.sql,()=>assert.fail('unavailable AI call'),{transport:async()=>new Response('',{status:302})}),/public_history_unavailable/);assert.ok(!other.calls.some(c=>c.q===saveReviewClassifications));
});
test('classifier failure leaves review records intact',async()=>{
 const h=fixture();await assert.rejects(()=>classifyReviewProspects(h.sql,async()=>({classify:async()=>{throw Error('ai_invalid_response')}}),{transport:async()=>new Response(publicFixture([{id:'42',text:h.record.message_text,published_at:published}]))}),/ai_invalid_response/);assert.ok(!h.calls.some(c=>c.q===saveReviewClassifications));
});

test('policy rollout includes earlier qualified listings and re-reads every separated source page',async()=>{
 const h=fixture(),old={...h.record,id:'older',telegram_message_id:'12',message_text:'Сдаю авто'},other={...h.record,id:'earlier',telegram_message_id:'2',message_text:'Продаю квартиру'};
 const original=h.sql.query;h.sql.query=async(q,p)=>q.startsWith('select r.id')?(h.calls.push({q,p}),[h.record,old,other]):original(q,p);
 let reads=0;
 await classifyReviewProspects(h.sql,async()=>({model:'test-model',classify:async messages=>{assert.equal(messages.length,3);return messages.map(m=>({...m,decision:'rejected',direction:null,reason:'Реклама',facts:{},outreach_status:'not_applicable'}))}}),{transport:async url=>{reads++;const id=String(Number(new URL(url).searchParams.get('before'))-1),r=[h.record,old,other].find(x=>x.telegram_message_id===id);return new Response(publicFixture([{id,text:r.message_text,published_at:published}]));}});
 assert.equal(reads,3);assert.match(h.calls.find(c=>c.q.startsWith('select r.id')).q,/qualification_version is distinct from \$1/);assert.match(saveReviewClassifications,/qualification_version is distinct from \$3/);
});
