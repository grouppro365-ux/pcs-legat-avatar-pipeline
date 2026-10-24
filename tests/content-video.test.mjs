import test from 'node:test';import assert from 'node:assert/strict';
import {videoSpec,videoFinishing,contentVideoInput,readContentVideo,actContentVideo,videoWorkerAction,videoWorkerInput} from '../server/supabase/pcs-manager-live2/content-video.mjs';
const id='11111111-1111-4111-8111-111111111111',claim='22222222-2222-4222-8222-222222222222',rid='33333333-3333-4333-8333-333333333333';
const spec=()=>({version:1,mode:'TEXT_TO_VIDEO',preset:'landscape',fit:'contain',shots:[{prompt:'A green leaf moving softly in daylight.',negative_prompt:'text, logo',seed:42,frames:17}]});
const finishing=()=>({version:1,style:'readable-v1',language:'ru',cues:[{start_frame:0,end_frame:24,text:'Проверенный текст оператора'},{start_frame:24,end_frame:51,text:'Точные условия\nБез новых обещаний'}]});
const captionSpec=()=>({...spec(),version:2,finishing:finishing()});
const create=()=>({request_id:rid,post_id:id,expected_post_version:2,revision:1,spec:spec(),confirmed:true,upscale_confirmed:true});
const identity={worker_id:'github:39984787683:1',workflow_sha:'a'.repeat(40)};
const mutation=()=>({request_id:rid,job_id:id,claim_id:claim,expected_version:5});
const db=handler=>({query:async(q,p)=>handler(q,p)});
test('video input is bounded, explicit and rejects unsupported modes and extra fields',()=>{assert.deepEqual(contentVideoInput('create',create()),create());for(const patch of [{confirmed:false},{upscale_confirmed:false},{revision:0},{request_id:'bad'},{token:'do not accept'}])assert.throws(()=>contentVideoInput('create',{...create(),...patch}));for(const patch of [{mode:'VIDEO_TO_VIDEO'},{preset:undefined},{shots:[{...spec().shots[0],frames:undefined}]},{shots:[{...spec().shots[0],seed:-1}]},{shots:Array(4).fill(spec().shots[0])},{url:'https://untrusted'}])assert.throws(()=>videoSpec({...spec(),...patch}));});
test('review binds the exact file hash and explicit decision; unknown launch needs provider check',()=>{const p={request_id:rid,job_id:id,expected_version:7,artifact_sha256:'a'.repeat(64),decision:'APPROVED',confirmed:true,note:'Reviewed exact video, language, brand and source facts.'};assert.equal(contentVideoInput('review',p),p);assert.throws(()=>contentVideoInput('review',{...p,artifact_sha256:'x'}));assert.throws(()=>contentVideoInput('resolve-unknown',{request_id:rid,job_id:id,expected_version:7,provider_checked:false,note:p.note}));});
test('read uses canonical outbox, bounded pagination and current post metadata',async()=>{const seen=[];const result=await readContentVideo(db((q,p)=>{seen.push({q,p});return q.includes('from pcs.content_posts')?[{id,version:2,revision:1,platform:'telegram'}]:[{job:{id,stage:'QUEUED'}}];}),{post_id:id,page:2});assert.equal(result.post.id,id);assert.equal(result.jobs[0].id,id);assert.match(seen[1].q,/CONTENT_VIDEO_GENERATION/);assert.equal(seen[1].p[2],40);assert.equal(result.capabilities.automatic_publication,false);await assert.rejects(readContentVideo(db(()=>[]),{post_id:'bad'}));});
test('staff mutation uses SQL receipt and cannot forge permissions or accept wrong job',async()=>{let calls=0;const fake=db((q,p)=>{calls++;assert.match(q,/pcs.content_video_action/);assert.equal(p[2],'actor');return[{result:{ok:true,job:{id,post_id:id}}}];});await assert.rejects(actContentVideo(fake,'create',create(),'actor',[]),e=>e.status===403);assert.equal(calls,0);const out=await actContentVideo(fake,'create',create(),'actor',['content.edit']);assert.equal(out.job.id,id);await assert.rejects(actContentVideo(db(()=>[{result:{ok:true,job:{id:claim,post_id:claim}}}]),'create',create(),'actor',['content.edit']),e=>e.status===502);});
test('worker pins owner identity, job and provider nonce and never accepts arbitrary error detail',()=>{const body={...mutation(),stage:'GENERATING',provider_receipt:{kernel:'tatyanathai/pcs-legat-ai-avatar-pipeline',version:97,ref:'tatyanathai/pcs-legat-ai-avatar-pipeline/97',run_id:claim}};assert.equal(videoWorkerInput('progress',body),body);assert.throws(()=>videoWorkerInput('progress',{...body,provider_receipt:{...body.provider_receipt,run_id:id}}));assert.throws(()=>videoWorkerInput('fail',{...mutation(),error_code:'secret or arbitrary exception'}));});
test('completion downloads/verifies artifacts before SQL writes and a verifier failure cannot mark ready',async()=>{const calls=[];const artifact={sha256:'a'.repeat(64)};const api=db((q,p)=>{const action=p[0];calls.push(action);return[{result:{ok:true,job:{id,claim_id:claim,stage:action==='read'?'QA':'READY',version:action==='read'?5:6}}}];});let checks=0;await videoWorkerAction(api,'complete',{...mutation(),artifact},identity,async(a,j)=>{checks++;assert.equal(j.stage,'QA');assert.equal(a,artifact);return a;});assert.deepEqual(calls,['read','complete']);assert.equal(checks,1);calls.length=0;await assert.rejects(videoWorkerAction(api,'complete',{...mutation(),artifact},identity,async()=>{throw Error('hash mismatch')}));assert.deepEqual(calls,['read']);});
test('worker upload read rejects a changed version and completion retry uses its durable receipt',async()=>{await assert.rejects(videoWorkerAction(db(()=>[{result:{ok:true,job:{id,version:6,stage:'QA'}}}]),'read',mutation(),identity),e=>e.status===409);const artifact={sha256:'a'.repeat(64)},calls=[];const result=await videoWorkerAction(db((q,p)=>{calls.push(p[0]);return[{result:{ok:true,replayed:p[0]==='complete',job:{id,version:6,stage:'READY',artifact}}}];}),'complete',{...mutation(),artifact},identity,async()=>{throw Error('must not reverify accepted result')});assert.equal(result.replayed,true);assert.deepEqual(calls,['read','complete']);});

test('caption spec v2 preserves exact operator text while v1 remains generation-only',async()=>{
 const value=captionSpec();assert.equal(videoSpec(value),value);assert.deepEqual(contentVideoInput('create',{...create(),spec:value}).spec,value);
 assert.throws(()=>videoSpec({...spec(),finishing:finishing()}));assert.throws(()=>videoSpec({...spec(),version:2}));
 let saved;await actContentVideo(db((q,p)=>{saved=JSON.parse(p[1]);return[{result:{ok:true,job:{id,post_id:id}}}];}),'create',{...create(),spec:value},'pcs-manager-admin',['content.edit']);
 assert.deepEqual(saved.spec.finishing,value.finishing);
});

test('caption timing uses final-frame integer intervals and permits adjacent nonoverlapping cues',()=>{
 assert.equal(videoFinishing(finishing(),51).cues.length,2);
 for(const cues of [[],Array(13).fill({start_frame:0,end_frame:1,text:'Text'}),[{start_frame:-1,end_frame:1,text:'Text'}],[{start_frame:0,end_frame:0,text:'Text'}],[{start_frame:0,end_frame:52,text:'Text'}],[{start_frame:0.5,end_frame:1,text:'Text'}],[{start_frame:0,end_frame:true,text:'Text'}],[{start_frame:0,end_frame:25,text:'Text'},{start_frame:24,end_frame:51,text:'Text'}],[{start_frame:24,end_frame:51,text:'Text'},{start_frame:0,end_frame:24,text:'Text'}]])assert.throws(()=>videoFinishing({...finishing(),cues},51));
 for(const patch of [{version:2},{style:'custom'},{language:'th'},{font_path:'/private/file'},{cues:null}])assert.throws(()=>videoFinishing({...finishing(),...patch},51));
 assert.throws(()=>videoSpec({...captionSpec(),shots:[{...spec().shots[0],frames:17}],finishing:{...finishing(),cues:[{start_frame:0,end_frame:99,text:'Long cue'}]}}));
});

test('caption text counts Unicode codepoints, bounds lines and refuses ASS/control injection',()=>{
 const one=text=>({...finishing(),cues:[{start_frame:0,end_frame:51,text}]});
 for(const text of ['A'.repeat(36),'A'.repeat(36)+'\n'+'Б'.repeat(35),'😀'.repeat(36),'Leading and trailing spaces '])assert.doesNotThrow(()=>videoFinishing(one(text),51));
 for(const text of ['', ' ', '\u00a0\u2000', 'A\n', '\nA', 'A\nB\nC','A'.repeat(37),'A'.repeat(36)+'\n'+'Б'.repeat(36),'{\\pos(0,0)}Text','Text\\Nnew','Text{bold}','A\tB','A\rB','A\u0000B','A\u0085B','A\u00adB','A\u061cB','A\u200bB','A\u2028B','A\u202eB','A\u2060B','A\ufeffB','A\ud800B'])assert.throws(()=>videoFinishing(one(text),51));
 assert.throws(()=>videoFinishing({...finishing(),cues:[{start_frame:0,end_frame:51,text:'Text',url:'https://private.example'}]},51));
});

test('caption preflight failures use fixed allowlisted codes without raw caption diagnostics',()=>{
 for(const error_code of ['CAPTION_GLYPH_UNSUPPORTED','CAPTION_LINE_TOO_WIDE','CAPTION_FONT_UNAVAILABLE','VIDEO_CAPTIONS_INVALID']){
  const body={...mutation(),error_code};assert.equal(videoWorkerInput('fail',body),body);
 }
 assert.throws(()=>videoWorkerInput('fail',{...mutation(),error_code:'CAPTION_GLYPH_UNSUPPORTED: private text'}));
});
