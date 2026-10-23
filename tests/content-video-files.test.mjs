import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyVideoArtifact,videoObjectPath} from '../server/supabase/pcs-manager-live2/content-video-storage.mjs';

test('real 8fps source passes FFmpeg export and exact private-storage completion contract',async()=>{
 const root=mkdtempSync(join(tmpdir(),'pcs-video-contract-'));
 try{
  const program=`import sys,json,subprocess
from pathlib import Path
import imageio_ffmpeg
sys.path.insert(0,'tools/video')
from postprocess import process_manifest
root=Path(sys.argv[1]);src=root/'source';src.mkdir()
subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-v','error','-f','lavfi','-i','testsrc2=size=320x256:rate=8','-frames:v','17','-c:v','libx264','-pix_fmt','yuv420p',str(src/'shot.mp4')],check=True,capture_output=True)
result=process_manifest({'job_id':'contract-fixture','platform':'landscape','fit':'contain','audio':'mute','shots':[{'path':'shot.mp4','start':0,'duration':17/8}]},src,root/'output')
print(json.dumps(result))
`;
  const result=JSON.parse(execFileSync('python',['-B','-c',program,root],{encoding:'utf8',cwd:new URL('..',import.meta.url),timeout:30000}));
  const job={id:'11111111-1111-4111-8111-111111111111',claim_id:'22222222-2222-4222-8222-222222222222',stage:'QA',spec:{preset:'landscape',shots:[{frames:17}]}};
  const blobs={},metadata={};
  for(const [kind,entry] of [['video',result.artifact],['cover',result.cover]]){
   const bytes=readFileSync(join(root,'output',entry.file));const path=videoObjectPath(job,kind);
   blobs[path]=new Blob([bytes]);metadata[kind]={bucket:'pcs-content-video',path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
   assert.equal(metadata[kind].sha256,entry.sha256);
  }
  const storage={from(bucket){assert.equal(bucket,'pcs-content-video');return {download:async path=>({data:blobs[path]})};}};
  const artifact={...metadata.video,...Object.fromEntries(['width','height','fps','frames','duration_seconds','decode_verified','codec'].map(k=>[k,result.artifact[k]])),cover:metadata.cover,technical_qa:'PASSED',manual_review_required:true,source_model:'Lightricks/LTX-Video-0.9.5',model_revision:'e58e28c39631af4d1468ee57a853764e11c1d37e',manifest_sha256:result.manifest_sha256};
  assert.equal(artifact.frames,51);assert.equal(artifact.duration_seconds,2.125);
  assert.equal(await verifyVideoArtifact(storage,artifact,job),artifact);
 }finally{rmSync(root,{recursive:true,force:true});}
});
