import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import busboy from 'busboy';
import {deliverTelegramPublication,dispatchContentPublication,scheduleContentPublication} from '../server/supabase/pcs-manager-live2/content-publisher.mjs';
import {readPublicationVideo,videoObjectPath} from '../server/supabase/pcs-manager-live2/content-video-storage.mjs';
import {publicationTelegramApi,videoPublicationTelegramApi} from '../server/supabase/pcs-manager-live2/telegram-api.mjs';
const id='11111111-1111-4111-8111-111111111111',claim='22222222-2222-4222-8222-222222222222';
const token='123456:synthetic_private_token_abcdefghijklmnopqrstuvwxyz';
const bytes=Buffer.alloc(1024);bytes.write('ftyp',4);
const digest=createHash('sha256').update(bytes).digest('hex');
function job(){const snapshot={id,claim_id:claim,version:4,revision:2,brand_version:3,spec:{preset:'landscape',shots:[{frames:17}]},review:{decision:'APPROVED',artifact_sha256:digest}};snapshot.artifact={bucket:'pcs-content-video',path:videoObjectPath(snapshot,'video'),bytes:bytes.length,sha256:digest,width:1280,height:720,fps:24,frames:51,duration_seconds:2.125,decode_verified:true,codec:'h264',technical_qa:'PASSED',manual_review_required:true,source_model:'Lightricks/LTX-Video-0.9.5',model_revision:'e58e28c39631af4d1468ee57a853764e11c1d37e',manifest_sha256:'a'.repeat(64)};return{id,claim_id:claim,post_id:id,revision:2,media_kind:'VIDEO',video_snapshot:snapshot,username:'public_channel',chat_id:'-10012345678',bot_id:'123456',body:'Одобренная подпись — exact',claimed_at:new Date().toISOString()};}
// Parse the original grammY wire stream with an independent RFC multipart parser.
// Node 22's Response.formData rejects grammY's legal compact header whitespace.
async function parseMultipart(init){
 const parser=busboy({headers:init.headers,limits:{files:1,fileSize:25*1024*1024,fields:10,fieldSize:8192}}),parts=new Map();
 return await new Promise((resolve,reject)=>{
  parser.on('field',(name,value,info)=>{if(info.valueTruncated||parts.has(name))return reject(Error('multipart_field_invalid'));parts.set(name,value);});
  parser.on('file',(name,stream,info)=>{
   const chunks=[];stream.on('data',chunk=>chunks.push(chunk));stream.once('limit',()=>reject(Error('multipart_file_too_large')));stream.once('error',reject);stream.once('end',()=>{if(parts.has(name))return reject(Error('multipart_file_duplicate'));parts.set(name,new File(chunks,info.filename,{type:info.mimeType}));});
  });
  for(const event of ['filesLimit','fieldsLimit','partsLimit'])parser.once(event,()=>reject(Error('multipart_limit')));
  parser.once('error',reject);parser.once('close',()=>resolve(parts));
  // grammY/web supplies a native ReadableStream, used unchanged by Deno fetch.
  Readable.fromWeb(init.body).once('error',reject).pipe(parser);
 });
}
function fixture({j=job(),data=bytes,downloadError=false,downloadThrow=false,badTarget=false,sendThrow=false,sendStatus=200,resultChange={},envelope}={}){
 const calls=[],downloads=[],uploads=[];let sends=0;let multipartError;
 const result={message_id:42,chat:{id:-10012345678,type:'channel',username:j.username},caption:j.body,date:Math.floor(Date.now()/1000),video:{file_id:'telegram-file',file_unique_id:'unique-file',width:1280,height:720,duration:2,file_size:1024},...resultChange};
 const storage={from(bucket){assert.equal(bucket,'pcs-content-video');return{async download(path){downloads.push(path);if(downloadThrow)throw Error('private storage detail');return downloadError?{error:Error('private storage detail')}:{data:new Blob([data])};}};}};
 const transport=async(url,init)=>{calls.push({url,init});const method=url.split('/').at(-1);if(method==='pcs_secret_get')return Response.json(token);if(method==='getMe')return Response.json({ok:true,result:{id:123456,is_bot:true}});if(method==='getChat')return Response.json({ok:true,result:{id:-10012345678,type:'channel',username:j.username,title:'PCS'}});if(method==='getChatMember')return Response.json({ok:true,result:{user:{id:123456},status:'administrator',can_post_messages:!badTarget}});assert.equal(method,'sendVideo');sends++;try{uploads.push(await parseMultipart(init));}catch(error){multipartError=error;throw error;}if(sendThrow)throw Error('private unknown '+token);return Response.json(envelope??{ok:true,result},{status:sendStatus});};
 return{j,storage,transport,downloads,calls,uploads,date:result.date,get multipartError(){return multipartError;},get sends(){return sends;}};
}
test('video publisher uploads the verified private bytes exactly once using upstream multipart InputFile',async()=>{
 const h=fixture();const out=await deliverTelegramPublication('https://service.test','key',h.j,h.transport,{storage:h.storage});
 assert.ifError(h.multipartError);
 assert.deepEqual(out,{outcome:'SENT',chat_id:h.j.chat_id,caption:h.j.body,message_id:'42',date:h.date,artifact_sha256:digest,video:{file_id:'telegram-file',file_unique_id:'unique-file',width:1280,height:720,duration:2,file_size:1024}});
 assert.equal(h.sends,1);assert.deepEqual(h.downloads,[h.j.video_snapshot.artifact.path]);
 const form=h.uploads[0],fileEntries=[...form.entries()].filter(([,v])=>typeof v!=='string');assert.equal(fileEntries.length,1);
 const [field,file]=fileEntries[0];assert.equal(file.name,'pcs-video.mp4');assert.deepEqual(Buffer.from(await file.arrayBuffer()),bytes);assert.equal(form.get('video'),'attach://'+field);assert.equal(form.get('caption'),h.j.body);assert.equal(form.get('chat_id'),h.j.chat_id);assert.equal(form.get('width'),'1280');assert.equal(form.get('height'),'720');assert.equal(form.get('supports_streaming'),'true');assert.equal(form.has('cover'),false);
 assert.equal(h.calls.at(-1).init.redirect,'error');assert.equal(JSON.stringify(out).includes(token),false);assert.equal(JSON.stringify(out).includes('jobs/'),false);
});
test('private path, hash, MP4, size, review, geometry and caption failures never call Telegram',async()=>{
 for(const mutate of [j=>j.video_snapshot.artifact.path='https://evil.test/video.mp4',j=>j.video_snapshot.artifact.bucket='public',j=>j.video_snapshot.artifact.sha256='0'.repeat(64),j=>j.video_snapshot.review.decision='REJECTED',j=>j.video_snapshot.claim_id='../escape',j=>j.video_snapshot.artifact.width=1080,j=>j.video_snapshot.artifact.bytes=26*1024*1024,j=>j.body='x'.repeat(1025),j=>j.body=' ']){
  const j=job();mutate(j);const h=fixture({j});assert.deepEqual(await deliverTelegramPublication('https://service.test','key',j,h.transport,{storage:h.storage}),{outcome:'REJECTED',reason:'video_preflight_failed'});assert.equal(h.sends,0);assert.equal(h.calls.length,0);
 }
 for(const options of [{data:Buffer.alloc(1024)},{data:Buffer.alloc(1025)},{downloadError:true},{downloadThrow:true}]){const h=fixture(options);assert.deepEqual(await deliverTelegramPublication('https://service.test','key',h.j,h.transport,{storage:h.storage}),{outcome:'REJECTED',reason:'video_preflight_failed'});assert.equal(h.calls.length,0);assert.equal(h.downloads.length,1);}
 const h=fixture();assert.deepEqual(await deliverTelegramPublication('https://service.test','key',h.j,h.transport),{outcome:'REJECTED',reason:'video_preflight_failed'});assert.equal(h.calls.length,0);
});
test('storage timeout is bounded before a send and target preflight still checks current permission',async()=>{
 const h=fixture({badTarget:true});assert.deepEqual(await deliverTelegramPublication('https://service.test','key',h.j,h.transport,{storage:h.storage}),{outcome:'REJECTED',reason:'target_preflight_failed'});assert.equal(h.sends,0);
 await assert.rejects(readPublicationVideo({from:()=>({download:()=>new Promise(()=>{})})},job().video_snapshot,{timeoutMs:5}),/не ответило/);
});
test('video caption length uses Unicode codepoints and optional Telegram file_size stays null',async()=>{
 const j=job();j.body='😀'.repeat(1024);const h=fixture({j,resultChange:{video:{file_id:'f',file_unique_id:'u',width:1280,height:720,duration:2}}});const out=await deliverTelegramPublication('https://service.test','key',j,h.transport,{storage:h.storage});assert.equal(out.outcome,'SENT');assert.equal(out.video.file_size,null);assert.equal(h.sends,1);
});
test('ambiguous video send or malformed media receipt is UNKNOWN and never retried',async()=>{
 const validVideo={file_id:'file',file_unique_id:'unique',width:1280,height:720,duration:2,file_size:1024};
 const changes=[{caption:'changed'},{text:job().body,caption:undefined},{video:undefined},{video:{...validVideo,file_id:''}},{video:{...validVideo,file_unique_id:' '.repeat(5)}},{video:{...validVideo,width:1080}},{video:{...validVideo,height:'720'}},{video:{...validVideo,duration:2.5}},{video:{...validVideo,duration:7}},{video:{...validVideo,file_size:0}},{video:{...validVideo,file_size:9007199254740992}},{chat:{id:-100999,type:'channel',username:'public_channel'}},{message_id:0}];
 for(const options of [{sendThrow:true},{sendStatus:503,envelope:{ok:false,error_code:500}},{sendStatus:408,envelope:{ok:false,error_code:408}},{envelope:{ok:'true',result:{}}},...changes.map(resultChange=>({resultChange}))]){
  const h=fixture(options),out=await deliverTelegramPublication('https://service.test','key',h.j,h.transport,{storage:h.storage});assert.equal(out.outcome,'UNKNOWN');assert.equal(h.sends,1);assert.equal(h.downloads.length,1);assert.equal(JSON.stringify(out).includes(token),false);
 }
});
test('explicit Telegram video rejection remains definitely rejected after one attempt',async()=>{
 for(const code of [400,403,429]){const h=fixture({sendStatus:code,envelope:{ok:false,error_code:code,description:'private detail '+token}});assert.deepEqual(await deliverTelegramPublication('https://service.test','key',h.j,h.transport,{storage:h.storage}),{outcome:'REJECTED',reason:'provider_rejected'});assert.equal(h.sends,1);}
});
test('upstream text and video clients retain separate method allowlists',async()=>{
 let calls=0;const transport=async()=>{calls++;return Response.json({ok:true,result:{}});};
 await assert.rejects(publicationTelegramApi(token,transport).raw.sendVideo({chat_id:'1',video:'file_id'}));
 await assert.rejects(videoPublicationTelegramApi(token,transport).raw.sendMessage({chat_id:'1',text:'x'}));assert.equal(calls,0);
});
test('failed persistence after actual multipart video upload never sends again',async()=>{
 const h=fixture();let queries=0;
 const out=await dispatchContentPublication({query:async()=>{if(++queries===1)return[{result:{job:h.j}}];throw Error('database unavailable');}},j=>deliverTelegramPublication('https://service.test','key',j,h.transport,{storage:h.storage}));assert.equal(h.sends,1);assert.equal(h.downloads.length,1);assert.equal(out.receipt_saved,false);assert.equal(out.unknown,1);
});
test('video scheduling maps only confirmed artifact identifiers to canonical SQL',async()=>{
 const input={id,request_id:claim,video_job_id:id,video_version:4,artifact_sha256:digest,video_confirmed:true};let args;
 await scheduleContentPublication({query:async(q,p)=>{args=p;return[{result:{ok:true,id,job:{}}}];}},'schedule-video-publication',input,'actor',['content.approve']);assert.equal(args[0],'schedule-video');assert.deepEqual(JSON.parse(args[1]),input);
 await assert.rejects(scheduleContentPublication({query:()=>assert.fail('not queried')},'schedule-video-publication',{...input,video_confirmed:false},'actor',['*']));
});
test('existing manager sender receives its private storage adapter without exposing it to browser',()=>{
 const s=readFileSync(new URL('../server/supabase/pcs-manager-live2/index.ts',import.meta.url),'utf8');assert.match(s,/deliverTelegramPublication\(base,key,job,fetch,\{storage:createClient\(base,key,\{auth:\{persistSession:false\}\}\)\.storage\}\)/);
});
