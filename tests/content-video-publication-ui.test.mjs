import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const source=readFileSync(new URL('../pcs-ai-operator-v6/content-workflow.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const video=(extra={})=>({id:'video-1',version:8,revision:1,brand_version:2,artifact_sha256:'a'.repeat(64),preset:'landscape',width:1280,height:720,duration_seconds:2.125,...extra});
const post=(extra={})=>({id:'post',brand_id:'brand',brand_name:'PCS',version:4,status:'APPROVED',approved_revision:1,current_brand_version:2,revision:{revision:1,brand_version:2,title:'Title',body:'Approved caption',platform:'telegram',language:'ru',qa:{flags:[]}},...extra});
function fixture(t,options={}){
 const p=options.p||post(),dom=new JSDOM('<main id="sheet"></main>',{url:'https://pcs.example.test',runScripts:'outside-only'}),w=dom.window;
 t.after(()=>w.close());let epoch=0;const requests=[],queue=[];
 const response={permissions:['*'],capabilities:{video_publication:{version:1}},approved_videos:[video()],posts:[p],brands:[],history:[],platforms:['telegram'],languages:['ru'],targets:[{id:'target',brand_id:'brand',enabled:true,version:3,username:'pcs_channel',title:'PCS',verified_at:'2026-11-01'}],...options.response};
 w.HTMLElement.prototype.scrollIntoView=()=>{};w.openSheet=(_title,html)=>{epoch++;w.document.getElementById('sheet').innerHTML=html;};w.pcsSheetLifecycle={capture:()=>epoch,current:ticket=>ticket===epoch};
 w.pcsManagerRequest=(op,options)=>{requests.push({op,...JSON.parse(JSON.stringify(options))});return queue.length?queue.shift()():Promise.resolve(response);};w.eval(source);
 const q=s=>w.document.querySelector(s),open=()=>w.pcsContent.open({id:p.id});
 return {w,p,requests,queue,q,open,close:()=>{epoch++;},form:()=>q('[data-publication-schedule]'),mode:(value='VIDEO')=>{const select=q('[name=media_kind]');select.value=value;select.dispatchEvent(new w.Event('change'));},fill:()=>{const f=q('[data-publication-schedule]');f.elements.target_id.value='target';f.elements.scheduled_at.value='2099-01-21T10:30';f.elements.publication_confirmed.checked=true;},submit:()=>q('[data-publication-schedule]').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}))};
}
test('video scheduling is capability/permission/current-source gated while legacy TEXT stays default',async t=>{
 for(const response of [{capabilities:{}},{capabilities:{video_publication:{version:'1'}}},{capabilities:{video_publication:{version:2}}},{approved_videos:[]},{approved_videos:[video({revision:2})]},{approved_videos:[video({brand_version:1})]},{approved_videos:[video({artifact_sha256:'bad'})]}]){const h=fixture(t,{response});await h.open();assert.ok(h.form());assert.equal(h.q('[name=media_kind]'),null);}
 for(const permissions of [['content.view'],['content.edit']]){const h=fixture(t,{response:{permissions}});await h.open();assert.equal(h.form(),null);}
 const h=fixture(t);await h.open();assert.equal(h.q('[name=media_kind]').value,'TEXT');assert.equal(h.q('[data-publication-video]').hidden,true);assert.equal(h.q('[name=video_job_id]').disabled,true);assert.equal(h.q('[name=video_confirmed]').required,false);assert.equal(h.q('[name=video_confirmed]').checked,false);
 h.fill();h.submit();assert.equal(h.requests[1].body.action,'schedule-publication');assert.equal(Object.hasOwn(h.requests[1].body,'video_job_id'),false);assert.equal(Object.hasOwn(h.requests[1].body,'media_kind'),false);
});
test('explicit VIDEO sends only frozen identity/version/hash and suppresses double taps, reusing uncertain retry ID',async t=>{
 const h=fixture(t);await h.open();h.fill();h.mode();const f=h.form();assert.equal(h.q('[data-publication-video]').hidden,false);assert.equal(f.elements.video_job_id.required,true);assert.equal(f.elements.video_confirmed.required,true);
 f.elements.video_job_id.value='video-1';f.elements.video_confirmed.checked=true;const pending=deferred();h.queue.push(()=>pending.promise);h.submit();h.submit();assert.equal(h.requests.length,2);const body=h.requests[1].body;
 assert.deepEqual({...body,request_id:'uuid',scheduled_at:'time'},{action:'schedule-video-publication',id:'post',expected_version:4,target_id:'target',target_version:3,scheduled_at:'time',publication_confirmed:true,video_job_id:'video-1',video_version:8,artifact_sha256:'a'.repeat(64),video_confirmed:true,request_id:'uuid'});
 assert.match(body.request_id,/^[a-f0-9-]{36}$/);for(const field of f.querySelectorAll('[name]'))assert.equal(field.disabled,true);assert.equal(f.querySelector('[type=submit]').disabled,true);
 pending.reject(Error('Network'));await tick();assert.match(h.q('[data-publication-error]').textContent,/Network/);assert.equal(f.elements.video_job_id.disabled,false);assert.equal(f.elements.media_kind.disabled,false);
 const retry=deferred();h.queue.push(()=>retry.promise);h.submit();assert.equal(h.requests[2].body.request_id,body.request_id);retry.resolve({ok:true,job:{}});await tick();assert.equal(h.requests[3].op,'content-workflow');
});
test('video choice and confirmation are mandatory; switching modes clears old consent and changes retry signature',async t=>{
 const h=fixture(t,{response:{approved_videos:[video(),video({id:'video-2',version:9,artifact_sha256:'b'.repeat(64)})]}});await h.open();h.fill();h.mode();h.submit();assert.equal(h.requests.length,1);assert.match(h.q('[data-publication-error]').textContent,/Выберите одобренный/);
 h.form().elements.video_job_id.value='video-1';h.submit();assert.equal(h.requests.length,1);h.form().elements.video_confirmed.checked=true;h.queue.push(()=>Promise.reject(Error('Network')));h.submit();await tick();const first=h.requests[1].body.request_id;
 h.form().elements.video_job_id.value='video-2';h.form().elements.video_job_id.dispatchEvent(new h.w.Event('change'));assert.equal(h.form().elements.video_confirmed.checked,false);h.submit();assert.equal(h.requests.length,2);h.form().elements.video_confirmed.checked=true;h.queue.push(()=>Promise.reject(Error('Network')));h.submit();await tick();assert.notEqual(h.requests[2].body.request_id,first);assert.equal(h.requests[2].body.artifact_sha256,'b'.repeat(64));
 h.mode('TEXT');assert.equal(h.form().elements.video_job_id.value,'');assert.equal(h.form().elements.video_confirmed.checked,false);assert.equal(h.form().elements.video_job_id.disabled,true);h.mode('VIDEO');assert.equal(h.form().elements.video_confirmed.checked,false);assert.equal(h.form().elements.video_job_id.value,'');
});
test('caption bounds count Unicode codepoints without truncation; longer video caption leaves text scheduling usable',async t=>{
 for(const [caption,accepted] of [['😀'.repeat(1024),true],['😀'.repeat(1025),false],['   ',false]]){const p=post();p.revision.body=caption;const h=fixture(t,{p});await h.open();h.fill();h.mode();h.form().elements.video_job_id.value='video-1';h.form().elements.video_confirmed.checked=true;h.queue.push(()=>Promise.reject(Error('Network')));h.submit();assert.equal(h.requests.length,accepted?2:1);if(!accepted){assert.match(h.q('[data-publication-error]').textContent,/до 1024/);h.mode('TEXT');h.submit();assert.equal(h.requests[1].body.action,'schedule-publication');}await tick();}
});
test('stale form handlers and late results cannot send or reopen after sheet navigation or editor round trip',async t=>{
 for(const reopen of [false,true]){const h=fixture(t);await h.open();h.fill();h.mode();h.form().elements.video_job_id.value='video-1';h.form().elements.video_confirmed.checked=true;const old=h.form();h.close();if(reopen)await h.open();const count=h.requests.length;old.dispatchEvent(new h.w.Event('submit',{cancelable:true}));assert.equal(h.requests.length,count);}
 const h=fixture(t);await h.open();h.fill();h.mode();h.form().elements.video_job_id.value='video-1';h.form().elements.video_confirmed.checked=true;const pending=deferred();h.queue.push(()=>pending.promise);h.submit();h.close();await h.open();const count=h.requests.length;pending.resolve({ok:true,job:{}});await tick();assert.equal(h.requests.length,count);assert.equal(h.q('[name=media_kind]').value,'TEXT');
 const x=fixture(t);await x.open();x.fill();const old=x.form();x.q('[data-brand]').click();old.dispatchEvent(new x.w.Event('submit',{cancelable:true}));assert.equal(x.requests.length,1);x.q('[data-cancel]').click();old.dispatchEvent(new x.w.Event('submit',{cancelable:true}));assert.equal(x.requests.length,1);
});
test('bounded approved file choices show full hash and preview disclosure; unavailable rows cannot be forged through DOM',async t=>{
 const h=fixture(t,{response:{approved_videos:Array.from({length:21},(_,i)=>video({id:'video-'+i})),approved_videos_truncated:true}});await h.open();h.mode();assert.equal(h.q('[name=video_job_id]').options.length,21);assert.match(h.q('[data-publication-video]').textContent,/только 20/);assert.ok(h.q('[data-publication-video]').textContent.includes('a'.repeat(64)));assert.match(h.q('[data-publication-video]').textContent,/Telegram создаёт собственное превью/);
 h.fill();h.q('[name=video_job_id]').append(new h.w.Option('forged','video-20'));h.form().elements.video_job_id.value='video-20';h.form().elements.video_confirmed.checked=true;h.submit();assert.equal(h.requests.length,1);
});
test('saved video source hash and accepted/unknown state remain distinct from public media verification',async t=>{
 for(const state of ['SENT','UNKNOWN']){const h=fixture(t,{p:post({status:state==='SENT'?'PUBLICATION_SENT':'READY',publication_job:{state,media_kind:'VIDEO',artifact_sha256:'c'.repeat(64),username:'pcs_channel',scheduled_at:'2099-01-21T10:30'}})});await h.open();const section=h.q('[aria-label="Отправка в Telegram"]');assert.match(section.textContent,/Формат: видео с подписью/);assert.match(section.textContent,/cccccccccccc…/);assert.equal(h.form(),null);if(state==='SENT'){assert.match(section.textContent,/содержимое видео проверяются отдельно/);assert.match(section.textContent,/Telegram может преобразовать видео/);}else assert.match(section.textContent,/Повторную отправку не запускайте/);}
});
test('approved selection and saved provider evidence are escaped',async t=>{
 const attack='<img src=x onerror="window.compromised=true">';const h=fixture(t,{response:{approved_videos:[video({id:attack})]}});await h.open();assert.ok(h.q('[name=video_job_id]').options[1].value.includes(attack));assert.equal(h.q('img,script'),null);
 const saved=fixture(t,{p:post({status:'PUBLICATION_SENT',publication_job:{state:'SENT',media_kind:'VIDEO',artifact_sha256:attack,username:attack,publication_url:attack,message_id:attack,scheduled_at:'2099-01-21T10:30'}})});await saved.open();assert.equal(saved.q('img,script,a'),null);assert.equal(saved.w.compromised,undefined);assert.ok(saved.q('[aria-label="Отправка в Telegram"]').textContent.includes(attack));
});
