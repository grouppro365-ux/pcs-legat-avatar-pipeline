import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {readContentWorkflow} from '../server/supabase/pcs-manager-live2/content-workflow.mjs';

// Actual production migrations on a minimal canonical offline fixture. READY
// media here is synthetic metadata, never evidence of GPU or social delivery.
const POST='10000000-0000-4000-8000-000000000001';
const BRAND='10000000-0000-4000-8000-000000000002';
const TARGET='10000000-0000-4000-8000-000000000003';
const VIDEO='10000000-0000-4000-8000-000000000004';
const CLAIM='10000000-0000-4000-8000-000000000005';
const ACTOR='10000000-0000-4000-8000-000000000006';
const HASH='a'.repeat(64);
let sequence=0;
const uuid=()=>`20000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`;
async function fixture(){
 const db=new PGlite();
 await db.exec(`CREATE SCHEMA pcs;
 CREATE TABLE pcs.role_permissions(role text,permission text,scope text,UNIQUE(role,permission,scope));
 CREATE TABLE pcs.test_permissions(value jsonb);INSERT INTO pcs.test_permissions VALUES('["content.approve","content.edit"]');
 CREATE FUNCTION pcs.staff_context(uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('permissions',value) FROM pcs.test_permissions$$;
 CREATE TABLE audit_events(actor_role text,action text,entity_type text,entity_id text,patch jsonb,result text);
 CREATE TABLE public.pcs_workflow_outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),aggregate_type text,aggregate_id uuid,event_type text,idempotency_key text,status text,next_attempt_at timestamptz,payload jsonb,created_at timestamptz DEFAULT now(),sent_at timestamptz,last_error text,attempts integer DEFAULT 0);`);
 for(const migration of ['pcs_content_workflow','pcs_content_targets','pcs_content_publication_queue','pcs_content_video']){
  await db.exec(await readFile(new URL(`../server/sql/${migration}.sql`,import.meta.url),'utf8'));
 }
 await db.query(`INSERT INTO pcs.content_brands(id,name,guidelines) VALUES($1,'Synthetic video publication fixture','Only synthetic tests. Do not publish.');`,[BRAND]);
 await db.query(`INSERT INTO pcs.content_posts(id,brand_id,status,approved_revision) VALUES($1,$2,'APPROVED',1)`,[POST,BRAND]);
 await db.query(`INSERT INTO pcs.content_revisions(post_id,revision,brand_version,brand_guidelines,platform,language,title,body,source_facts,source_url,qa,created_by) VALUES($1,1,1,'Only synthetic tests. Do not publish.','telegram','en','Synthetic video acceptance','Exact approved caption','Synthetic facts only, never a customer publication.','https://example.invalid/fixture','{}','pcs-manager-admin')`,[POST]);
 await db.query(`INSERT INTO pcs.content_targets(id,brand_id,username,chat_id,bot_id,title) VALUES($1,$2,'qa_video_fixture','-100111222333','123456789','Synthetic target, no transport')`,[TARGET,BRAND]);
 const payload={version:8,stage:'READY',claim_id:CLAIM,revision:1,brand_id:BRAND,brand_version:1,created_by:ACTOR,creator_permissions:['*'],review_status:'APPROVED',spec:{version:1,mode:'TEXT_TO_VIDEO',preset:'landscape',fit:'contain',shots:[{prompt:'A green leaf moves gently in daylight.',negative_prompt:'text',seed:42,frames:17}]},artifact:{bucket:'pcs-content-video',path:`jobs/${VIDEO}/${CLAIM}/final.mp4`,sha256:HASH,bytes:4096,width:1280,height:720,fps:24,frames:51,duration_seconds:2.125,decode_verified:true,codec:'h264',technical_qa:'PASSED',manual_review_required:true,cover:{bucket:'pcs-content-video',path:`jobs/${VIDEO}/${CLAIM}/cover.png`,sha256:'b'.repeat(64),bytes:100},source_model:'Lightricks/LTX-Video-0.9.5',model_revision:'e58e28c39631af4d1468ee57a853764e11c1d37e',manifest_sha256:'c'.repeat(64)},review:{actor:ACTOR,decision:'APPROVED',note:'Checked synthetic test metadata, not a real video.',artifact_sha256:HASH,checked_at:'2026-10-01T12:00:00Z'}};
 await db.query(`INSERT INTO public.pcs_workflow_outbox(id,aggregate_type,aggregate_id,event_type,idempotency_key,status,payload,sent_at) VALUES($1,'CONTENT_POST',$2,'CONTENT_VIDEO_GENERATION','synthetic','SENT',$3::jsonb,now())`,[VIDEO,POST,JSON.stringify(payload)]);
 const command=(patch={})=>({request_id:uuid(),id:POST,expected_version:1,target_id:TARGET,target_version:1,scheduled_at:new Date(Date.now()+86400000).toISOString(),publication_confirmed:true,video_job_id:VIDEO,video_version:8,artifact_sha256:HASH,video_confirmed:true,...patch});
 const act=async(action,p,actor=ACTOR,permissions=['*'])=>(await db.query('SELECT pcs.content_publication_action($1,$2::jsonb,$3,$4::jsonb) result',[action,JSON.stringify(p),actor,JSON.stringify(permissions)])).rows[0].result;
 const schedule=(p=command())=>act('schedule-video',p);
 const due=async()=>db.exec(`UPDATE pcs.content_publication_jobs SET scheduled_at=clock_timestamp()-interval '1 second'`);
 const claim=async()=>(await db.query('SELECT pcs.content_claim_publication() result')).rows[0].result;
 const complete=async(job,result)=>(await db.query('SELECT pcs.content_complete_publication($1::uuid,$2::uuid,$3::jsonb) result',[job.id,job.claim_id,JSON.stringify(result)])).rows[0].result;
 const review=async(patch={})=>(await db.query(`SELECT pcs.content_video_action('review',$1::jsonb,$2,'["*"]') result`,[JSON.stringify({request_id:uuid(),job_id:VIDEO,expected_version:8,decision:'REJECTED',confirmed:true,artifact_sha256:HASH,note:'Rejected synthetic fixture during explicit operator review.',...patch}),ACTOR])).rows[0].result;
 const sent=()=>({outcome:'SENT',chat_id:'-100111222333',caption:'Exact approved caption',message_id:'42',date:Math.floor(Date.now()/1000),artifact_sha256:HASH,video:{file_id:'provider-file',file_unique_id:'unique-file',width:1280,height:720,duration:2,file_size:4096}});
 return {db,act,command,schedule,due,claim,complete,review,sent,payload};
}

test('video SQL freezes canonical approval; idempotency and live permissions precede replay',async()=>{
 const f=await fixture();try{
  const p=f.command();const result=await f.schedule(p);
  assert.equal(result.status,'READY');assert.equal(result.job.media_kind,'VIDEO');assert.equal(result.job.video_snapshot.id,VIDEO);assert.deepEqual(result.job.video_snapshot.artifact,f.payload.artifact);
  assert.deepEqual(Object.keys(result.job.video_snapshot).sort(),['id','version','claim_id','revision','brand_version','spec','artifact','review'].sort());
  assert.equal((await f.schedule(p)).replayed,true);
  await assert.rejects(f.schedule({...p,video_version:9}),/content_request_conflict/);
  await f.db.exec(`UPDATE pcs.test_permissions SET value='[]'`);
  await assert.rejects(f.schedule(p),/content_forbidden/);
  assert.equal((await f.db.query('SELECT count(*)::int n FROM pcs.content_publication_jobs')).rows[0].n,1);
 }finally{await f.db.close();}
});

test('video SQL rejects forged input, wrong revisions/hashes/permissions, and caption overflow',async()=>{
 const f=await fixture();try{
  for(const patch of [{video_confirmed:false},{video_version:'8'},{video_job_id:TARGET},{artifact_sha256:'b'.repeat(64)},{video_version:7},{expected_version:2},{video_snapshot:f.payload},{video_url:'https://example.invalid/private.mp4'}])await assert.rejects(f.schedule(f.command(patch)),/content_(publication_invalid|publication_video_changed|version_conflict)/);
  for(const patch of [{review_status:'PENDING'},{stage:'FAILED'},{revision:2},{brand_version:2},{review:{...f.payload.review,decision:'REJECTED'}},{artifact:{...f.payload.artifact,sha256:'b'.repeat(64)}}]){
   await f.db.query('UPDATE public.pcs_workflow_outbox SET payload=$1::jsonb',[JSON.stringify({...f.payload,...patch})]);
   await assert.rejects(f.schedule(),/content_publication_video_changed/);
  }
  await f.db.query('UPDATE public.pcs_workflow_outbox SET payload=$1::jsonb',[JSON.stringify(f.payload)]);
  await f.db.exec(`UPDATE pcs.content_revisions SET body=repeat(chr(128512),1025)`);
  await assert.rejects(f.schedule(),/content_publication_video_changed/);
  await f.db.exec(`UPDATE pcs.content_revisions SET body=repeat(chr(128512),1024)`);
  assert.equal((await f.schedule()).job.body.length,2048); // SQL counts Unicode points.
 }finally{await f.db.close();}
});

test('video SQL rejects missing media snapshot and enforces current metadata on claim',async()=>{
 const f=await fixture();try{
  const {job}=await f.schedule();await f.due();
  await assert.rejects(f.db.exec(`UPDATE pcs.content_publication_jobs SET video_snapshot=NULL`),/content_publication_jobs_media_check/);
  await f.db.exec(`UPDATE public.pcs_workflow_outbox SET payload=jsonb_set(payload,'{artifact,bytes}','4097')`);
  const result=await f.claim();assert.equal(result.job,null);assert.equal(result.blocked_job_id,job.id);
  const saved=(await f.db.query('SELECT state,last_error FROM pcs.content_publication_jobs')).rows[0];assert.deepEqual(saved,{state:'BLOCKED',last_error:'video_changed'});
  assert.equal((await f.db.query('SELECT status FROM pcs.content_posts')).rows[0].status,'APPROVED');
 }finally{await f.db.close();}
});

test('queued video can be rejected; sending and UNKNOWN source review cannot change or retry',async()=>{
 const f=await fixture();try{
  const saved=await f.schedule();await f.review();await f.due();assert.equal((await f.claim()).blocked_job_id,saved.job.id);
 }finally{await f.db.close();}
 const g=await fixture();try{
  await g.schedule();await g.due();const {job}=await g.claim();assert.equal(job.state,'SENDING');
  await assert.rejects(g.review(),/content_video_job_locked/);assert.equal((await g.claim()).job,null);
  await g.complete(job,{outcome:'UNKNOWN',reason:'transport_unknown'});
  await assert.rejects(g.review(),/content_video_job_locked/);assert.equal((await g.claim()).job,null);
  const version=(await g.db.query('SELECT version FROM pcs.content_posts')).rows[0].version;
  await assert.rejects(g.act('cancel',{request_id:uuid(),id:POST,expected_version:version,job_id:job.id}),/content_publication_job_locked/);
  await assert.rejects(g.schedule(g.command({expected_version:version})),/content_publication_approval_required|content_publication_job_locked/);
 }finally{await g.db.close();}
});

test('video SQL validates strict provider receipt, freezes SENT source and replays atomically',async()=>{
 const f=await fixture();try{
  await f.schedule();await f.due();const {job}=await f.claim();const receipt=f.sent();
  for(const patch of [{caption:'different'},{artifact_sha256:'b'.repeat(64)},{text:'legacy text'},{video:null},{video:{...receipt.video,width:720}},{video:{...receipt.video,duration:4}},{video:{...receipt.video,file_id:''}},{video:{...receipt.video,file_size:0}},{video:{...receipt.video,file_size:9007199254740992}},{video:{...receipt.video,unexpected:true}},{date:1},{chat_id:'-100999'}])await assert.rejects(f.complete(job,{...receipt,...patch}),/content_publication_receipt_invalid/);
  const complete=await f.complete(job,receipt);assert.equal(complete.job.state,'SENT');assert.equal(complete.job.public_url,'https://t.me/qa_video_fixture/42');
  assert.equal((await f.complete(job,receipt)).replayed,true);
  await assert.rejects(f.complete(job,{outcome:'UNKNOWN',reason:'receipt_invalid'}),/content_publication_receipt_conflict/);
  await assert.rejects(f.review(),/content_video_job_locked/);
  assert.equal((await f.claim()).job,null);
  assert.equal((await f.db.query("SELECT count(*)::int n FROM audit_events WHERE action='content.publication.complete'")).rows[0].n,1);
 }finally{await f.db.close();}
});

test('video SQL completion/audit rollback permits saving same receipt without a second send',async()=>{
 const f=await fixture();try{
  await f.schedule();await f.due();const {job}=await f.claim();const receipt=f.sent();receipt.video.file_size=null;
  await f.db.exec(`ALTER TABLE audit_events ADD CONSTRAINT completion_failure CHECK(action<>'content.publication.complete') NOT VALID`);
  await assert.rejects(f.complete(job,receipt),/completion_failure/);
  assert.deepEqual((await f.db.query('SELECT state,provider_receipt FROM pcs.content_publication_jobs')).rows[0],{state:'SENDING',provider_receipt:null});
  assert.equal((await f.claim()).job,null);
  await f.db.exec('ALTER TABLE audit_events DROP CONSTRAINT completion_failure');
  assert.equal((await f.complete(job,receipt)).job.state,'SENT');
 }finally{await f.db.close();}
});

test('video SQL schedule and claim roll back snapshots, commands and state on audit failure',async()=>{
 const f=await fixture();try{
  const p=f.command();
  await f.db.exec(`ALTER TABLE audit_events ADD CONSTRAINT schedule_failure CHECK(action<>'content.publication.schedule-video') NOT VALID`);
  await assert.rejects(f.schedule(p),/schedule_failure/);
  assert.equal((await f.db.query('SELECT count(*)::int n FROM pcs.content_publication_jobs')).rows[0].n,0);
  assert.equal((await f.db.query('SELECT count(*)::int n FROM pcs.content_commands')).rows[0].n,0);
  assert.deepEqual((await f.db.query('SELECT status,version FROM pcs.content_posts')).rows[0],{status:'APPROVED',version:1});
  await f.db.exec('ALTER TABLE audit_events DROP CONSTRAINT schedule_failure');
  await f.schedule(p);await f.due();
  await f.db.exec(`ALTER TABLE audit_events ADD CONSTRAINT claim_failure CHECK(action<>'content.publication.claim') NOT VALID`);
  await assert.rejects(f.claim(),/claim_failure/);
  assert.deepEqual((await f.db.query('SELECT state,claim_id FROM pcs.content_publication_jobs')).rows[0],{state:'QUEUED',claim_id:null});
  await f.db.exec('ALTER TABLE audit_events DROP CONSTRAINT claim_failure');
  assert.equal((await f.claim()).job.state,'SENDING');
 }finally{await f.db.close();}
});

test('TEXT remains exact; explicit cancelled reschedule clears VIDEO snapshot and rejects video receipts',async()=>{
 const f=await fixture();try{
  const video=await f.schedule();const cancel=await f.act('cancel',{request_id:uuid(),id:POST,expected_version:video.version,job_id:video.job.id});
  const {video_job_id,video_version,artifact_sha256,video_confirmed,...p}=f.command({expected_version:cancel.version});
  const text=await f.act('schedule',p);assert.equal(text.job.id,video.job.id);assert.equal(text.job.media_kind,'TEXT');assert.equal(text.job.video_snapshot,null);
  await f.due();const {job}=await f.claim();
  await assert.rejects(f.complete(job,f.sent()),/content_publication_receipt_invalid/);
  await assert.rejects(f.complete(job,{outcome:'REJECTED',reason:'video_preflight_failed'}),/content_publication_receipt_invalid/);
  const receipt={outcome:'SENT',chat_id:job.chat_id,text:job.body,message_id:'43',date:Math.floor(Date.now()/1000)};
  assert.equal((await f.complete(job,receipt)).job.state,'SENT');
 }finally{await f.db.close();}
});

test('video SQL internal worker/table grants remain revoked for PUBLIC',async()=>{
 const f=await fixture();try{
  for(const signature of ['pcs.content_claim_publication()','pcs.content_complete_publication(uuid,uuid,jsonb)','pcs.content_publication_action(text,jsonb,text,jsonb)','pcs.content_video_action(text,jsonb,text,jsonb)'])assert.equal((await f.db.query("SELECT has_function_privilege('public',$1,'EXECUTE') allowed",[signature])).rows[0].allowed,false);
  assert.equal((await f.db.query("SELECT has_table_privilege('public','pcs.content_publication_jobs','SELECT,INSERT,UPDATE,DELETE') allowed")).rows[0].allowed,false);
 }finally{await f.db.close();}
});

test('workflow reader executes real joined SQL, bounds approved videos and excludes stale approval',async()=>{
 const f=await fixture();try{
  const biz={query:async(q,p)=>(await f.db.query(q,p)).rows};
  let read=await readContentWorkflow(biz,{id:POST});
  assert.deepEqual(read.capabilities.video_publication,{version:1});assert.equal(read.approved_videos.length,1);
  assert.deepEqual(Object.keys(read.approved_videos[0]).sort(),['id','version','revision','brand_version','artifact_sha256','preset','width','height','duration_seconds'].sort());
  assert.equal(read.approved_videos[0].artifact_sha256,HASH);
  assert.equal(typeof read.approved_videos[0].duration_seconds,'number');assert.equal(read.approved_videos[0].duration_seconds,2.125);
  for(let i=0;i<20;i++){
   const id=uuid(),payload=structuredClone(f.payload);payload.artifact.path=`jobs/${id}/${CLAIM}/final.mp4`;payload.artifact.cover.path=`jobs/${id}/${CLAIM}/cover.png`;
   await f.db.query(`INSERT INTO public.pcs_workflow_outbox(id,aggregate_type,aggregate_id,event_type,status,payload,sent_at) VALUES($1,'CONTENT_POST',$2,'CONTENT_VIDEO_GENERATION','SENT',$3::jsonb,now())`,[id,POST,JSON.stringify(payload)]);
  }
  read=await readContentWorkflow(biz,{id:POST});assert.equal(read.approved_videos.length,20);assert.equal(read.approved_videos_truncated,true);
  const scheduled=await f.schedule();read=await readContentWorkflow(biz,{id:POST});
  assert.equal(read.posts[0].publication_job.media_kind,'VIDEO');assert.equal(read.posts[0].publication_job.artifact_sha256,HASH);
  assert.equal('video_snapshot' in read.posts[0].publication_job,false);assert.equal('artifact' in read.approved_videos[0],false);
  await f.db.exec('UPDATE pcs.content_posts SET approved_revision=0');assert.equal((await readContentWorkflow(biz,{id:POST})).approved_videos.length,0);
  await f.db.exec('UPDATE pcs.content_posts SET approved_revision=1;UPDATE pcs.content_brands SET version=2');assert.equal((await readContentWorkflow(biz,{id:POST})).approved_videos.length,0);
  await f.db.exec("UPDATE pcs.content_brands SET version=1;UPDATE pcs.test_permissions SET value='[]'");assert.equal((await readContentWorkflow(biz,{id:POST})).approved_videos.length,0);
  await f.db.exec('ALTER TABLE pcs.content_publication_jobs DROP CONSTRAINT content_publication_jobs_media_check;ALTER TABLE pcs.content_publication_jobs DROP COLUMN media_kind;ALTER TABLE pcs.content_publication_jobs DROP COLUMN video_snapshot');
  read=await readContentWorkflow(biz,{id:POST});assert.equal(read.capabilities.video_publication,null);assert.equal(read.approved_videos.length,0);assert.equal(read.posts[0].publication_job.media_kind,'TEXT');
  assert.ok(scheduled.job.id);
 }finally{await f.db.close();}
});
