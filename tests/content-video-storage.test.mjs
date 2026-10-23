import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {videoObjectPath,signVideoUpload,verifyVideoArtifact,signVideoRead} from '../server/supabase/pcs-manager-live2/content-video-storage.mjs';
const id='11111111-1111-4111-8111-111111111111',claim='22222222-2222-4222-8222-222222222222';
const job=()=>({id,claim_id:claim,stage:'QA',spec:{preset:'landscape',shots:[{frames:17}]}});
const data={video:Buffer.from([0,0,0,12,102,116,121,112,0,0,0,0]),cover:Buffer.from([137,80,78,71,13,10,26,10,1])};
const meta=(kind,j=job())=>({bucket:'pcs-content-video',path:videoObjectPath(j,kind),bytes:data[kind].length,sha256:createHash('sha256').update(data[kind]).digest('hex')});
function fixture(){const calls=[];return{calls,storage:{from(bucket){assert.equal(bucket,'pcs-content-video');return{
 async download(path){calls.push(['download',path]);return{data:new Blob([data[path.endsWith('.mp4')?'video':'cover']])};},
 async createSignedUploadUrl(path,options){calls.push(['upload',path,options]);return{data:{signedUrl:'https://nnlzgertmmxuteozoeel.supabase.co/storage/v1/object/upload/sign/'+bucket+'/'+path+'?token=ephemeral'}};},
 async createSignedUrl(path,seconds){calls.push(['read',path,seconds]);return{data:{signedUrl:'https://nnlzgertmmxuteozoeel.supabase.co/storage/v1/object/sign/'+bucket+'/'+path+'?token=ephemeral'}};}
 };}}};}
const artifact=()=>({...meta('video'),width:1280,height:720,fps:24,frames:51,duration_seconds:2.125,decode_verified:true,codec:'h264',technical_qa:'PASSED',manual_review_required:true,cover:meta('cover'),source_model:'Lightricks/LTX-Video-0.9.5',model_revision:'e58e28c39631af4d1468ee57a853764e11c1d37e',manifest_sha256:'a'.repeat(64)});
test('private upload paths are bound to job+claim and never permit overwrite',async()=>{
 const h=fixture(),r=await signVideoUpload(h.storage,job(),'video');assert.equal(r.path,meta('video').path);assert.equal(h.calls[0][2].upsert,false);
 await assert.rejects(signVideoUpload(h.storage,{...job(),stage:'GENERATING'},'video'),/проверке/);
 assert.throws(()=>videoObjectPath({...job(),id:'../escape'},'video'));assert.throws(()=>videoObjectPath(job(),'other'));
});
test('completion independently downloads and hashes the exact private video and cover',async()=>{
 const h=fixture(),a=artifact();assert.equal(await verifyVideoArtifact(h.storage,a,job()),a);assert.equal(h.calls.length,2);
 const wrong=artifact();wrong.sha256='0'.repeat(64);await assert.rejects(verifyVideoArtifact(h.storage,wrong,job()),/сумма/);
 const foreign=artifact();foreign.path='jobs/another/final.mp4';await assert.rejects(verifyVideoArtifact(h.storage,foreign,job()),/квитанция/);
});
test('wrong output geometry, duration, unreviewed attestation and oversized files cannot complete',async()=>{
 for(const change of [{width:1080},{duration_seconds:8},{frames:52,duration_seconds:52/24},{decode_verified:false},{manual_review_required:false},{bytes:26*1024*1024},{manifest_sha256:'bad'}]){
  const h=fixture();await assert.rejects(verifyVideoArtifact(h.storage,{...artifact(),...change},job()));
 }
});
test('only ready job assets get bounded signed read access',async()=>{
 const h=fixture(),j={...job(),stage:'READY',artifact:artifact()};const r=await signVideoRead(h.storage,j,'video');assert.equal(r.expires_in,120);assert.equal(h.calls[0][2],120);
 await assert.rejects(signVideoRead(h.storage,job(),'video'),/готов/);
 const bad={...j,artifact:{...j.artifact,path:'foreign'}};await assert.rejects(signVideoRead(h.storage,bad,'video'),/принадлежит/);
});
