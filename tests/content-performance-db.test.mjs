import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Executes the production migration on a minimal canonical fixture. This is a
// real offline PostgreSQL engine test, not a Neon integration test. staff_context
// is deliberately stubbed with a mutable permission source to test revocation.
const ID='10000000-0000-4000-8000-000000000001';
const ACTOR='20000000-0000-4000-8000-000000000001';
let seq=0;
const request=(version=1)=>({id:ID,request_id:`30000000-0000-4000-8000-${String(++seq).padStart(12,'0')}`,expected_version:version});
async function fixture(){
 const db=new PGlite();
 await db.exec(`CREATE SCHEMA pcs;
 CREATE TABLE pcs.content_posts(id uuid primary key,version integer,status text,approved_revision integer,brand_id uuid,publication_url text,updated_at timestamptz);
 CREATE TABLE pcs.content_revisions(post_id uuid,revision integer,brand_version integer,platform text,body text);
 CREATE TABLE pcs.content_commands(request_id uuid primary key,payload jsonb not null,result jsonb not null);
 CREATE TABLE audit_events(actor_role text,action text,entity_type text,entity_id text,patch jsonb,result text);
 CREATE TABLE pcs.test_permissions(value jsonb); INSERT INTO pcs.test_permissions VALUES('["content.approve"]');
 CREATE FUNCTION pcs.staff_context(uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('permissions',value) FROM pcs.test_permissions$$;
 INSERT INTO pcs.content_posts VALUES('${ID}',1,'PUBLICATION_REPORTED',1,'40000000-0000-4000-8000-000000000001','https://t.me/example/123',now());
 INSERT INTO pcs.content_revisions VALUES('${ID}',1,2,'telegram','Canonical approved text');`);
 await db.exec(await readFile(new URL('../server/sql/pcs_content_performance.sql',import.meta.url),'utf8'));
 const call=async(p,e=null,actor=ACTOR,permissions=['*'])=>(await db.query('SELECT pcs.content_observe_performance($1::jsonb,$2,$3::jsonb,$4::jsonb) AS result',[JSON.stringify(p),actor,JSON.stringify(permissions),e===null?null:JSON.stringify(e)])).rows[0].result;
 const evidence=async(p,patch={})=>({method:'public_telegram_views_v1',outcome:'OBSERVED',reason:'counter_observed',publication_url:'https://t.me/example/123',fetch_url:'https://t.me/s/example?before=124',username:'example',message_id:'123',expected_sha256:'a'.repeat(64),observed_sha256:'a'.repeat(64),published_at:'2026-10-01T12:30:00Z',views:{display:'1.23K',exact:null,estimate:'1230',approximate:true},snapshot_signature:(await call(p)).snapshot.snapshot_signature,...patch});
 return {db,call,evidence};
}
const rejects=(promise,pattern=/content_performance_invalid/)=>assert.rejects(promise,pattern);

test('real SQL prepare, append history, replay, live authorization and immutable observations',async()=>{
 const {db,call,evidence}=await fixture();
 try{
  const p=request(); const prepared=await call(p);
  assert.equal(prepared.observation_required,true); assert.equal(prepared.snapshot.body,'Canonical approved text');
  assert.equal((await db.query('SELECT count(*)::int n FROM pcs.content_commands')).rows[0].n,0);
  const e=await evidence(p); const committed=await call(p,e);
  assert.equal(committed.version,2);assert.equal(committed.status,'PUBLICATION_REPORTED');
  assert.equal(committed.observation.views.estimate,'1230');assert.equal(committed.observation.actor,ACTOR);
  const replay=await call(p);assert.equal(replay.replayed,true);assert.equal(replay.version,2);
  for(const table of ['pcs.content_commands','pcs.content_performance_observations','audit_events']) assert.equal((await db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,1);
  await rejects(call({...p,id:'10000000-0000-4000-8000-000000000002'}),/content_request_conflict/);
  await rejects(call(p,null,'pcs-manager-admin'),/content_request_conflict/);
  await db.exec(`UPDATE pcs.test_permissions SET value='[]'`);
  await rejects(call(p),/content_forbidden/); // replays cannot bypass revoked permissions
  await rejects(call(request(2)),/content_forbidden/);
  await assert.rejects(db.exec(`UPDATE pcs.content_performance_observations SET actor='forged'`),/content_performance_immutable/);
  await assert.rejects(db.exec(`DELETE FROM pcs.content_performance_observations`),/content_performance_immutable/);
  await assert.rejects(db.exec(`TRUNCATE pcs.content_performance_observations`),/content_performance_immutable/);
 }finally{await db.close();}
});

test('real SQL rejects foreign targets, raw evidence, malformed types and forged counters',async()=>{
 const {db,call,evidence}=await fixture();
 try{
  const p=request(), e=await evidence(p);
  await rejects(call({...p,expected_version:'1'}));await rejects(call({...p,extra:true}));
  await rejects(call(p,{...e,html:'<b>raw</b>'}));await rejects(call(p,{...e,actor:'forged'}));
  await rejects(call(p,{...e,publication_url:'https://t.me/foreign/123'}));
  await rejects(call(p,{...e,fetch_url:'https://evil.example/'}));
  await rejects(call(p,{...e,message_id:'124'}));
  await rejects(call(p,{...e,snapshot_signature:'a'.repeat(32)}),/content_version_conflict/);
  for(const views of [
   {display:'1.23K',exact:null,estimate:'1231',approximate:true},
   {display:'123',exact:'124',estimate:null,approximate:false},
   {display:'9223372036854775808',exact:'9223372036854775808',estimate:null,approximate:false},
   {display:'9223372036854776K',exact:null,estimate:'9223372036854776000',approximate:true},
   {display:'01',exact:'01',estimate:null,approximate:false},
   {display:'1k',exact:null,estimate:'1000',approximate:true},
   {display:'1.234K',exact:null,estimate:'1234',approximate:true},
   {display:'1M',exact:null,estimate:1000000,approximate:true},
   {display:'123',exact:123,estimate:null,approximate:false},
   {display:'123',exact:'123',estimate:null,approximate:false,raw:'123'},
  ])await rejects(call(p,{...e,views}));
  assert.equal((await db.query('SELECT version FROM pcs.content_posts')).rows[0].version,1);
  assert.equal((await db.query('SELECT count(*)::int n FROM audit_events')).rows[0].n,0);
 }finally{await db.close();}
});

test('real SQL accepts int64 boundaries and precise abbreviation interpretation',async()=>{
 const {db,call,evidence}=await fixture();
 try{
  for(const [i,views] of [
   {display:'0',exact:'0',estimate:null,approximate:false},
   {display:'9223372036854775807',exact:'9223372036854775807',estimate:null,approximate:false},
   {display:'0.01M',exact:null,estimate:'10000',approximate:true},
   {display:'1K',exact:null,estimate:'1000',approximate:true},
  ].entries()){
   const p=request(i+1); const e=await evidence(p,{views});assert.deepEqual((await call(p,e)).observation.views,views);
  }
 }finally{await db.close();}
});

test('real SQL enforces reason/hash/null relationships and records unavailable observations',async()=>{
 const {db,call,evidence}=await fixture();
 try{
  const p=request(),e=await evidence(p);
  await rejects(call(p,{...e,outcome:'UNAVAILABLE',reason:'counter_missing'}));
  await rejects(call(p,{...e,outcome:'UNAVAILABLE',reason:'text_mismatch',views:null}));
  await rejects(call(p,{...e,outcome:'UNAVAILABLE',reason:'counter_missing',views:null,observed_sha256:'b'.repeat(64)}));
  await rejects(call(p,{...e,outcome:'UNAVAILABLE',reason:'page_unavailable',views:null}));
  await rejects(call(p,{...e,reason:'counter_missing'}));
  const missing={...e,outcome:'UNAVAILABLE',reason:'counter_missing',views:null};
  assert.equal((await call(p,missing)).observation.reason,'counter_missing');
  const p2=request(2), e2=await evidence(p2,{outcome:'UNAVAILABLE',reason:'text_mismatch',views:null,observed_sha256:'b'.repeat(64)});
  assert.equal((await call(p2,e2)).observation.reason,'text_mismatch');
  const p3=request(3),e3=await evidence(p3,{outcome:'UNAVAILABLE',reason:'fetch_timeout',views:null,observed_sha256:null,published_at:null});
  assert.equal((await call(p3,e3)).version,4);
 }finally{await db.close();}
});

test('real SQL prevents stale commit after body or version changes, and shares global command namespace',async()=>{
 const {db,call,evidence}=await fixture();
 try{
  const p=request(),e=await evidence(p);
  await db.exec(`UPDATE pcs.content_revisions SET body='Changed body'`);
  await rejects(call(p,e),/content_version_conflict/);
  const e2=await evidence(p);await db.exec('UPDATE pcs.content_posts SET version=2');
  await rejects(call(p,e2),/content_version_conflict/);
  const p2=request(2);
  await db.query('INSERT INTO pcs.content_commands VALUES($1,$2::jsonb,$3::jsonb)',[p2.request_id,JSON.stringify({action:'verify-publication',body:p2,actor:ACTOR}),JSON.stringify({ok:true})]);
  await rejects(call(p2),/content_request_conflict/);
  await db.exec(`UPDATE pcs.content_posts SET approved_revision=0`);
  await rejects(call(request(2)),/content_performance_requires_reported_current_approval/);
 }finally{await db.close();}
});

test('real SQL rolls back all observation writes on audit failure',async()=>{
 const {db,call,evidence}=await fixture();
 try{
  const p=request(),e=await evidence(p);
  await db.exec(`ALTER TABLE audit_events ADD CONSTRAINT fail CHECK(action<>'content.observe-performance')`);
  await assert.rejects(call(p,e),/fail/);
  assert.equal((await db.query('SELECT version FROM pcs.content_posts')).rows[0].version,1);
  for(const table of ['pcs.content_commands','pcs.content_performance_observations','audit_events'])assert.equal((await db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,0);
 }finally{await db.close();}
});


test('real SQL rejects unreported, non-Telegram and stale latest revisions',async()=>{
 const {db,call}=await fixture();
 try{
  await db.exec("UPDATE pcs.content_posts SET status='APPROVED'");
  await rejects(call(request()),/content_performance_requires_reported_current_approval/);
  await db.exec("UPDATE pcs.content_posts SET status='PUBLICATION_SENT'; UPDATE pcs.content_revisions SET platform='instagram'");
  await rejects(call(request()),/content_performance_requires_reported_current_approval/);
  await db.exec("UPDATE pcs.content_revisions SET platform='telegram'; INSERT INTO pcs.content_revisions VALUES('"+ID+"',2,2,'telegram','New unapproved revision')");
  await rejects(call(request()),/content_performance_requires_reported_current_approval/);
  await db.exec("UPDATE pcs.content_posts SET approved_revision=2");
  assert.equal((await call(request())).observation_required,true);
  await rejects(call({...request(),id:'10000000-0000-4000-8000-000000000099'}),/content_version_conflict/);
 }finally{await db.close();}
});
