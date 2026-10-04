import test from 'node:test';
import assert from 'node:assert/strict';
import {scanProspects,claimProspectSources,saveProspectPage,readProspecting,addProspectSource} from '../server/supabase/pcs-manager-live2/prospect-engine.mjs';
import {publicFixture} from './helpers/prospect-fixture.mjs';
const instant=Date.parse('2026-10-04T15:00:00Z');
function fixture(sources=[{id:'source',username:'test_channel',cursor_id:0}]){
 const calls=[];const sql={query:async(q,p)=>{calls.push({q,p});if(q.includes("select value from system_settings"))return[{value:{enabled:true}}];if(q===claimProspectSources)return sources;if(q.startsWith('select telegram_message_id'))return[];if(q===saveProspectPage)return[{saved:JSON.parse(p[2]).length,source_saved:1}];return[]}};
 const ai=()=>({model:'model',classify:async messages=>messages.map(m=>({...m,decision:'rejected',direction:null,reason:'Реклама',evidence:null,facts:{},outreach_status:'not_applicable'}))});return{sql,calls,ai};
}
test('scan persists classified records and cursor only in the guarded audited statement, with no sends',async()=>{
 const h=fixture(),msg={id:'42',text:'Сдаём автомобили',published_at:'2026-10-04T14:00:00Z'};
 const out=await scanProspects(h.sql,h.ai,{transport:async(url,init)=>{assert.equal(url,'https://t.me/s/test_channel');assert.equal(init.redirect,'manual');return new Response(publicFixture([msg]))},now:()=>instant});
 assert.equal(out.messages_read,1);assert.equal(out.rejected,1);assert.equal(out.outreach_sent,0);const saved=h.calls.find(x=>x.q===saveProspectPage);assert.equal(saved.p[6],42);assert.equal(saved.p[7],null);assert.match(saved.q,/lease_id=\$2 for update/);assert.match(saved.q,/audit_logs/);assert.equal(JSON.parse(saved.p[2])[0].outreach_status,'not_applicable');
});
test('unavailable groups do not become readable or invoke AI, and AI errors cannot advance the cursor',async()=>{
 const h=fixture();const a=await scanProspects(h.sql,()=>assert.fail('AI called'),{transport:async()=>new Response('<h1>Join group</h1>'),now:()=>instant});assert.equal(a.errors,1);assert.equal(a.messages_read,0);assert.ok(!h.calls.some(x=>x.q===saveProspectPage));assert.equal(h.calls.find(x=>x.p?.[4]==='public_history_unavailable').p[2],'unavailable');
 const f=fixture();await scanProspects(f.sql,async()=>{throw Error('ai_not_configured')},{transport:async()=>new Response(publicFixture([{id:'42',text:'Нужна машина',published_at:'2026-10-04T14:00:00Z'}])),now:()=>instant});assert.ok(!f.calls.some(x=>x.q===saveProspectPage));assert.equal(f.calls.find(x=>x.p?.[4]==='ai_not_configured').p[2],'ai_error');
});
test('Telegram rate limiting stops the rest of the batch and releases remaining claims',async()=>{
 const h=fixture([{id:'s1',username:'test_channel',cursor_id:0},{id:'s2',username:'other_channel',cursor_id:0}]);let n=0;const out=await scanProspects(h.sql,h.ai,{transport:async()=>{n++;return new Response('',{status:429})}});assert.equal(n,1);assert.equal(out.sources_checked,1);assert.ok(h.calls.some(x=>x.q.includes("last_error='telegram_rate_limited' where lease_id=$1")));
});
test('history continuation records the fixed sweep top and advances no cursor until reaching its boundary',async()=>{
 const h=fixture(),messages=Array.from({length:20},(_,i)=>({id:String(i+101),text:'Advertisement',published_at:'2026-10-04T14:00:00Z'}));await scanProspects(h.sql,h.ai,{transport:async()=>new Response(publicFixture(messages)),now:()=>instant});const save=h.calls.find(x=>x.q===saveProspectPage);assert.equal(save.p[6],0);assert.equal(save.p[7],101);assert.equal(save.p[8],120);
});
test('source addition validates allowlist before DB writes and duplicate source does not create clients',async()=>{
 const h=fixture();await assert.rejects(()=>addProspectSource(h.sql,{username:'valid_channel',contact_id:'forged'}),e=>e.status===400);assert.equal(h.calls.length,0);await addProspectSource(h.sql,{username:'@Valid_Channel'});assert.equal(h.calls[0].p[1],'valid_channel');assert.match(h.calls[0].q,/on conflict\(username\) do nothing/);assert.doesNotMatch(h.calls[0].q,/insert into contacts|insert into conversations/);
});
test('read filters remain bound and do not expose keys or invent first-message capability',async()=>{
 const calls=[],sql={query:async(q,p)=>{calls.push({q,p});if(q.includes('select (select count'))return[{sources:3,sources_read:1}];return Array.from({length:51},(_,i)=>({id:String(i)}))}};const r=await readProspecting(sql,'requests','2','review');assert.equal(r.rows.length,50);assert.equal(r.truncated,true);assert.deepEqual(calls[0].p,['review',100]);assert.equal(r.capabilities.first_private_message,false);
 await assert.rejects(()=>readProspecting(sql,'fake','0','all'),e=>e.status===400);
});
