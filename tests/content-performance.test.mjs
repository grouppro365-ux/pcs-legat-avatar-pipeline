import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {parseTelegramViews,widgetViews,observeTelegramPerformance,observeContentPerformance} from '../server/supabase/pcs-manager-live2/content-performance.mjs';
import {contentInput,actContentWorkflow,readContentWorkflow} from '../server/supabase/pcs-manager-live2/content-workflow.mjs';
const id='abcd0000-0000-4000-8000-000000000001',request='20000000-0000-4000-8000-000000000001';
const body='Café & PCS',url='https://t.me/test_channel/42';
const snapshot={body,publication_url:url,snapshot_signature:'a'.repeat(32)};
const widget=(count,post='test_channel/42',text='Cafe&#769; &amp; PCS')=>`<div data-post="${post}" class="tgme_widget_message"><div class="tgme_widget_message_text">${text}</div><span class="tgme_widget_message_views">${count}</span><time datetime="2026-10-30T01:02:03Z"></time></div>`;
const observe=(page,options={})=>observeTelegramPerformance(snapshot,{fetcher:async()=>new Response(page),...options});
test('counter parser preserves exact int64 strings and never turns compact display into exact count',()=>{
 for(const count of ['0','42','9007199254740993','9223372036854775807'])assert.deepEqual(parseTelegramViews(count),{display:count,exact:count,estimate:null,approximate:false});
 for(const [display,estimate] of [['1K','1000'],['1.2K','1200'],['1.23K','1230'],['0.01K','10'],['1.23M','1230000'],['0K','0']])assert.deepEqual(parseTelegramViews(display),{display,exact:null,estimate,approximate:true});
 for(const value of [null,0,[],{},'',' ','01','-1','1,234','1 234','1.2','1e3','1k','1B','1.234K','Infinity','NaN','1\u200b','1\u202e','<img src=x>','9223372036854775808','9223372036854775807K'])assert.equal(parseTelegramViews(value),null,String(value));
});
test('counter detection uses an exact class token and rejects missing, duplicated or nested/unsupported displays',()=>{
 assert.equal(widgetViews('<span class="other_tgme_widget_message_views">12</span>').reason,'counter_missing');
 assert.equal(widgetViews('<span data-x="1" class=\'other tgme_widget_message_views\'> 12 </span>').views.exact,'12');
 assert.equal(widgetViews('<span class="tgme_widget_message_views">12</span>'.repeat(2)).reason,'counter_ambiguous');
 for(const display of ['','&nbsp;','<b>12</b>','12<script>0</script>','12 views'])assert.equal(widgetViews(`<span class="tgme_widget_message_views">${display}</span>`).reason,'counter_unreadable');
});
test('one fetch binds an observed count to the same exact message widget and approved text hash',async()=>{
 let fetches=0;const result=await observeTelegramPerformance(snapshot,{fetcher:async(target,options)=>{fetches++;assert.equal(target,'https://t.me/s/test_channel?before=43');assert.equal(options.redirect,'manual');return new Response(widget('0')+widget('999K','test_channel/43'));}});
 assert.equal(fetches,1);assert.equal(result.outcome,'OBSERVED');assert.equal(result.reason,'counter_observed');assert.equal(result.views.exact,'0');assert.equal(result.expected_sha256,result.observed_sha256);assert.equal(result.message_id,'42');assert.equal(result.snapshot_signature,snapshot.snapshot_signature);assert.equal(Object.keys(result).length,12);assert.equal(JSON.stringify(result).includes('Café'),false);assert.equal(JSON.stringify(result).includes('<div'),false);
});
test('changed text, missing/duplicate counter and unrelated or hidden widgets remain unavailable rather than zero',async()=>{
 const cases=[[widget('99',undefined,'Different body'),'text_mismatch'],[widget('12').replace(/<span[\s\S]*?<\/span>/,''),'counter_missing'],[widget('12').replace('</span>','</span><span class="tgme_widget_message_views">13</span>'),'counter_ambiguous'],[widget('1B'),'counter_unreadable'],[widget('99','test_channel/43'),'message_missing'],['<!--'+widget('99')+'-->','message_missing'],['<script>'+widget('99')+'</script>','message_missing'],[widget('12')+widget('13'),'ambiguous_message']];
 for(const [page,reason]of cases){const result=await observe(page);assert.equal(result.outcome,'UNAVAILABLE',reason);assert.equal(result.reason,reason);assert.equal(result.views,null);}
});
test('fixed-host fetch refuses redirects, HTTP errors, oversize bodies and timeouts without raw provider errors',async()=>{
 const redirect=await observe('',{fetcher:async()=>new Response(null,{status:302,headers:{location:'https://private.example'}})});assert.equal(redirect.reason,'redirect_refused');
 const failure=await observe('',{fetcher:async()=>new Response('secret',{status:500})});assert.equal(failure.reason,'page_unavailable');
 assert.equal((await observe(widget('99'),{maxBytes:32})).reason,'page_too_large');
 const timeout=await observe('',{timeoutMs:1,fetcher:async(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('private service message'))))});assert.equal(timeout.reason,'fetch_timeout');assert.equal(JSON.stringify(timeout).includes('private service'),false);
 let fetches=0;await assert.rejects(()=>observeTelegramPerformance({...snapshot,publication_url:'https://evil.test/test/42'},{fetcher:()=>fetches++}));await assert.rejects(()=>observeTelegramPerformance({...snapshot,snapshot_signature:null},{fetcher:()=>fetches++}));assert.equal(fetches,0);
});
test('API rejects client-supplied evidence or missing permission before database/network work',async()=>{
 const input={id,request_id:request,expected_version:1};
 assert.deepEqual(contentInput('observe-performance',input),input);
 for(const patch of [{views:{exact:'999'}},{publication_url:url},{snapshot_signature:'a'.repeat(32)},{id:[id]},{request_id:[request]},{expected_version:1000000000}])assert.throws(()=>contentInput('observe-performance',{...input,...patch}));
 let calls=0;await assert.rejects(()=>actContentWorkflow({query:async()=>{calls++;}},'observe-performance',input,'actor',['content.edit']),e=>e.status===403);assert.equal(calls,0);
});
test('capability follows the installed SQL function, history is bounded, and legacy schemas never query its absent table',async()=>{
 for(const available of [false,true,'true']){const calls=[];const out=await readContentWorkflow({query:async(q,p)=>{calls.push({q,p});if(q.includes('to_regprocedure'))return[{available}];if(q.includes('performance_observations'))return Array.from({length:21},(_,i)=>({evidence:{sequence:i}}));return[];}},{id});
 assert.equal(out.capabilities.performance?.version,available===true?1:undefined);assert.equal(out.performance_history.length,available===true?20:0);assert.equal(out.performance_history_truncated,available===true);assert.equal(calls.some(c=>c.q.includes('performance_observations')),available===true);if(available===true)assert.deepEqual(calls.at(-1).p,[id]);}
});
test('stored command replay avoids fetching and SQL unavailability has a fixed recoverable error',async()=>{
 let fetched=0;const options={fetcher:()=>{fetched++;throw Error('should not fetch');}};
 const old={ok:true,replayed:true,id,observation:{outcome:'UNAVAILABLE'}};const out=await observeContentPerformance({query:async()=>[{result:old}]},{id,request_id:request,expected_version:1},'actor',['*'],options);assert.deepEqual(out,old);assert.equal(fetched,0);
 await assert.rejects(()=>observeContentPerformance({query:async()=>{throw Object.assign(Error('private SQL'),{code:'42883'});}},{id},'actor',['*'],options),e=>e.status===503&&!e.message.includes('private SQL'));
});
test('actual observer and production SQL commit/replay/stale completion work together on offline PostgreSQL',{timeout:30000},async()=>{
 const db=new PGlite();
 try{
  await db.exec(`CREATE SCHEMA pcs;CREATE TABLE pcs.content_posts(id uuid primary key,version integer,status text,approved_revision integer,brand_id uuid,publication_url text,updated_at timestamptz);CREATE TABLE pcs.content_revisions(post_id uuid,revision integer,brand_version integer,platform text,body text);CREATE TABLE pcs.content_commands(request_id uuid primary key,payload jsonb not null,result jsonb not null);CREATE TABLE audit_events(actor_role text,action text,entity_type text,entity_id text,patch jsonb,result text);CREATE FUNCTION pcs.staff_context(uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"permissions":["content.approve"]}'::jsonb$$;INSERT INTO pcs.content_posts VALUES('${id}',1,'PUBLICATION_REPORTED',1,'40000000-0000-4000-8000-000000000001','${url}',now());INSERT INTO pcs.content_revisions VALUES('${id}',1,2,'telegram','${body}');`);
  await db.exec(readFileSync(new URL('../server/sql/pcs_content_performance.sql',import.meta.url),'utf8'));
  const biz={query:async(q,p)=>(await db.query(q,p)).rows};let version=1,sequence=0,fetches=0;
  for(const count of ['0','1.2K','9223372036854775807','1,234']){
   const command={id:id.toUpperCase(),request_id:`50000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`,expected_version:version};
   const options={fetcher:async()=>{fetches++;return new Response(widget(count));}};
   const result=await observeContentPerformance(biz,command,'pcs-manager-admin',['content.approve'],options);
   assert.equal(result.status,'PUBLICATION_REPORTED');assert.equal(result.observation.revision,1);assert.equal(result.observation.outcome,parseTelegramViews(count)?'OBSERVED':'UNAVAILABLE');assert.deepEqual(result.observation.views,parseTelegramViews(count));version=result.version;
   const before=fetches,replay=await observeContentPerformance(biz,command,'pcs-manager-admin',['content.approve'],options);assert.equal(replay.replayed,true);assert.equal(fetches,before);
  }
  assert.equal((await db.query('select count(*)::int n from pcs.content_performance_observations')).rows[0].n,4);
  const command={id,request_id:'60000000-0000-4000-8000-000000000001',expected_version:version};
  await assert.rejects(()=>observeContentPerformance(biz,command,'pcs-manager-admin',['*'],{fetcher:async()=>{await db.query('update pcs.content_posts set version=version+1 where id=$1::uuid',[id]);return new Response(widget('99'));}}),e=>e.code==='40001');
  assert.equal((await db.query('select count(*)::int n from pcs.content_performance_observations')).rows[0].n,4);
 }finally{await db.close();}
});
