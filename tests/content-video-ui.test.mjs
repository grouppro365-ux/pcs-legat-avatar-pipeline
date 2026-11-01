import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

const source=readFileSync(new URL('../pcs-ai-operator-v6/content-video.js',import.meta.url),'utf8');
const POST='11111111-1111-4111-8111-111111111111';
const JOB='22222222-2222-4222-8222-222222222222';
const HASH='a'.repeat(64);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const clone=x=>JSON.parse(JSON.stringify(x));
const data=(overrides={})=>({ok:true,post:{id:POST,version:7,revision:3,brand_version:2,platform:'instagram',title:'Тестовый материал',status:'DRAFT'},permissions:['content.view','content.edit','content.approve'],jobs:[],has_more:false,...overrides});
const job=(overrides={})=>({id:JOB,post_id:POST,version:5,revision:3,brand_version:2,stage:'READY',created_at:'2026-10-23',artifact:{sha256:HASH,width:1080,height:1920,duration_seconds:2.125},...overrides});
function harness(response=data()){
 const dom=new JSDOM('<main id="sheet"></main>',{url:'https://pcs.example.test/',runScripts:'outside-only'}),w=dom.window;
 let sheet=0,navigation=0;
 const calls=[],queue=[],back=[];
 w.openSheet=(_title,html)=>{sheet++;w.document.getElementById('sheet').innerHTML=html;};
 w.pcsSheetLifecycle={capture:()=>({sheet}),current:x=>x.sheet===sheet};
 w.pcsNavigation={capture:()=>({navigation}),isCurrent:x=>x.navigation===navigation};
 w.pcsContent={open:x=>back.push(x)};
 w.pcsManagerRequest=(op,options)=>{calls.push({op,options:clone(options)});return queue.length?queue.shift()(op,options):Promise.resolve(clone(response));};
 w.eval(source);
 return {dom,w,calls,queue,back,open:()=>w.pcsContentVideo.open(POST),close:()=>{sheet++;w.document.getElementById('sheet').innerHTML='<p>Другая вкладка</p>';},navigate:()=>{navigation++;},q:s=>w.document.querySelector(s)};
}
function fill(h){const f=h.q('[data-video-create]');f.elements.prompt_0.value='A green leaf moves in soft daylight';f.elements.confirmed.checked=true;f.elements.upscale_confirmed.checked=true;return f;}
const submit=(h,f)=>f.dispatchEvent(new h.w.Event('submit',{bubbles:true,cancelable:true}));
const signed=name=>'https://nnlzgertmmxuteozoeel.supabase.co/storage/v1/object/sign/pcs-content-video/jobs/'+JOB+'/claim/'+name+'?token=temporary';

test('read-only view escapes untrusted metadata and exposes no write forms',async t=>{
 const dangerous='<img src=x onerror="window.compromised=true">';
 const h=harness(data({post:{...data().post,title:dangerous},permissions:['content.view'],jobs:[job({stage:'FAILED',error_code:dangerous,provider_receipt:{ref:dangerous}})]}));t.after(()=>h.dom.window.close());
 await h.open();
 assert.equal(h.q('h3').textContent,dangerous);assert.equal(h.q('img'),null);assert.equal(h.w.compromised,undefined);
 assert.equal(h.q('form'),null);assert.equal(h.q('[data-video-cancel]'),null);
 assert.ok(h.q('[data-video-job]').textContent.includes(dangerous));
});

test('create carries current revision, selected scenes, explicit acknowledgements and guards duplicate taps',async t=>{
 const h=harness();t.after(()=>h.dom.window.close());await h.open();const f=fill(h);
 f.elements.count.value='2';f.elements.count.dispatchEvent(new h.w.Event('change'));
 f.elements.prompt_1.value='A second calm scene with green leaves';f.elements.seed_1.value='91';f.elements.frames_1.value='33';f.elements.preset.value='story';f.elements.fit.value='cover';
 assert.equal(h.q('[data-video-shot="1"]').hidden,false);assert.equal(h.q('[data-video-shot="2"]').hidden,true);
 const pending=deferred();h.queue.push(()=>pending.promise);submit(h,f);submit(h,f);h.q('[data-video-refresh]').click();
 assert.equal(h.calls.length,2);const c=h.calls[1];assert.equal(c.op,'content-video-action');
 assert.deepEqual({...c.options.body,request_id:'uuid'},{request_id:'uuid',action:'create',post_id:POST,expected_post_version:7,revision:3,spec:{version:1,mode:'TEXT_TO_VIDEO',preset:'story',fit:'cover',shots:[{prompt:'A green leaf moves in soft daylight',negative_prompt:'text, logo, watermark, distortion',seed:42,frames:17},{prompt:'A second calm scene with green leaves',negative_prompt:'text, logo, watermark, distortion',seed:91,frames:33}]},confirmed:true,upscale_confirmed:true});
 assert.match(c.options.body.request_id,/^[a-f0-9-]{36}$/);assert.ok([...f.querySelectorAll('input,textarea,select,button')].every(x=>x.disabled));
 pending.reject(new Error('Соединение прервано'));await tick();assert.ok([...f.querySelectorAll('input,textarea,select,button')].every(x=>!x.disabled));
 assert.match(h.q('[data-video-error]').textContent,/Соединение/);
});

test('uncertain write retries retain command UUID until operator changes its content',async t=>{
 const h=harness();t.after(()=>h.dom.window.close());await h.open();const f=fill(h);
 h.queue.push(()=>Promise.reject(new Error('timeout')));submit(h,f);await tick();
 h.queue.push(()=>Promise.reject(new Error('timeout')));submit(h,f);await tick();
 assert.equal(h.calls[1].options.body.request_id,h.calls[2].options.body.request_id);
 f.elements.prompt_0.value+=' and sunlight';h.queue.push(()=>Promise.reject(new Error('timeout')));submit(h,f);await tick();
 assert.notEqual(h.calls[2].options.body.request_id,h.calls[3].options.body.request_id);
});

test('native required acknowledgements prevent normal submission before consent',async t=>{
 const h=harness();t.after(()=>h.dom.window.close());await h.open();const f=fill(h);
 f.elements.confirmed.checked=false;f.requestSubmit();await tick();assert.equal(h.calls.length,1);
 f.elements.confirmed.checked=true;f.elements.upscale_confirmed.checked=false;f.requestSubmit();await tick();assert.equal(h.calls.length,1);
});

test('closed or navigated windows ignore late read responses and retained form submissions',async t=>{
 const h=harness();t.after(()=>h.dom.window.close());const pending=deferred();h.queue.push(()=>pending.promise);const opening=h.open();h.close();pending.resolve(data());await opening;
 assert.equal(h.q('#sheet').textContent,'Другая вкладка');assert.equal(h.q('#pcsContentVideoRoot'),null);
 await h.open();const f=fill(h);h.navigate();submit(h,f);assert.equal(h.calls.filter(x=>x.op==='content-video-action').length,0);
});

test('replacement window is not overwritten by an old read or successful write',async t=>{
 const h=harness();t.after(()=>h.dom.window.close());const oldRead=deferred();h.queue.push(()=>oldRead.promise);const oldOpen=h.open();await h.open();const root=h.q('#pcsContentVideoRoot');
 oldRead.resolve(data({post:{...data().post,title:'Устаревший ответ'}}));await oldOpen;assert.equal(h.q('#pcsContentVideoRoot'),root);assert.equal(h.q('h3').textContent,'Тестовый материал');
 const f=fill(h),oldWrite=deferred();h.queue.push(()=>oldWrite.promise);submit(h,f);h.close();oldWrite.resolve({ok:true,job:job()});await tick();assert.equal(h.q('#sheet').textContent,'Другая вкладка');assert.equal(h.calls.filter(x=>x.op==='content-video').length,2);
 submit(h,f);assert.equal(h.calls.filter(x=>x.op==='content-video-action').length,1);
});

test('review binds decision to exact artifact hash and stale revisions cannot be approved',async t=>{
 const h=harness(data({jobs:[job(),job({id:'33333333-3333-4333-8333-333333333333',revision:2})]}));t.after(()=>h.dom.window.close());await h.open();
 assert.equal(h.w.document.querySelectorAll('[data-video-review]').length,1);
 const f=h.q('[data-video-review]');f.elements.confirmed.checked=true;f.elements.note.value='Проверены кадры, язык, факты и правила бренда.';f.elements.decision.value='REJECTED';h.queue.push(()=>Promise.reject(new Error('test abort')));submit(h,f);await tick();
 assert.deepEqual({...h.calls[1].options.body,request_id:'uuid'},{request_id:'uuid',action:'review',job_id:JOB,expected_version:5,artifact_sha256:HASH,decision:'REJECTED',confirmed:true,note:'Проверены кадры, язык, факты и правила бренда.'});
});

test('media race preserves latest cover selection and rejects external URLs',async t=>{
 const h=harness(data({jobs:[job()]}));t.after(()=>h.dom.window.close());await h.open();
 const video=deferred(),cover=deferred();h.queue.push(()=>video.promise,()=>cover.promise);h.q('[data-video-preview]').click();h.q('[data-video-cover]').click();
 cover.resolve({ok:true,url:signed('cover.png')});await tick();assert.equal(h.q('[data-video-media] img').src,signed('cover.png'));
 video.resolve({ok:true,url:signed('final.mp4')});await tick();assert.equal(h.q('[data-video-media] video'),null);assert.ok(h.q('[data-video-media] img'));
 h.queue.push(()=>Promise.resolve({ok:true,url:'https://evil.example/video.mp4'}));h.q('[data-video-preview]').click();await tick();assert.equal(h.q('[data-video-media] video'),null);assert.match(h.q('[data-video-media]').textContent,/Некорректная ссылка/);
});

test('late media cannot populate retained closed DOM',async t=>{
 const h=harness(data({jobs:[job()]}));t.after(()=>h.dom.window.close());await h.open();const box=h.q('[data-video-media]'),pending=deferred();h.queue.push(()=>pending.promise);h.q('[data-video-preview]').click();h.close();pending.resolve({ok:true,url:signed('final.mp4')});await tick();assert.equal(box.querySelector('video'),null);assert.equal(h.q('#sheet').textContent,'Другая вкладка');
});

test('unknown GPU resolution requires an explicit provider check and preserves evidence note',async t=>{
 const h=harness(data({jobs:[job({stage:'FAILED',error_code:'GPU_LAUNCH_UNKNOWN'})]}));t.after(()=>h.dom.window.close());await h.open();const f=h.q('[data-video-resolve]');assert.ok(f);assert.equal(h.q('[data-video-review]'),null);
 f.elements.note.value='Проверена принятая версия Kaggle: вычисление завершено.';f.requestSubmit();await tick();assert.equal(h.calls.length,1);
 f.elements.provider_checked.checked=true;h.queue.push(()=>Promise.reject(new Error('test abort')));submit(h,f);await tick();
 assert.deepEqual({...h.calls[1].options.body,request_id:'uuid'},{request_id:'uuid',action:'resolve-unknown',job_id:JOB,expected_version:5,provider_checked:true,note:'Проверена принятая версия Kaggle: вычисление завершено.'});
});

test('mismatched post responses and read errors never expose write controls',async t=>{
 const h=harness(data({post:{...data().post,id:JOB}}));t.after(()=>h.dom.window.close());await h.open();assert.match(h.q('[data-video-error]').textContent,/Некорректный ответ/);assert.equal(h.q('form'),null);
 h.queue.push(()=>Promise.reject(new Error('Доступ к материалу закрыт')));await h.open();assert.match(h.q('[data-video-error]').textContent,/Доступ/);assert.equal(h.q('form'),null);
});

test('published posts expose existing results but cannot start a new generation',async t=>{
 const h=harness(data({post:{...data().post,status:'PUBLICATION_SENT'},jobs:[job()]}));t.after(()=>h.dom.window.close());await h.open();assert.equal(h.q('[data-video-create]'),null);assert.ok(h.q('[data-video-preview]'));
});

const captionData=(overrides={})=>data({capabilities:{finishing:{version:1}},...overrides});
function enableCaptions(h,f,{language='ru',count=1}={}){
 f.elements.captions_enabled.checked=true;f.elements.captions_enabled.dispatchEvent(new h.w.Event('change'));f.elements.caption_language.value=language;f.elements.caption_count.value=String(count);f.elements.caption_count.dispatchEvent(new h.w.Event('change'));return f;
}
function cue(f,index,start,end,text){f.elements['caption_start_'+index].value=String(start);f.elements['caption_end_'+index].value=String(end);f.elements['caption_text_'+index].value=text;}

test('caption editor requires exact finishing capability and absent capability preserves v1 wire format',async t=>{
 for(const capabilities of [undefined,{}, {finishing:{version:0}},{finishing:{version:'1'}}]){
  const h=harness(data({capabilities}));t.after(()=>h.dom.window.close());await h.open();const f=fill(h);assert.equal(f.elements.captions_enabled,undefined);assert.equal(h.q('[data-video-captions]'),null);h.queue.push(()=>Promise.reject(Error('stop')));submit(h,f);await tick();assert.equal(h.calls[1].options.body.spec.version,1);assert.equal(Object.hasOwn(h.calls[1].options.body.spec,'finishing'),false);
 }
 const h=harness(captionData());t.after(()=>h.dom.window.close());await h.open();const f=fill(h);assert.equal(h.q('[data-video-captions]').hidden,true);h.queue.push(()=>Promise.reject(Error('stop')));submit(h,f);await tick();assert.equal(h.calls[1].options.body.spec.version,1);assert.equal(Object.hasOwn(h.calls[1].options.body.spec,'finishing'),false);
});

test('captions create exact v2 RU Unicode multiline cues rounded to 24fps with explicit private GPU consents',async t=>{
 const h=harness(captionData({post:{...data().post,language:'ru'}}));t.after(()=>h.dom.window.close());await h.open();const f=enableCaptions(h,fill(h),{count:2});
 cue(f,0,0.03,1.04,'Точный текст\nЕщё строка');cue(f,1,1.05,2.125,'Финал 😀');h.queue.push(()=>Promise.reject(Error('stop')));submit(h,f);await tick();const body=h.calls[1].options.body;
 assert.equal(body.confirmed,true);assert.equal(body.upscale_confirmed,true);assert.equal(body.spec.version,2);assert.deepEqual(body.spec.finishing,{version:1,style:'readable-v1',language:'ru',cues:[{start_frame:1,end_frame:25,text:'Точный текст\nЕщё строка'},{start_frame:25,end_frame:51,text:'Финал 😀'}]});assert.equal(body.spec.shots.length,1);assert.match(body.spec.shots[0].prompt,/green leaf/);
 const notice=h.q('[data-video-captions]').textContent;assert.match(notice,/не передаётся в Kaggle/);assert.match(notice,/Озвучка не создаётся/);
});

test('caption toggle/count synchronize required fields, visibility, bounds and shot-duration updates',async t=>{
 const h=harness(captionData());t.after(()=>h.dom.window.close());await h.open();const f=fill(h);assert.equal(f.elements.caption_text_0.required,false);enableCaptions(h,f,{count:3});
 for(let i=0;i<12;i++){const visible=i<3;assert.equal(h.q(`[data-video-cue="${i}"]`).hidden,!visible);for(const name of ['caption_start_','caption_end_','caption_text_'])assert.equal(f.elements[name+i].required,visible);assert.equal(f.elements['caption_end_'+i].max,'2.125');}
 f.elements.count.value='2';f.elements.count.dispatchEvent(new h.w.Event('change'));f.elements.frames_1.value='33';f.elements.frames_1.dispatchEvent(new h.w.Event('change'));assert.match(h.q('[data-video-duration]').textContent,/6\.25 сек/);assert.equal(f.elements.caption_end_0.max,'6.25');
 f.elements.frames_0.value='33';f.elements.frames_0.dispatchEvent(new h.w.Event('change'));assert.match(h.q('[data-video-duration]').textContent,/8\.25 сек/);
 f.elements.captions_enabled.checked=false;f.elements.captions_enabled.dispatchEvent(new h.w.Event('change'));assert.equal(h.q('[data-video-captions]').hidden,true);assert.ok([...h.q('[data-video-captions]').querySelectorAll('input,textarea')].every(el=>!el.required));
});

test('unused or disabled caption drafts cannot block native form validation or leak into v1 requests',async t=>{
 const h=harness(captionData());t.after(()=>h.dom.window.close());await h.open();const f=enableCaptions(h,fill(h),{count:2});
 cue(f,0,0,1,'Valid caption');cue(f,1,0,999,'Invalid inactive draft');assert.equal(f.checkValidity(),false);
 f.elements.caption_count.value='1';f.elements.caption_count.dispatchEvent(new h.w.Event('change'));assert.equal(f.checkValidity(),true);
 cue(f,0,0,999,'Disabled draft');f.elements.captions_enabled.checked=false;f.elements.captions_enabled.dispatchEvent(new h.w.Event('change'));assert.equal(f.checkValidity(),true);
 h.queue.push(()=>Promise.reject(Error('retain form')));f.requestSubmit();await tick();assert.equal(h.calls.at(-1).options.body.spec.version,1);assert.equal(Object.hasOwn(h.calls.at(-1).options.body.spec,'finishing'),false);
 assert.equal(f.checkValidity(),true);
});

test('caption validation blocks overlap, outside duration, invalid text, ASS and controls before API',async t=>{
 const h=harness(captionData());t.after(()=>h.dom.window.close());await h.open();const f=enableCaptions(h,fill(h),{count:2});
 const invalid=[[[0,1.5,'First'],[1,2,'Overlap']],[[0,1,'First'],[1,3,'Outside']],[[0,0,'Zero'],[1,2,'Next']],[[0,1,'a'.repeat(37)],[1,2,'Next']],[[0,1,'a'.repeat(36)+'\n'+'b'.repeat(36)],[1,2,'Next']],[[0,1,'one\ntwo\nthree'],[1,2,'Next']],[[0,1,'one\n '],[1,2,'Next']],[[0,1,'{\\pos(1,2)}'],[1,2,'Next']],[[0,1,'unsafe\u202e text'],[1,2,'Next']],[[0,1,'unsafe\t text'],[1,2,'Next']],[[0,1,''],[1,2,'Next']]];
 for(const cues of invalid){cues.forEach((c,i)=>cue(f,i,...c));submit(h,f);await tick();assert.equal(h.calls.length,1,JSON.stringify(cues));assert.ok(h.q('[data-video-error]').textContent);}
 cue(f,0,0,1,'First');cue(f,1,1,2,'Last');f.elements.caption_start_0.value='';submit(h,f);await tick();assert.equal(h.calls.length,1);
});

test('captions do not bypass required private GPU and upscale acknowledgements in normal submission',async t=>{
 const h=harness(captionData());t.after(()=>h.dom.window.close());await h.open();const f=enableCaptions(h,fill(h),{language:'en'});cue(f,0,0,2,'Reviewed English title');f.elements.confirmed.checked=false;f.requestSubmit();await tick();assert.equal(h.calls.length,1);f.elements.confirmed.checked=true;f.elements.upscale_confirmed.checked=false;f.requestSubmit();await tick();assert.equal(h.calls.length,1);
});

test('caption commands freeze fields and reuse UUID for exact retry but change UUID after a cue edit',async t=>{
 const h=harness(captionData());t.after(()=>h.dom.window.close());await h.open();const f=enableCaptions(h,fill(h),{language:'en'});cue(f,0,0,2,'Exact English caption');const pending=deferred();h.queue.push(()=>pending.promise);submit(h,f);submit(h,f);assert.equal(h.calls.length,2);assert.ok([...f.querySelectorAll('input,textarea,select,button')].every(x=>x.disabled));pending.reject(Error('lost response'));await tick();assert.ok([...f.querySelectorAll('input,textarea,select,button')].every(x=>!x.disabled));h.queue.push(()=>Promise.reject(Error('retry')));submit(h,f);await tick();assert.deepEqual(h.calls[2].options.body,h.calls[1].options.body);f.elements.caption_text_0.value='Edited English caption';h.queue.push(()=>Promise.reject(Error('retry')));submit(h,f);await tick();assert.notEqual(h.calls[3].options.body.request_id,h.calls[2].options.body.request_id);
});

test('late caption write leaves replacement window and its draft unchanged',async t=>{
 const h=harness(captionData());t.after(()=>h.dom.window.close());await h.open();const old=enableCaptions(h,fill(h));cue(old,0,0,2,'Old caption');const pending=deferred();h.queue.push(()=>pending.promise);submit(h,old);await h.open();const current=enableCaptions(h,fill(h));cue(current,0,0,2,'New unsaved caption');const root=h.q('#pcsContentVideoRoot');pending.resolve({ok:true,job:job()});await tick();assert.equal(h.q('#pcsContentVideoRoot'),root);assert.equal(current.elements.caption_text_0.value,'New unsaved caption');assert.equal(current.elements.caption_text_0.disabled,false);submit(h,old);assert.equal(h.calls.filter(x=>x.op==='content-video-action').length,1);
});

test('persisted job caption text is displayed exactly and escaped without executable markup',async t=>{
 const text='<img src=x onerror="alert(1)">\nТочный текст';const h=harness(captionData({jobs:[job({spec:{version:2,finishing:{version:1,style:'readable-v1',language:'ru',cues:[{start_frame:1,end_frame:25,text}]}}})]}));t.after(()=>h.dom.window.close());await h.open();const details=[...h.w.document.querySelectorAll('[data-video-job] details')].find(el=>el.textContent.includes('Заданные титры'));assert.ok(details);assert.ok(details.textContent.includes(text));assert.match(details.textContent,/0\.042–1\.042 сек/);assert.equal(details.querySelector('img'),null);assert.equal(details.querySelector('script'),null);
});
