import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const source=readFileSync(new URL('../pcs-ai-operator-v6/content-workflow.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const post=(extra={})=>({id:'post',brand_id:'brand',brand_name:'PCS',version:4,status:'PUBLICATION_REPORTED',approved_revision:1,current_brand_version:2,revision:{revision:1,brand_version:2,title:'Title',body:'Body',platform:'telegram',language:'ru',qa:{flags:[]}},...extra});
const evidence=(extra={})=>({method:'public_telegram_views_v1',outcome:'OBSERVED',publication_url:'https://t.me/channel/42',fetch_url:'https://t.me/s/channel/42',checked_at:'2026-10-30T12:00:00Z',revision:1,brand_version:2,views:{display:'1,234',exact:'1234',estimate:null,approximate:false},...extra});
function fixture(t,options={}){
 const {p=post(),permissions=['*']}=options,capabilities=Object.hasOwn(options,'capabilities')?options.capabilities:{performance:{version:1}};
 const dom=new JSDOM('<main id="sheet"></main>',{url:'https://pcs.example.test',runScripts:'outside-only'}),w=dom.window;
 t.after(()=>dom.window.close());let epoch=0;const requests=[],queue=[];
 const response={...options.response,permissions,capabilities,posts:[p],brands:[],history:[],platforms:['telegram'],languages:['ru']};
 w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.openSheet=(_title,html)=>{epoch++;w.document.getElementById('sheet').innerHTML=html;};
 w.pcsSheetLifecycle={capture:()=>epoch,current:ticket=>ticket===epoch};
 w.pcsManagerRequest=(op,options)=>{requests.push({op,...JSON.parse(JSON.stringify(options))});return queue.length?queue.shift()():Promise.resolve(response);};
 w.eval(source);
 return {w,requests,queue,open:()=>w.pcsContent.open({id:p.id}),q:s=>w.document.querySelector(s),close:()=>{epoch++;},html:()=>w.document.getElementById('sheet').innerHTML};
}
test('performance capability is strict, permission and current approved Telegram revision gate action',async t=>{
 const variants=[{capabilities:undefined},{capabilities:null},{capabilities:{}},{capabilities:{performance:null}},{capabilities:{performance:{version:'1'}}},{capabilities:{performance:{version:2}}},{permissions:['content.view']},{permissions:['content.edit']},{p:post({status:'READY'})},{p:post({approved_revision:2})},{p:post({revision:{...post().revision,platform:'instagram'}})}];
 for(const variant of variants){const h=fixture(t,variant);await h.open();assert.equal(h.q('[data-observe-performance]'),null,JSON.stringify(variant));assert.equal(h.requests.length,1);}
 for(const status of ['PUBLICATION_REPORTED','PUBLICATION_SENT']){const h=fixture(t,{p:post({status}),permissions:['content.approve']});await h.open();assert.ok(h.q('[data-observe-performance]'));}
});
test('active observe action sends exact identity, suppresses double taps and reuses uncertain retry UUID',async t=>{
 const h=fixture(t);await h.open();const button=h.q('[data-observe-performance]'),pending=deferred();h.queue.push(()=>pending.promise);button.click();button.click();assert.equal(h.requests.length,2);
 const body=h.requests[1].body;assert.deepEqual({...body,request_id:'uuid'},{action:'observe-performance',request_id:'uuid',id:'post',expected_version:4});assert.match(body.request_id,/^[a-f0-9-]{36}$/);assert.equal(button.disabled,true);
 pending.reject(Error('Network'));await tick();assert.equal(button.disabled,false);assert.match(h.q('[data-message]').textContent,/Network/);
 const retry=deferred();h.queue.push(()=>retry.promise);button.click();button.click();assert.equal(h.requests.length,3);assert.equal(h.requests[2].body.request_id,body.request_id);retry.resolve({ok:true});await tick();assert.equal(h.requests.length,4);assert.equal(h.requests[3].op,'content-workflow');assert.equal(h.requests[3].params.id,'post');
});
test('closed or replaced sheets reject stale handlers and late completion cannot reopen them',async t=>{
 for(const reopen of [false,true]){const h=fixture(t);await h.open();const button=h.q('[data-observe-performance]');h.close();if(reopen)await h.open();const count=h.requests.length;button.click();assert.equal(h.requests.length,count);}
 const h=fixture(t);await h.open();const pending=deferred();h.queue.push(()=>pending.promise);h.q('[data-observe-performance]').click();h.close();await h.open();const count=h.requests.length;pending.resolve({ok:true});await tick();assert.equal(h.requests.length,count);
});
test('opening and cancelling an editor invalidates old observation handler even in same session',async t=>{
 const h=fixture(t);await h.open();const button=h.q('[data-observe-performance]');h.q('[data-brand]').click();button.click();assert.equal(h.requests.length,1);h.q('[data-cancel]').click();button.click();assert.equal(h.requests.length,1);assert.notEqual(h.q('[data-observe-performance]'),button);
});
test('cached exact and zero counters remain visible read only with clear scope',async t=>{
 for(const exact of ['1234','0','900719925474099312345']){const h=fixture(t,{p:post({content_performance:evidence({views:{display:exact,exact,estimate:null,approximate:false}})}),permissions:['content.view'],capabilities:{}});await h.open();const section=h.q('[aria-label="Публичные просмотры Telegram"]');assert.ok(section);assert.ok(section.textContent.includes(`Просмотры: ${exact}.`));assert.match(section.textContent,/публичный счётчик Telegram в момент проверки/);assert.match(section.textContent,/не измеряет уникальную аудиторию, выручку, ROI или причинное влияние/);assert.match(section.textContent,/редакция 1 · правила бренда: версия 2/);assert.equal(h.q('[data-observe-performance]'),null);assert.equal(section.querySelector('a,button'),null);}
});
test('abbreviated counts are explicitly approximate and unavailable is never converted to zero',async t=>{
 const h=fixture(t,{p:post({content_performance:evidence({views:{display:'1.2K',exact:null,estimate:'1200',approximate:true}})})});await h.open();const text=h.q('[aria-label="Публичные просмотры Telegram"]').textContent;assert.match(text,/Отображение Telegram: 1.2K/);assert.match(text,/Приблизительное значение: около 1200/);assert.doesNotMatch(text,/Просмотры: 1200/);
 for(const extra of [{outcome:'UNAVAILABLE',views:null,reason:'counter_unreadable'},{views:null},{views:{display:'1.2K',exact:null,estimate:null,approximate:true}}]){const no=fixture(t,{p:post({content_performance:evidence(extra)})});await no.open();const section=no.q('[aria-label="Публичные просмотры Telegram"]');assert.match(section.textContent,/неизвестно/);assert.doesNotMatch(section.textContent,/Просмотры: 0|около 0/);}
});
test('cached evidence is escaped and stale revisions stay visibly labelled',async t=>{
 const attack='<img src=x onerror="window.compromised=true">';const h=fixture(t,{p:post({content_performance:evidence({revision:0,brand_version:1,checked_at:attack,publication_url:attack,fetch_url:attack,reason:attack,views:{display:attack,exact:null,estimate:null,approximate:true}})})});await h.open();const section=h.q('[aria-label="Публичные просмотры Telegram"]');assert.match(section.textContent,/устарело/);assert.match(section.textContent,/не показатель текущей редакции/);assert.ok(section.textContent.includes(attack));assert.equal(h.q('img,script,a'),null);assert.equal(h.w.compromised,undefined);assert.match(h.html(),/&lt;img/);
});

test('bounded observation history preserves escaped timestamps, revision and exact, approximate or unknown counters',async t=>{
 const attack='<img src=x onerror="window.compromised=true">';
 const h=fixture(t,{p:post({content_performance:evidence()}),permissions:['content.view'],response:{performance_history:[evidence({checked_at:attack,revision:0,brand_version:1,publication_url:attack,fetch_url:attack,views:{display:attack,exact:null,estimate:null,approximate:true}}),evidence({checked_at:'2026-10-29T11:00:00Z',views:{display:'0',exact:'0',estimate:null,approximate:false}}),evidence({views:{display:'1.2K',exact:null,estimate:'1200',approximate:true}}),evidence({outcome:'UNAVAILABLE',reason:attack,views:null})],performance_history_truncated:false}});
 await h.open();const history=h.q('[data-performance-history]');assert.ok(history);assert.equal(history.querySelector('summary').textContent,'История наблюдений');assert.match(history.textContent,/до 20 последних/);assert.ok(history.textContent.includes(attack));assert.match(history.textContent,/2026-10-29T11:00:00Z/);assert.match(history.textContent,/редакция 0 · правила бренда: версия 1/);assert.match(history.textContent,/устарело/);assert.match(history.textContent,/Просмотры: 0/);assert.match(history.textContent,/Отображение Telegram: 1.2K/);assert.match(history.textContent,/около 1200/);assert.match(history.textContent,/Просмотры недоступны; значение неизвестно/);assert.equal(history.querySelectorAll('section').length,4);assert.equal(history.querySelector('img,script,a,button'),null);assert.equal(h.w.compromised,undefined);assert.equal(h.q('[data-observe-performance]'),null);assert.equal(h.q('[aria-label="Публичные просмотры Telegram"]').closest('details'),null);
});
test('history is limited to 20 records and explicitly identifies truncation, while legacy absence is harmless',async t=>{
 const records=Array.from({length:21},(_,i)=>evidence({checked_at:`check-${i}`,outcome:'UNAVAILABLE',views:null}));
 for(const rows of [records,records.slice(0,20)]){const h=fixture(t,{response:{performance_history:rows,performance_history_truncated:true}});await h.open();const history=h.q('[data-performance-history]');assert.match(history.textContent,/только 20 последних наблюдений/);assert.equal(history.querySelectorAll('section').length,20);assert.doesNotMatch(history.textContent,/check-20|Просмотры: 0/);assert.match(history.textContent,/значение неизвестно/);}
 const h=fixture(t,{capabilities:undefined});await h.open();assert.equal(h.q('[data-performance-history]'),null);
});
