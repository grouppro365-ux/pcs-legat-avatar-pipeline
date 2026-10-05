import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function fixture(){const nodes={},calls=[],window={openSheet:(title,html)=>{for(const x of html.matchAll(/id="([^"]+)"/g))nodes[x[1]]={textContent:'',innerHTML:'',disabled:false}},call:url=>new Promise((resolve,reject)=>calls.push({url,resolve,reject}))};vm.runInNewContext(readFileSync(new URL('../audit-log.js',import.meta.url),'utf8'),{window,document:{getElementById:id=>nodes[id]},URLSearchParams,Date});return{nodes,calls,window};}
const tick=()=>new Promise(r=>setImmediate(r));
test('audit escapes records, paginates, and never mutates data',async()=>{const h=fixture(),p=h.window.pcsAudit.open();assert.equal(h.calls[0].url,'/audit?source=crm&page=0');h.calls[0].resolve({source:'crm',page:0,rows:[{action:'<script>',actor:'<img>',entity_id:'<id>',changed_fields:['<field>']}],truncated:true});await p;assert.doesNotMatch(h.nodes.pcsAuditList.innerHTML,/<script>|<img>|<field>/);assert.equal(h.nodes.pcsAuditNext.disabled,false);h.nodes.pcsAuditNext.onclick();assert.equal(h.calls[1].url,'/audit?source=crm&page=1');});
test('audit source switch and reopened sheets ignore previous responses; failures stay visible',async()=>{const h=fixture();h.window.pcsAudit.open();h.nodes.pcsAuditSource.onchange({target:{value:'business'}});h.calls[1].resolve({source:'business',page:0,rows:[{action:'business row'}]});await tick();h.calls[0].resolve({source:'crm',page:0,rows:[{action:'old'}]});await tick();assert.match(h.nodes.pcsAuditList.innerHTML,/business row/);const p=h.window.pcsAudit.open();h.calls[2].reject(Error('Unavailable'));await p;assert.equal(h.nodes.pcsAuditList.textContent,'Unavailable');});
test('journal is reachable from the current v26 More menu without removing existing actions',()=>{
 const children=[],grid={appendChild:b=>children.push(b)},window={moreMenu:()=>children.push({textContent:'Existing action'})},document={querySelector:s=>s.includes('.v26-more')?grid:null,createElement:()=>({})};
 vm.runInNewContext(readFileSync(new URL('../audit-log.js',import.meta.url),'utf8'),{window,document,URLSearchParams,Date});window.moreMenu();assert.deepEqual(children.map(x=>x.textContent),['Existing action','Журнал действий']);assert.equal(typeof children[1].onclick,'function');
});
test('long field lists stay compact, use readable labels, and escape expanded values',async()=>{
 const h=fixture(),p=h.window.pcsAudit.open();h.calls[0].resolve({source:'crm',page:0,rows:[{action:'applications.insert',changed_fields:['id','city','item_id','category','public_id','reserved_vehicle_id','<img>']}]});await p;
 const html=h.nodes.pcsAuditList.innerHTML;assert.match(html,/Все изменённые поля \(7\)/);assert.match(html,/<details><summary/);assert.match(html,/Зарезервированный автомобиль/);assert.doesNotMatch(html,/<img>|reserved_vehicle_id/);assert.ok(html.indexOf('Зарезервированный автомобиль')>html.indexOf('<details>'));
});
