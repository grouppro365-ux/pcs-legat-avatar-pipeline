import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
function harness(){
 const id='11111111-1111-4111-8111-111111111111',item={id,title:'Card',edit_version:'2026-10-07 13:00:00.123456+00',publication_status:'PUBLISHED'},nodes={},sheets=[],calls=[],notices=[];let closed=0,resolve,reject;
 const window={pricingManager:async()=>{}};const context={window,PCS:{catalog:[item]},document:{querySelector:q=>nodes[q]},esc:v=>String(v??''),openSheet:(title,html)=>{sheets.push(html);nodes['#catalogArchiveSave']={disabled:false};nodes['#catalogArchiveError']={textContent:''};},closeSheet:()=>closed++,toast:v=>notices.push(v),catalog:async()=>{},adminCall:body=>{calls.push(body);return new Promise((a,b)=>{resolve=a;reject=b;});}};
 vm.runInNewContext(readFileSync(new URL('../catalog-safety.js',import.meta.url),'utf8'),context);
 return {window,context,id,item,nodes,sheets,calls,notices,get closed(){return closed},resolve:()=>resolve({ok:true}),reject:()=>reject(Error('Карточка уже изменена'))};
}
test('archive captures original version and blocks double clicks; conflict keeps dialog',async()=>{
 const h=harness();h.window.confirmDeleteCatalog(h.id);h.item.edit_version='new-version';const p=h.window.deleteCatalog(h.id);await h.window.deleteCatalog(h.id);
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].expected_version,'2026-10-07 13:00:00.123456+00');assert.equal(h.nodes['#catalogArchiveSave'].disabled,true);
 h.reject();await p;assert.equal(h.closed,0);assert.equal(h.item.publication_status,'PUBLISHED');assert.match(h.nodes['#catalogArchiveError'].textContent,/изменена/);assert.equal(h.nodes['#catalogArchiveSave'].disabled,false);
});
test('archive success cannot close a replacement sheet or turn refresh failure into another archive',async()=>{
 const h=harness();h.window.confirmDeleteCatalog(h.id);h.context.catalog=async()=>{throw Error('refresh')};const p=h.window.deleteCatalog(h.id);h.nodes['#catalogArchiveSave']={disabled:false};h.resolve();await p;
 assert.equal(h.closed,0);assert.equal(h.item.publication_status,'ARCHIVED');assert.equal(h.item.availability_status,'UNAVAILABLE');assert.match(h.notices.at(-1),/подтверждено/);await h.window.deleteCatalog(h.id);assert.equal(h.calls.length,1);
});
