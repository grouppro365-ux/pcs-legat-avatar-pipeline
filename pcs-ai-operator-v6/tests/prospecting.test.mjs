import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../prospecting.js',import.meta.url),'utf8');
function fixture(){
 const calls=[],nodes={};for(const k of ['list','summary','view','decision','refresh','scan','classify','result','add','toggle','competitors'])nodes[k]={innerHTML:'',textContent:'',value:k==='view'?'requests':'qualified',disabled:false,querySelector(){return{}},elements:{username:{value:'@channel_test'},topic:{value:'community'}},reset(){}};
 nodes.list.querySelector=k=>nodes[k.includes('prev')?'prev':'next']||(nodes[k.includes('prev')?'prev':'next']={});
 const root={querySelector:k=>nodes[k.match(/data-prospect-([a-z]+)/)?.[1]]},main={innerHTML:''};
 const window={PCS:{page:'prospecting'},opsCall:(url,init)=>new Promise((resolve,reject)=>calls.push({url,init,resolve,reject})),toast(){}};
 const document={querySelector:k=>k==='#main'?main:k==='#pcsProspecting'?root:null};vm.runInNewContext(source,{window,document,URLSearchParams,Date,Object});return{window,nodes,calls,main};
}
test('prospecting shows real counters, escaped source text and blocked contact rather than a send button',async()=>{
 const h=fixture(),p=h.window.pcsProspecting();h.calls[0].resolve({view:'requests',enabled:true,version:1,summary:{sources:35,sources_read:1,qualified:1,review:2,rejected:10},rows:[{message_text:'<script>alert(1)</script>',direction:'CAR_RENTAL',decision:'qualified',message_url:'https://evil.invalid',reason:'Need car'}]});await p;
 assert.match(h.nodes.summary.textContent,/прочитаны: 1/);assert.match(h.nodes.list.innerHTML,/&lt;script&gt;/);assert.doesNotMatch(h.nodes.list.innerHTML,/<script>|href="https:\/\/evil|Отправить/);assert.match(h.nodes.list.innerHTML,/Отправка заблокирована/);assert.match(h.main.innerHTML,/пока не подключена/);
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
