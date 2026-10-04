import test from 'node:test';
import assert from 'node:assert/strict';
import {internalProspectScan} from '../server/supabase/pcs-manager-live2/prospect-worker.mjs';
import {claimProspectSources} from '../server/supabase/pcs-manager-live2/prospect-engine.mjs';
const req=secret=>new Request('https://test.invalid?op=prospecting-worker',{method:'POST',headers:secret?{'x-pcs-internal-secret':secret}:{}});
test('internal scan requires the exact server-held secret and performs no SQL on failed authentication',async()=>{
 for(const supplied of [null,'wrong-secret']){
  const r=await internalProspectScan(req(supplied),{base:'https://existing.invalid',key:'service-test',op:{query:()=>assert.fail('unauthorized SQL')}},async()=>Response.json('expected-secret'));
  assert.equal(r.status,401);
 }
});
test('authenticated internal scan uses existing PCS config and source leases, with one source per invocation',async()=>{
 const queries=[],op={query:async(q,p)=>{queries.push({q,p});return q.includes('select value from system_settings')?[{value:{enabled:true}}]:[];}};
 const r=await internalProspectScan(req('expected-secret'),{base:'https://existing.invalid',key:'service-test',op},async()=>Response.json('expected-secret'));
 assert.equal(r.status,200);assert.equal(r.body.outreach_sent,0);
 assert.equal(queries.find(x=>x.q===claimProspectSources).p[1],1);
});
test('public-review scanner never loads AI credentials or sends source text to an external classifier',async()=>{
 const queries=[],op={query:async(q,p)=>{
  queries.push({q,p});if(q.includes('select value from system_settings'))return[{value:{enabled:true}}];
  if(q===claimProspectSources)return[{id:'source',username:'test_channel',cursor_id:0}];
  if(q.startsWith('with owner as'))return[{saved:1,source_saved:1}];return[];
 }};
 const {publicFixture}=await import('./helpers/prospect-fixture.mjs');
 const urls=[];
 const r=await internalProspectScan(new Request('https://test.invalid?mode=public-review',{method:'POST',headers:{'x-pcs-internal-secret':'expected-secret'}}),{base:'https://existing.invalid',key:'service-test',op},async(url,init)=>{
  urls.push(url);
  if(url.endsWith('/rpc/pcs_secret_get')){assert.equal(JSON.parse(init.body).p_name,'internal_retry_secret');return Response.json('expected-secret');}
  assert.equal(url,'https://t.me/s/test_channel');
  return new Response(publicFixture([{id:'42',text:'Public message',published_at:new Date().toISOString()}]));
 });
 assert.equal(r.status,200);assert.equal(r.body.review,1);assert.equal(r.body.outreach_sent,0);
 const saved=queries.find(x=>x.q.startsWith('with owner as'));
 assert.equal(JSON.parse(saved.p[2])[0].decision,'review');assert.equal(saved.p[3],'local-review-only');assert.equal(urls.length,2);
});
