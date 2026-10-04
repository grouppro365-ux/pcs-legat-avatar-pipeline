import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyReviewProspects,saveReviewClassifications} from '../server/supabase/pcs-manager-live2/prospect-engine.mjs';
import {publicFixture} from './helpers/prospect-fixture.mjs';
const published=new Date().toISOString();
function fixture(){
 const calls=[],record={id:'record-uuid',telegram_message_id:'42',message_url:'https://t.me/test_channel/42',published_at:published,message_text:'Нужна машина',username:'test_channel'};
 const sql={query:async(q,p)=>{calls.push({q,p});if(q.startsWith('select value'))return[{value:{enabled:true}}];if(q.startsWith('select r.id'))return[record];if(q===saveReviewClassifications)return[{id:record.id,decision:'review'}];return[];}};
 return{sql,calls,record};
}
test('review classification re-reads source provenance and saves only the original reviewed record with an audit',async()=>{
 const h=fixture();const result=await classifyReviewProspects(h.sql,async()=>({model:'test-model',classify:async messages=>{assert.equal(messages[0].forwarded,true);assert.equal(messages[0].id,h.record.id);return messages.map(m=>({...m,decision:'review',direction:'CAR_RENTAL',reason:'Переслано',evidence:'Нужна машина',facts:{},outreach_status:'blocked_identity'}));}}),{transport:async(url,options)=>{assert.equal(url,'https://t.me/s/test_channel?before=43');assert.equal(options.redirect,'manual');return new Response(publicFixture([{id:'42',text:h.record.message_text,published_at:published,forwarded:true}]));}});
 assert.equal(result.classified,1);assert.equal(result.review,1);assert.equal(result.outreach_sent,0);
 const saved=h.calls.find(c=>c.q===saveReviewClassifications);assert.match(saved.q,/r.message_text=x.message_text/);assert.match(saved.q,/qualification_model='local-review-only'/);assert.match(saved.q,/audit_logs/);assert.equal(JSON.parse(saved.p[0])[0].id,h.record.id);
 assert.ok(!h.calls.some(c=>/cursor_id=|insert into contacts|insert into conversations/.test(c.q)));
});
test('changed or unavailable public messages are not classified from stale stored text',async()=>{
 const h=fixture();const result=await classifyReviewProspects(h.sql,()=>assert.fail('stale AI call'),{transport:async()=>new Response(publicFixture([{id:'42',text:'Changed',published_at:published}]))});assert.equal(result.classified,0);assert.ok(!h.calls.some(c=>c.q===saveReviewClassifications));
 const other=fixture();await assert.rejects(()=>classifyReviewProspects(other.sql,()=>assert.fail('unavailable AI call'),{transport:async()=>new Response('',{status:302})}),/public_history_unavailable/);assert.ok(!other.calls.some(c=>c.q===saveReviewClassifications));
});
test('classifier failure leaves review records intact',async()=>{
 const h=fixture();await assert.rejects(()=>classifyReviewProspects(h.sql,async()=>({classify:async()=>{throw Error('ai_invalid_response')}}),{transport:async()=>new Response(publicFixture([{id:'42',text:h.record.message_text,published_at:published}]))}),/ai_invalid_response/);assert.ok(!h.calls.some(c=>c.q===saveReviewClassifications));
});
