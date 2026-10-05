import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const id='11111111-1111-4111-8111-111111111111';
function fixture(){
 const nodes={},calls=[];const window={openSheet:(title,html)=>{for(const x of html.matchAll(/id="([^"]+)"/g))nodes[x[1]]={value:'',textContent:'',innerHTML:'',disabled:false};},call:url=>new Promise((resolve,reject)=>calls.push({url,resolve,reject}))};
 vm.runInNewContext(readFileSync(new URL('../inventory-check.js',import.meta.url),'utf8'),{window,document:{getElementById:id=>nodes[id]},URLSearchParams,Date});
 const open=()=>{window.pcsInventory.open(id);nodes.pcsInventoryStart.value='2026-10-10';nodes.pcsInventoryEnd.value='2026-10-20';};
 return {window,nodes,calls,open};
}
const payload=()=>({item:{id,title:'<img>'},start:'2026-10-10',end:'2026-10-20',status:'confirmation_required',reason:'<script>Confirm</script>',checked_at:'2026-10-05T00:00:00Z'});
test('inventory uses a read-only check, escapes content and prevents duplicate clicks',async()=>{
 const h=fixture();h.open();const p=h.nodes.pcsInventoryCheck.onclick();await h.nodes.pcsInventoryCheck.onclick();assert.equal(h.calls.length,1);assert.match(h.calls[0].url,/^\/inventory-check\?/);assert.equal(h.nodes.pcsInventoryCheck.disabled,true);h.calls[0].resolve(payload());await p;assert.match(h.nodes.pcsInventoryResult.innerHTML,/Нужно подтвердить наличие/);assert.doesNotMatch(h.nodes.pcsInventoryResult.innerHTML,/<img>|<script>/);assert.equal(h.nodes.pcsInventoryCheck.disabled,false);
});
test('changed dates invalidate pending results and reopened forms ignore old errors',async()=>{
 const h=fixture();h.open();const p=h.nodes.pcsInventoryCheck.onclick();h.nodes.pcsInventoryEnd.value='2026-10-25';h.nodes.pcsInventoryEnd.onchange();h.calls[0].resolve(payload());await p;assert.equal(h.nodes.pcsInventoryResult.innerHTML,'');assert.match(h.nodes.pcsInventoryResult.textContent,/Даты изменились/);
 const q=h.nodes.pcsInventoryCheck.onclick();h.open();h.calls[1].reject(Error('old failure'));await q;assert.equal(h.nodes.pcsInventoryResult.textContent,'');
});
test('invalid date order never calls server and network failures stay visible with retry enabled',async()=>{
 const h=fixture();h.open();h.nodes.pcsInventoryEnd.value='2026-10-01';await h.nodes.pcsInventoryCheck.onclick();assert.equal(h.calls.length,0);h.nodes.pcsInventoryEnd.value='2026-10-20';const p=h.nodes.pcsInventoryCheck.onclick();h.calls[0].reject(Error('Source unavailable'));await p;assert.equal(h.nodes.pcsInventoryResult.textContent,'Source unavailable');assert.equal(h.nodes.pcsInventoryCheck.disabled,false);
});
