import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../ops.js',import.meta.url),'utf8');
test('editing checked booking terms invalidates the preview and associates controls with labels',async()=>{
 const nodes={},window={};let html='';const document={querySelector:s=>nodes[s.slice(1)],getElementById:id=>nodes[id]};
 const openSheet=(title,body)=>{html=body;for(const x of body.matchAll(/id="([^"]+)"/g)){const events={};nodes[x[1]]={dataset:{},value:'',events,addEventListener:(type,fn)=>(events[type]??=[]).push(fn)}}};
 vm.runInNewContext(source.slice(source.indexOf('async function newReservation()'),source.indexOf('window.previewQuote=')),{window,document,ensureCatalog:async()=>[],call:async()=>[],openSheet,refreshReservationPricing:()=>{},esc:x=>x,toast:()=>{}});
 await window.newReservation();for(const id of ['brItem','brClient','brStart','brEnd','brTotal','brDeposit','brCurrency','brNotes','brPhoto']){
  assert.match(html,new RegExp('label for="'+id+'"'));nodes.brCreate.disabled=false;nodes.brQuote.textContent='Checked';for(const fn of nodes[id].events.change)fn({target:nodes[id]});assert.equal(nodes.brCreate.disabled,true);assert.match(nodes.brQuote.textContent,/Условия изменились/);
 }
});
