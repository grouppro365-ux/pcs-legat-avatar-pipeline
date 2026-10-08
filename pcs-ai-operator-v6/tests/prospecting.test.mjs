import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../prospecting.js',import.meta.url),'utf8');
function fixture(){
 const calls=[],nodes={};for(const k of ['list','summary','view','decision','refresh','scan','classify','result','add','toggle','competitors','direction','freshness'])nodes[k]={innerHTML:'',textContent:'',value:k==='view'?'requests':'qualified',disabled:false,querySelector(){return{}},elements:{username:{value:'@channel_test'},topic:{value:'community'}},reset(){}};
 nodes.list.querySelector=k=>nodes[k.includes('prev')?'prev':'next']||(nodes[k.includes('prev')?'prev':'next']={});
 nodes.direction.value='all';nodes.freshness.value='recent';for(const k of ['decision','direction','freshness'])nodes[k+'-field']={hidden:false};
 const root={querySelector:k=>nodes[k.match(/data-prospect-([a-z-]+)/)?.[1]]},main={innerHTML:''};
 const window={PCS:{page:'prospecting'},opsCall:(url,init)=>new Promise((resolve,reject)=>calls.push({url,init,resolve:d=>{const u=new URL(url,'https://pcs.test');resolve({page:Number(u.searchParams.get('page')||0),decision:u.searchParams.get('decision')||'qualified',source_kind:u.searchParams.get('source_kind')||'all',direction:u.searchParams.get('direction')||'all',freshness:u.searchParams.get('freshness')||'recent',...d})},reject})),toast(){}};
 const sheet={};window.openSheet=(title,html)=>{sheet.html=html;for(const id of ['pcsProspectSourceForm','pcsSourceEnabled','pcsSourceCompetitor','pcsSourceRules','pcsSourceError','pcsSourceSave'])sheet[id]={checked:false,value:'',textContent:'',disabled:false};};window.closeSheet=()=>{sheet.closed=true;delete sheet.pcsProspectSourceForm;};
 const document={querySelector:k=>k==='#main'?main:k==='#pcsProspecting'?root:sheet[k.slice(1)]};vm.runInNewContext(source,{window,document,URL,URLSearchParams,Date,Object});return{window,nodes,calls,main,sheet};
}
test('prospecting shows real counters, escaped source text and blocked contact rather than a send button',async()=>{
 const h=fixture(),p=h.window.pcsProspecting();h.calls[0].resolve({view:'requests',enabled:true,version:1,summary:{sources:35,sources_read:1,qualified:1,review:2,rejected:10},rows:[{message_text:'<script>alert(1)</script>',direction:'CAR_RENTAL',decision:'qualified',message_url:'https://evil.invalid',reason:'Need car'}]});await p;
 assert.match(h.nodes.summary.textContent,/прочитаны: 1/);assert.match(h.nodes.list.innerHTML,/&lt;script&gt;/);assert.doesNotMatch(h.nodes.list.innerHTML,/<script>|href="https:\/\/evil|Отправить/);assert.match(h.nodes.list.innerHTML,/Отправка заблокирована/);assert.match(h.main.innerHTML,/пока не подключена/);
});

test('source settings preserve a conflict draft, lock pending fields and prevent duplicate writes',async()=>{
 const h=fixture(),p=h.window.pcsProspecting();h.calls[0].resolve({view:'requests',enabled:true,version:1,rows:[],summary:{}});await p;
 h.nodes.view.value='sources';h.nodes.view.onchange();h.calls[1].resolve({view:'sources',enabled:true,version:1,rows:[{id:'10000000-0000-4000-8000-000000000001',username:'channel_test',title:'<script>unsafe</script>',enabled:true,topic:'community',rules:'',edit_version:'2026-10-06 15:00:00.123456+00'}],summary:{}});await new Promise(r=>setImmediate(r));
 assert.match(h.nodes.list.innerHTML,/Поиск включён/);h.nodes.list.onclick({target:{closest:()=>({dataset:{prospectSourceEdit:'0'}})}});assert.match(h.sheet.html,/&lt;script&gt;/);assert.doesNotMatch(h.sheet.html,/<script>/);
 h.sheet.pcsSourceEnabled.checked=false;h.sheet.pcsSourceCompetitor.checked=true;h.sheet.pcsSourceRules.value='draft rules';h.sheet.pcsProspectSourceForm.onsubmit({preventDefault(){}});h.sheet.pcsProspectSourceForm.onsubmit({preventDefault(){}});
 assert.equal(h.calls.length,3);assert.equal(h.calls[2].url,'/prospecting/source-update');assert.equal(h.sheet.pcsSourceRules.disabled,true);assert.equal(JSON.parse(h.calls[2].init.body).expected_version,'2026-10-06 15:00:00.123456+00');
 h.calls[2].reject(Error('Источник уже изменился'));await new Promise(r=>setImmediate(r));assert.equal(h.sheet.pcsSourceRules.value,'draft rules');assert.equal(h.sheet.pcsSourceRules.disabled,false);assert.match(h.sheet.pcsSourceError.textContent,/уже изменился/);assert.equal(h.sheet.closed,undefined);
});
test('late prospect responses cannot repaint another page and source/AI failures remain visible',async()=>{
 const h=fixture(),p=h.window.pcsProspecting();h.window.PCS.page='crm';h.calls[0].resolve({view:'requests',rows:[{message_text:'stale'}]});await p;assert.doesNotMatch(h.nodes.list.innerHTML,/stale/);
 h.window.PCS.page='prospecting';const next=h.window.pcsProspecting();h.calls[1].reject(Error('Source unavailable'));await next;assert.equal(h.nodes.list.textContent,'Source unavailable');
});
test('pause changes only the selected version and rapid taps cannot submit twice',async()=>{
 const h=fixture(),p=h.window.pcsProspecting();h.calls[0].resolve({view:'requests',enabled:true,version:3,rows:[],summary:{}});await p;
 const write=h.nodes.toggle.onclick();h.nodes.toggle.onclick();assert.equal(h.calls.length,2);assert.equal(h.calls[1].url,'/prospecting/settings');assert.deepEqual(JSON.parse(h.calls[1].init.body),{enabled:false,expected_version:3});h.calls[1].resolve({ok:true});await new Promise(resolve=>setImmediate(resolve));h.calls[2].resolve({view:'requests',enabled:false,version:4,rows:[],summary:{}});await write;assert.equal(h.nodes.scan.disabled,true);
});

test('classification prevents duplicate submission and restores both action buttons after reload',async()=>{
 const h=fixture(),p=h.window.pcsProspecting();h.calls[0].resolve({view:'requests',enabled:true,version:1,rows:[],summary:{}});await p;
 const action=h.nodes.classify.onclick();h.nodes.classify.onclick();assert.equal(h.calls.length,2);assert.equal(h.calls[1].url,'/prospecting/classify-review');
 h.calls[1].resolve({classified:12,qualified:0,review:0,rejected:12});await new Promise(resolve=>setImmediate(resolve));
 h.calls[2].resolve({view:'requests',enabled:true,version:1,rows:[],summary:{rejected:12}});await action;
 assert.equal(h.nodes.scan.disabled,false);assert.equal(h.nodes.classify.disabled,false);assert.match(h.nodes.result.textContent,/Обработано: 12/);
});

test('direction and date filters reset the page and survive competitor and pagination changes',async()=>{
 const h=fixture(),p=h.window.pcsProspecting();assert.match(h.calls[0].url,/freshness=recent/);h.calls[0].resolve({view:'requests',enabled:true,rows:[],summary:{},truncated:true});await p;
 h.nodes.next.onclick();assert.match(h.calls[1].url,/page=1/);h.calls[1].resolve({view:'requests',rows:[],summary:{}});await new Promise(r=>setImmediate(r));
 h.nodes.direction.value='PROPERTY_PURCHASE';h.nodes.freshness.value='all';h.nodes.direction.onchange();assert.match(h.calls[2].url,/page=0/);assert.match(h.calls[2].url,/direction=PROPERTY_PURCHASE/);assert.match(h.calls[2].url,/freshness=all/);
 h.nodes.competitors.onchange({target:{checked:true}});assert.match(h.calls[3].url,/source_kind=competitor/);assert.match(h.calls[3].url,/direction=PROPERTY_PURCHASE/);
 h.calls[3].resolve({view:'requests',rows:[{message_text:'new',decision:'review'}],summary:{}});h.calls[2].resolve({view:'requests',rows:[{message_text:'stale'}],summary:{}});await new Promise(r=>setImmediate(r));assert.match(h.nodes.list.innerHTML,/new/);assert.doesNotMatch(h.nodes.list.innerHTML,/stale/);
});
test('a response for the wrong request filters remains an error',async()=>{const h=fixture(),p=h.window.pcsProspecting();h.calls[0].resolve({view:'requests',direction:'CAR_RENTAL',rows:[{message_text:'wrong'}]});await p;assert.match(h.nodes.list.textContent,/Некорректный ответ/);assert.doesNotMatch(h.nodes.list.innerHTML,/wrong/)});
