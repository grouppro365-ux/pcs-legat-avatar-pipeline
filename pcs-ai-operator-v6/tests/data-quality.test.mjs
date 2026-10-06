import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function fixture(){const nodes={},calls=[],opened=[],buttons=[];const window={openSheet:(title,html)=>{for(const x of html.matchAll(/id="([^"]+)"/g))nodes[x[1]]={innerHTML:'',textContent:'',disabled:false,querySelectorAll:()=>buttons}},closeSheet:()=>opened.push('closed'),openClient:(...args)=>opened.push(args),call:url=>new Promise((resolve,reject)=>calls.push({url,resolve,reject}))};vm.runInNewContext(readFileSync(new URL('../data-quality.js',import.meta.url),'utf8'),{window,document:{getElementById:id=>nodes[id]},URLSearchParams,Date});return {nodes,calls,window,buttons,opened};}
const tick=()=>new Promise(r=>setImmediate(r));
test('quality cards escape contact data and navigate to CRM with original id',async()=>{
 const h=fixture();h.buttons.push({dataset:{qualityContact:'0'}});const p=h.window.pcsDataQuality.open();h.calls[0].resolve({view:'telegram',page:0,rows:[{id:'contact_1',name:'<img>',next_action:'<script>',match_key:'123',duplicate_count:2}],truncated:true});await p;
 assert.match(h.nodes.pcsQualityRows.innerHTML,/&lt;img&gt;/);assert.match(h.nodes.pcsQualityRows.innerHTML,/&lt;script&gt;/);assert.doesNotMatch(h.nodes.pcsQualityRows.innerHTML,/<img>|<script>/);assert.equal(h.nodes.pcsQualityNext.disabled,false);
 h.buttons[0].onclick();assert.deepEqual(h.opened,['closed',['contact_1']]);
});
test('changing filter resets pagination and ignores an old response',async()=>{
 const h=fixture();h.window.pcsDataQuality.open();h.nodes.pcsQualityView.onchange({target:{value:'overdue'}});assert.match(h.calls[1].url,/view=overdue&page=0/);h.calls[1].resolve({view:'overdue',page:0,rows:[{id:'new',name:'Current'}]});await tick();h.calls[0].resolve({view:'telegram',page:0,rows:[{id:'old',name:'Old'}]});await tick();assert.match(h.nodes.pcsQualityRows.innerHTML,/Current/);assert.doesNotMatch(h.nodes.pcsQualityRows.innerHTML,/Old/);
});
test('invalid identities, mismatched responses and network errors stay visible',async()=>{
 for(const d of [{view:'phone',page:0,rows:[]},{view:'telegram',page:1,rows:[]},{view:'telegram',page:0,rows:[{id:"x');alert(1)"}]}]){const h=fixture(),p=h.window.pcsDataQuality.open();h.calls[0].resolve(d);await p;assert.equal(h.nodes.pcsQualityRows.textContent,'Некорректный ответ проверки CRM');}
 const h=fixture(),p=h.window.pcsDataQuality.open();h.calls[0].reject(Error('Нет связи'));await p;assert.equal(h.nodes.pcsQualityRows.textContent,'Нет связи');
});
test('reopening discards an older request and pagination keeps the selected filter',async()=>{
 const h=fixture();h.window.pcsDataQuality.open();const p=h.window.pcsDataQuality.open();h.calls[1].resolve({view:'telegram',page:0,rows:[],truncated:true});await p;h.nodes.pcsQualityNext.onclick();assert.match(h.calls[2].url,/page=1/);h.calls[2].resolve({view:'telegram',page:1,rows:[]});await tick();h.calls[0].resolve({view:'telegram',page:0,rows:[{id:'old',name:'Old'}]});await tick();assert.doesNotMatch(h.nodes.pcsQualityRows.innerHTML,/Old/);assert.equal(h.nodes.pcsQualityPrev.disabled,false);assert.equal(h.nodes.pcsQualityNext.disabled,true);
});
