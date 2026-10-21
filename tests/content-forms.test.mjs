import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const source=readFileSync(new URL('../pcs-ai-operator-v6/content-workflow.js',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};};
class Element {
 constructor(){this.children=[];this.controls=new Map();this.elements={};this.isConnected=false;this.disabled=false;}
 set innerHTML(html){for(const c of this.children)c.isConnected=false;this.children=[];this.controls.clear();this.html=html;
  for(const m of html.matchAll(/name="([^"]+)"/g))this.elements[m[1]]={value:''};
 }
 get innerHTML(){return this.html;}
 append(el){this.children.push(el);el.isConnected=true;}
 scrollIntoView(){}
 addEventListener(type,fn){this['on'+type]=fn;}
 querySelector(selector){if(!this.controls.has(selector)){
  const key=selector.slice(1,-1);if(!this.html.includes(key)&&!this.html.includes(key.replace('=','=\"')+'\"'))return null;
  this.controls.set(selector,new Element());
 }return this.controls.get(selector);}
 querySelectorAll(selectors){if(selectors==='[name]')return Object.values(this.elements);return selectors.split(',').map(s=>this.querySelector(s)).filter(Boolean);}
}
async function fixture(){
 let root,epoch=0;const requests=[],sheets=[];
 const document={getElementById:id=>id==='pcsContentRoot'?root:null,createElement:()=>new Element(),addEventListener(){}};
 const window={pcsSheetLifecycle:{capture:()=>epoch,current:t=>t===epoch},
  openSheet(){epoch++;root=new Element();root.innerHTML='Loading';root.isConnected=true;sheets.push(root);},
  pcsManagerRequest(op,opt){const d=deferred();requests.push({op,...opt,...d});return d.promise;}};
 class FormData {constructor(form){this.entries=Object.entries(form.elements).filter(([,v])=>!v.disabled).map(([k,v])=>[k,v.value]);}get(key){return this.entries.find(([k])=>k===key)?.[1]??null;}[Symbol.iterator](){return this.entries[Symbol.iterator]();}}
 vm.runInNewContext(source,{window,document,FormData,crypto:{randomUUID},Date});
 const opened=window.pcsContent.open();requests[0].resolve({permissions:['*'],brands:[{id:'brand',name:'PCS',version:2,guidelines:'Accurate'}],posts:[],platforms:['telegram'],languages:['ru']});await opened;
 return{window,requests,sheets,get root(){return root;},invalidate(){epoch++;},edit(kind='new'){root.querySelector(`[data-${kind}]`).onclick();const form=root.children[0];if(kind==='brand'){form.elements.name.value='PCS';form.elements.guidelines.value='Accurate';}else for(const [k,v] of Object.entries({brand_id:'brand',platform:'telegram',language:'ru',title:'Title',source_facts:'Facts',source_url:'https://example.test',body:'Body'}))form.elements[k].value=v;return form;}};
}
const submit=form=>form.onsubmit({preventDefault(){},submitter:null});
for(const kind of ['new','brand']){
 test(`${kind}: repeated submit while saving makes one request, including keyboard submit`,async()=>{
  const f=await fixture(),form=f.edit(kind),saving=submit(form);await submit(form);
  assert.equal(f.requests.length,2);assert.equal(form.querySelector('[type=submit]').disabled,true);
  f.requests[1].reject(new Error('Retry'));await saving;assert.equal(form.querySelector('[type=submit]').disabled,false);assert.equal(form.querySelector('[data-error]').textContent,'Retry');
 });
 test(`${kind}: cancel and open another form suppresses old save success`,async()=>{
  const f=await fixture(),form=f.edit(kind),saving=submit(form);form.querySelector('[data-cancel]').onclick();const replacement=f.edit(kind);
  f.requests[1].resolve({id:'old'});await saving;
  assert.equal(f.sheets.length,1);assert.equal(f.requests.length,2);assert.equal(f.root.children[0],replacement);
 });
 test(`${kind}: current successful save opens the saved result`,async()=>{
  const f=await fixture(),form=f.edit(kind),saving=submit(form);f.requests[1].resolve({id:'saved'});await saving;
  assert.equal(f.sheets.length,2);assert.equal(f.requests.length,3);assert.equal(f.requests[2].op,'content-workflow');assert.equal(f.requests[2].params.id,kind==='brand'?undefined:'saved');
  f.requests[2].resolve({permissions:['*'],brands:[],posts:[],platforms:[],languages:[]});await Promise.resolve();
 });
 test(`${kind}: failure of a cancelled save cannot touch the replacement editor`,async()=>{
  const f=await fixture(),form=f.edit(kind),saving=submit(form);form.querySelector('[data-cancel]').onclick();const replacement=f.edit(kind);f.requests[1].reject(new Error('Old failure'));await saving;
  assert.equal(replacement.querySelector('[data-error]').textContent,undefined);assert.equal(f.root.children[0],replacement);
 });
 test(`${kind}: retries reuse a request ID only for the same payload`,async()=>{
  const f=await fixture(),form=f.edit(kind);let saving=submit(form);f.requests[1].reject(new Error('Network'));await saving;
  saving=submit(form);assert.equal(f.requests[2].body.request_id,f.requests[1].body.request_id);f.requests[2].reject(new Error('Network'));await saving;
  form.elements[kind==='brand'?'guidelines':'body'].value='Changed';saving=submit(form);assert.notEqual(f.requests[3].body.request_id,f.requests[2].body.request_id);f.requests[3].reject(new Error('Network'));await saving;
 });
 test(`${kind}: closing the sheet with mounted nodes prevents a save from reopening it`,async()=>{
  const f=await fixture(),form=f.edit(kind),saving=submit(form);f.invalidate();f.requests[1].resolve({id:'old'});await saving;assert.equal(f.sheets.length,1);assert.equal(f.requests.length,2);
 });
}
test('brand editor and content editor cannot accumulate duplicate forms',async()=>{
 const f=await fixture();f.edit('brand');f.root.querySelector('[data-brand]').onclick();f.root.querySelector('[data-new]').onclick();assert.equal(f.root.children.length,1);assert.equal(f.root.querySelector('[data-brand]').disabled,true);
});
test('generation rejects changed inputs and does not overlap a save',async()=>{
 const f=await fixture(),form=f.edit(),generate=form.querySelector('[data-generate]');const generating=generate.onclick({currentTarget:generate});await submit(form);assert.equal(f.requests.length,2);
 form.elements.source_facts.value='Changed facts';f.requests[1].resolve({body:'Stale generated body'});await generating;
 assert.equal(form.elements.body.value,'Body');assert.match(form.querySelector('[data-error]').textContent,/Поля изменились/);assert.equal(generate.disabled,false);
});
test('cancelled generation cannot edit a replacement form',async()=>{
 const f=await fixture(),form=f.edit(),generate=form.querySelector('[data-generate]');const generating=generate.onclick({currentTarget:generate});form.querySelector('[data-cancel]').onclick();const replacement=f.edit();f.requests[1].resolve({body:'Stale'});await generating;assert.equal(replacement.elements.body.value,'Body');
});
test('late load cannot paint a sheet closed while its root remains mounted',async()=>{
 const f=await fixture();const loading=f.window.pcsContent.open();f.invalidate();f.requests[1].resolve({permissions:['*'],brands:[],posts:[],platforms:[],languages:[]});await loading;assert.equal(f.root.innerHTML,'Loading');
});

async function contentDetail(f,overrides={},permissions=['*']){
 const post={id:'post',brand_name:'PCS',brand_id:'brand',version:4,status:'PUBLICATION_REPORTED',current_brand_version:2,publication_url:'https://t.me/test_channel/42',revision:{revision:1,title:'PCS',platform:'telegram',language:'ru',brand_version:2,body:'Confirmed body',qa:{flags:[]}},...overrides};
 const opening=f.window.pcsContent.open({id:post.id});f.requests.at(-1).resolve({permissions,brands:[],posts:[post],history:[],platforms:['telegram'],languages:['ru']});await opening;return post;
}
test('reported Telegram verification shows observed scope, preserves command retry and suppresses duplicate clicks',async()=>{
 const f=await fixture();await contentDetail(f,{publication_verification:{outcome:'TEXT_MATCH',checked_at:'2026-10-20T12:00:00Z',revision:1}});
 assert.match(f.root.innerHTML,/только к публичному тексту/);assert.match(f.root.innerHTML,/совпадает/);
 const button=f.root.querySelector('[data-verify]');const sending=button.onclick({currentTarget:button});await button.onclick({currentTarget:button});assert.equal(f.requests.length,3);assert.equal(f.requests[2].body.action,'verify-publication');
 f.requests[2].reject(Error('Network'));await sending;const retry=button.onclick({currentTarget:button});assert.equal(f.requests[3].body.request_id,f.requests[2].body.request_id);f.requests[3].reject(Error('Network'));await retry;
});
test('verification control requires reported Telegram content and approval permission',async()=>{
 for(const [overrides,permissions] of [[{},['content.view']],[{status:'READY'},['*']],[{revision:{revision:1,title:'PCS',platform:'instagram',language:'ru',brand_version:2,body:'Body',qa:{flags:[]}}},['*']]]){const f=await fixture();await contentDetail(f,overrides,permissions);assert.doesNotMatch(f.root.innerHTML,/data-verify/);}
});
test('schedule detail names its timezone and preserves existing scheduled time',async()=>{
 const f=await fixture();await contentDetail(f,{status:'READY',scheduled_at:'2027-03-28T12:00:00Z'});assert.match(f.root.innerHTML,/В плане:/);assert.match(f.root.innerHTML,new RegExp(Intl.DateTimeFormat().resolvedOptions().timeZone));
});
test('nonexistent local DST time is rejected rather than silently shifted',async()=>{
 const original=process.env.TZ;process.env.TZ='Europe/Berlin';
 try{const f=await fixture();await contentDetail(f,{status:'APPROVED'});const form=f.root.querySelector('[data-schedule]');form.elements.scheduled_at={value:'2027-03-28T02:30'};
  form.onsubmit({preventDefault(){},currentTarget:form,submitter:null});assert.equal(f.requests.length,2);assert.match(f.root.querySelector('[data-message]').textContent,/Europe\/Berlin/);assert.match(f.root.querySelector('[data-message]').textContent,/существующие дату/);
 }finally{if(original===undefined)delete process.env.TZ;else process.env.TZ=original;}
});

test('verification finishing after brand editor opens cannot discard its unsaved draft',async()=>{
 const f=await fixture();await contentDetail(f);const button=f.root.querySelector('[data-verify]'),verifying=button.onclick({currentTarget:button});const form=f.edit('brand');form.elements.guidelines.value='New unsaved brand rules';
 f.requests[2].resolve({ok:true});await verifying;assert.equal(f.requests.length,3);assert.equal(f.root.children[0],form);assert.equal(form.elements.guidelines.value,'New unsaved brand rules');
});

test('generated draft describes limited editorial context without claiming a duplicate check',async()=>{
 const f=await fixture(),form=f.edit(),button=form.querySelector('[data-generate]');const pending=button.onclick({currentTarget:button});
 f.requests[1].resolve({body:'New draft',editorial_history:{count:20,limit:20,truncated:true}});await pending;
 assert.equal(form.elements.body.value,'New draft');assert.match(form.querySelector('[data-error]').textContent,/20 последних материалов/);assert.match(form.querySelector('[data-error]').textContent,/история ограничена/);assert.match(form.querySelector('[data-error]').textContent,/Семантическая проверка повторов не выполнена/);
});

for(const kind of ['new','brand'])test(`${kind}: save captures enabled fields before freezing and restores them after failure`,async()=>{
 const f=await fixture(),form=f.edit(kind),field=form.elements[kind==='brand'?'guidelines':'body'];field.disabled=false;
 const saving=submit(form);assert.equal(field.disabled,true);assert.equal(f.requests[1].body[kind==='brand'?'guidelines':'body'],kind==='brand'?'Accurate':'Body');
 f.requests[1].reject(Error('Network'));await saving;assert.equal(field.disabled,false);assert.equal(field.value,kind==='brand'?'Accurate':'Body');
});

const duplicateCheck=(extra={})=>({outcome:'NO_SIMILARITY_FOUND',matches:[],note:'No semantic similarity found in the compared sample.',revision:1,brand_version:2,checked_at:'2026-10-21T12:00:00Z',corpus_count:12,corpus_truncated:false,...extra});
test('semantic check control is limited to review and content approval permission',async()=>{
 for(const [status,permissions,visible] of [['REVIEW',['content.approve'],true],['REVIEW',['*'],true],['REVIEW',['content.edit'],false],['DRAFT',['*'],false],['APPROVED',['*'],false],['PUBLICATION_REPORTED',['*'],false]]){
  const f=await fixture();await contentDetail(f,{status},permissions);assert.equal(f.root.innerHTML.includes('data-check-duplicates'),visible);assert.doesNotMatch(f.root.innerHTML,/data-approve/);
 }
});
test('only a duplicate check for current revision and current brand rules unlocks approval',async()=>{
 for(const check of [null,duplicateCheck({revision:0}),duplicateCheck({brand_version:1}),duplicateCheck({outcome:'UNKNOWN'})]){
  const f=await fixture();await contentDetail(f,{status:'REVIEW',content_duplicate_check:check});assert.doesNotMatch(f.root.innerHTML,/data-approve/);assert.match(f.root.innerHTML,/Перед одобрением выполните AI-проверку/);
 }
 const f=await fixture();await contentDetail(f,{status:'REVIEW',content_duplicate_check:duplicateCheck()});assert.match(f.root.innerHTML,/data-approve/);assert.match(f.root.innerHTML,/name="duplicate_review_note"/);
 const oldBrand=await fixture();await contentDetail(oldBrand,{status:'REVIEW',current_brand_version:3,content_duplicate_check:duplicateCheck({brand_version:3})});assert.doesNotMatch(oldBrand.root.innerHTML,/data-approve/);
});
test('semantic observation escapes model fields and states limited cross-language sample and editor authority',async()=>{
 const f=await fixture();await contentDetail(f,{status:'REVIEW',content_duplicate_check:duplicateCheck({outcome:'POSSIBLE_DUPLICATE',note:'<img src=x onerror=alert(1)>',checked_at:'<unsafe>',matches:[{post_id:'<script>bad</script>',reason:'<b>Reason & details</b>'}],corpus_truncated:true})});
 assert.doesNotMatch(f.root.innerHTML,/<img|<script>|<b>Reason/);assert.match(f.root.innerHTML,/&lt;img/);assert.match(f.root.innerHTML,/&lt;script&gt;/);assert.match(f.root.innerHTML,/&lt;b&gt;Reason &amp; details/);
 assert.match(f.root.innerHTML,/Это AI-оценка, решение принимает редактор/);assert.match(f.root.innerHTML,/до 12 последних материалов того же бренда, на разных площадках и языках/);assert.match(f.root.innerHTML,/не подтверждает полную оригинальность или достоверность фактов/);assert.match(f.root.innerHTML,/история ограничена/);
});
function approvalForm(f,note=''){
 const form=f.root.querySelector('[data-approve]');form.innerHTML='<button type="submit">Approve</button>';for(const [key,value]of Object.entries({facts_checked:'on',review_note:'Fact and promise review',duplicate_review_note:note}))form.elements[key]={value};return form;
}
test('approval includes editor duplicate decision and refuses short notes for matches, possible duplicates or truncated history',async()=>{
 for(const check of [duplicateCheck({outcome:'POSSIBLE_DUPLICATE'}),duplicateCheck({matches:[{post_id:'other',reason:'Similar offer'}]}),duplicateCheck({corpus_truncated:true})]){
  const f=await fixture();await contentDetail(f,{status:'REVIEW',content_duplicate_check:check});assert.match(f.root.innerHTML,/name="duplicate_review_note"[^>]*required minlength="20"/);
  const form=approvalForm(f,'Too short');form.onsubmit({preventDefault(){},currentTarget:form,submitter:null});assert.equal(f.requests.length,2);assert.match(f.root.querySelector('[data-message]').textContent,/от 20 символов/);
  form.elements.duplicate_review_note.value='Editor reviewed similarity and accepts distinct practical value.';form.onsubmit({preventDefault(){},currentTarget:form,submitter:null});
  assert.equal(f.requests.length,3);assert.equal(f.requests[2].body.action,'approve');assert.equal(f.requests[2].body.facts_checked,true);assert.equal(f.requests[2].body.revision,1);assert.equal(f.requests[2].body.duplicate_review_note,form.elements.duplicate_review_note.value);f.requests[2].reject(Error('Test failure'));await Promise.resolve();
 }
});
test('no similarity in complete sample permits approval with an empty duplicate comment',async()=>{
 const f=await fixture();await contentDetail(f,{status:'REVIEW',content_duplicate_check:duplicateCheck()});assert.doesNotMatch(f.root.innerHTML,/name="duplicate_review_note"[^>]*required/);const form=approvalForm(f);
 form.onsubmit({preventDefault(){},currentTarget:form,submitter:null});assert.equal(f.requests.length,3);assert.equal(f.requests[2].body.duplicate_review_note,'');f.requests[2].reject(Error('Test failure'));await Promise.resolve();
});
test('semantic check uses versioned action, suppresses duplicate taps and reuses command after failure',async()=>{
 const f=await fixture();await contentDetail(f,{status:'REVIEW'});const button=f.root.querySelector('[data-check-duplicates]'),checking=button.onclick({currentTarget:button});await button.onclick({currentTarget:button});
 assert.equal(f.requests.length,3);assert.equal(f.requests[2].body.action,'check-duplicates');assert.equal(f.requests[2].body.id,'post');assert.equal(f.requests[2].body.expected_version,4);const id=f.requests[2].body.request_id;
 f.requests[2].reject(Error('AI unavailable'));await checking;assert.match(f.root.querySelector('[data-message]').textContent,/AI unavailable/);const retry=button.onclick({currentTarget:button});assert.equal(f.requests[3].body.request_id,id);f.requests[3].resolve({ok:true,id:'post',version:5});await retry;
 assert.equal(f.requests.length,5);assert.equal(f.requests[4].op,'content-workflow');assert.equal(f.requests[4].params.id,'post');
});
test('late semantic check cannot replace a closed sheet or a new unsaved brand form',async()=>{
 for(const replace of ['close','brand']){
  const f=await fixture();await contentDetail(f,{status:'REVIEW'});const button=f.root.querySelector('[data-check-duplicates]'),checking=button.onclick({currentTarget:button});let form;
  if(replace==='close')f.invalidate();else{form=f.edit('brand');form.elements.guidelines.value='Unsaved rules';}
  f.requests[2].resolve({ok:true});await checking;assert.equal(f.requests.length,3);if(form){assert.equal(f.root.children[0],form);assert.equal(form.elements.guidelines.value,'Unsaved rules');}
 }
});

test('empty saved corpus explicitly reports no comparison instead of an AI originality finding',async()=>{
 const f=await fixture();await contentDetail(f,{status:'REVIEW',content_duplicate_check:duplicateCheck({method:'EMPTY_CORPUS',corpus_count:0,note:'Других сохранённых материалов бренда нет.'})});
 assert.match(f.root.innerHTML,/Других материалов для сравнения нет/);assert.match(f.root.innerHTML,/AI-сравнение не выполнялось/);assert.doesNotMatch(f.root.innerHTML,/AI не обнаружил смысловых повторов|Это AI-оценка/);assert.match(f.root.innerHTML,/data-approve/);assert.match(f.root.innerHTML,/не подтверждает полную оригинальность или достоверность фактов/);
});
test('approval explains that matching revision alone does not establish corpus freshness',async()=>{
 const f=await fixture();await contentDetail(f,{status:'REVIEW',content_duplicate_check:duplicateCheck()});assert.match(f.root.innerHTML,/При одобрении сервер проверит актуальность выборки/);assert.match(f.root.innerHTML,/материалы бренда изменились после проверки/);
});

const savedTarget=(extra={})=>({id:'target',brand_id:'brand',version:3,username:'pcs_channel',title:'PCS channel',chat_id:'-100123',bot_id:'456',enabled:true,verified_at:'2026-10-21T12:00:00Z',...extra});
async function targetList(f,{permissions=['*'],targets=[],brands=[{id:'brand',name:'PCS',version:2}]}={}){
 const opening=f.window.pcsContent.open();f.requests.at(-1).resolve({permissions,targets,brands,posts:[],platforms:['telegram'],languages:['ru']});await opening;
}
function targetForm(f){f.root.querySelector('[data-targets]').onclick();const form=f.root.children[0];form.elements.brand_id.value='brand';form.elements.username.value='@PCS_Channel';return form;}
test('channel registry launcher requires approval permission, independently from edit permission',async()=>{
 for(const [permissions,visible]of [[['content.approve'],true],[['*'],true],[['content.edit'],false],[['content.view'],false]]){
  const f=await fixture();await targetList(f,{permissions});assert.equal(f.root.innerHTML.includes('data-targets'),visible);if(visible){const form=targetForm(f);assert.match(form.innerHTML,/Каналы публикации/);assert.match(form.innerHTML,/Сообщения не отправляются/);assert.match(form.innerHTML,/Автопубликация ещё не включена/);}
 }
});
test('saved targets show escaped brand, channel, title, verification time and registry state',async()=>{
 const f=await fixture();await targetList(f,{brands:[{id:'brand',name:'<img src=x>'}],targets:[savedTarget({username:'<script>evil</script>',title:'<b>Unsafe & title</b>',verified_at:'<time>',enabled:false})]});const form=targetForm(f);
 assert.doesNotMatch(form.innerHTML,/<img|<script>|<b>Unsafe/);assert.match(form.innerHTML,/&lt;img src=x&gt;/);assert.match(form.innerHTML,/&lt;script&gt;/);assert.match(form.innerHTML,/&lt;b&gt;Unsafe &amp; title/);assert.match(form.innerHTML,/Проверено: &lt;time&gt; · выключен в реестре/);assert.match(form.innerHTML,/Права проверены на указанное время/);assert.match(form.innerHTML,/Один канал может принадлежать только одному бренду/);
});
test('new target canonicalizes username and captures allowed fields before freezing, suppressing duplicate submit',async()=>{
 const f=await fixture();await targetList(f);const form=targetForm(f),saving=submit(form);await submit(form);const write=f.requests[2].body;
 assert.equal(f.requests.length,3);assert.equal(write.action,'target');assert.equal(write.brand_id,'brand');assert.equal(write.username,'pcs_channel');assert.ok(write.request_id);assert.equal(Object.hasOwn(write,'target_select'),false);assert.equal(Object.hasOwn(write,'id'),false);assert.equal(Object.hasOwn(write,'expected_version'),false);assert.equal(form.elements.username.disabled,true);
 f.requests[2].reject(Error('Network unavailable'));await saving;assert.equal(form.elements.username.disabled,undefined);assert.equal(form.querySelector('[type=submit]').disabled,false);assert.match(form.querySelector('[data-error]').textContent,/Network unavailable/);
});
test('existing target selector fills persisted brand and username and rechecks its exact version',async()=>{
 const f=await fixture();await targetList(f,{targets:[savedTarget()]});const form=targetForm(f);form.elements.target_select.value='target';form.elements.target_select.onchange();assert.equal(form.elements.brand_id.value,'brand');assert.equal(form.elements.username.value,'pcs_channel');const saving=submit(form);
 assert.equal(f.requests[2].body.id,'target');assert.equal(f.requests[2].body.expected_version,3);f.requests[2].resolve({ok:true,target:savedTarget({version:4})});await saving;assert.equal(f.requests.length,4);assert.equal(f.requests[3].op,'content-workflow');assert.equal(f.requests[3].params.id,undefined);
});
test('uncertain target retry reuses request ID for unchanged payload and changes it for changed payload',async()=>{
 const f=await fixture();await targetList(f);const form=targetForm(f);let saving=submit(form);f.requests[2].reject(Error('Unknown save result'));await saving;const first=f.requests[2].body.request_id;
 saving=submit(form);assert.equal(f.requests[3].body.request_id,first);f.requests[3].resolve({ok:true});await saving;assert.match(form.querySelector('[data-error]').textContent,/Не получено подтверждение/);
 form.elements.username.value='other_channel';saving=submit(form);assert.notEqual(f.requests[4].body.request_id,first);f.requests[4].reject(Error('Network'));await saving;
});
test('target cancellation, closure and reopening suppress stale success and failure responses',async()=>{
 for(const ending of ['cancel','close','reopen','failure']){
  const f=await fixture();await targetList(f);const form=targetForm(f),saving=submit(form);let replacement;
  if(ending==='close')f.invalidate();else{form.querySelector('[data-cancel]').onclick();replacement=targetForm(f);replacement.elements.username.value='replacement_channel';}
  if(ending==='failure')f.requests[2].reject(Error('Old failure'));else f.requests[2].resolve({ok:true,target:savedTarget()});await saving;
  assert.equal(f.requests.length,3);if(replacement){assert.equal(f.root.children[0],replacement);assert.equal(replacement.elements.username.value,'replacement_channel');assert.equal(replacement.querySelector('[data-error]').textContent,undefined);}
 }
});
test('target entry rejects URL and missing brand before any request and cannot accumulate duplicate forms',async()=>{
 const f=await fixture();await targetList(f);const form=targetForm(f);f.root.querySelector('[data-targets]').onclick();assert.equal(f.root.children.length,1);assert.equal(f.root.querySelector('[data-targets]').disabled,true);
 form.elements.username.value='https://t.me/pcs_channel';await submit(form);assert.equal(f.requests.length,2);assert.match(form.querySelector('[data-error]').textContent,/без ссылки/);form.elements.username.value='pcs_channel';form.elements.brand_id.value='';await submit(form);assert.equal(f.requests.length,2);
});
