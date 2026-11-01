import test from 'node:test';
import assert from 'node:assert/strict';
import {contentInput,actContentWorkflow,readContentWorkflow} from '../server/supabase/pcs-manager-live2/content-workflow.mjs';
const id='11111111-1111-4111-8111-111111111111';
const payload={request_id:id,id,expected_version:2,target_id:id,target_version:1,scheduled_at:'2099-01-01T12:00:00Z',publication_confirmed:true,video_job_id:id,video_version:3,artifact_sha256:'a'.repeat(64),video_confirmed:true};
test('video scheduling validates exact canonical identifiers, confirmation, versions and time before database work',()=>{
 assert.deepEqual(contentInput('schedule-video-publication',payload),payload);
 for(const patch of [{video_job_id:[]},{video_version:0},{video_version:1000000000},{video_confirmed:false},{artifact_sha256:'A'.repeat(64)},{scheduled_at:'2099-01-01T12:00:00'},{artifact:{path:'fake'}},{caption:'fake'},{url:'https://example.com/video'}])assert.throws(()=>contentInput('schedule-video-publication',{...payload,...patch}));
 assert.throws(()=>contentInput('schedule-publication',payload));
});
test('video publication needs live approval permission and maps once to canonical schedule-video SQL',async()=>{
 let calls=0;const query=async(q,p)=>{calls++;assert.equal(p[0],'schedule-video');assert.deepEqual(JSON.parse(p[1]),payload);return[{result:{ok:true,id,job:{id}}}];};
 await assert.rejects(()=>actContentWorkflow({query},'schedule-video-publication',payload,'staff',['content.edit']),e=>e.status===403);assert.equal(calls,0);
 assert.equal((await actContentWorkflow({query},'schedule-video-publication',payload,'staff',['content.approve'])).ok,true);assert.equal(calls,1);
});
test('video discovery requires exact installed capability and selected post, bounds results and exposes no private files',async()=>{
 const queries=[];let installed=true;
 const query=async(q,p)=>{queries.push([q,p]);if(q.includes('to_regprocedure'))return[{available:false,video_available:installed}];if(q.includes('from public.pcs_workflow_outbox v'))return Array.from({length:21},(_,i)=>({id:String(i),artifact_sha256:'a'.repeat(64)}));return[];};
 let r=await readContentWorkflow({query},{id});assert.deepEqual(r.capabilities.video_publication,{version:1});assert.equal(r.approved_videos.length,20);assert.equal(r.approved_videos_truncated,true);
 const videos=queries.find(([q])=>q.includes('from public.pcs_workflow_outbox v'));assert.deepEqual(videos[1],[id]);assert.match(videos[0],/pcs.content_video_current\(v\)/);assert.match(videos[0],/p.approved_revision=r.revision/);assert.doesNotMatch(videos[0],/artifact,path|claim_id|payload snapshot/);
 queries.length=0;installed=false;r=await readContentWorkflow({query},{id});assert.equal(r.capabilities.video_publication,null);assert.deepEqual(r.approved_videos,[]);assert.equal(queries.some(([q])=>q.includes('from public.pcs_workflow_outbox v')),false);
 queries.length=0;installed=true;r=await readContentWorkflow({query});assert.deepEqual(r.approved_videos,[]);assert.equal(queries.some(([q])=>q.includes('from public.pcs_workflow_outbox v')),false);
});
