import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const source=f=>readFileSync(new URL('../pcs-ai-operator-v6/'+f,import.meta.url),'utf8');
const contact={id:'contact1',edit_version:'7',name:'Original',status:'NEW',priority:'NORMAL'};
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(){
 const dom=new JSDOM('<main id="main"></main><div id="sheet"></div>',{url:'https://pcs.test',runScripts:'outside-only'}),w=dom.window,calls=[],notices=[],clients=[];
 w.scrollTo=()=>{};w.PCS={page:'crm',crmId:contact.id};w.toast=s=>notices.push(s);w.eval(source('sheet-lifecycle.js'));w.eval(source('navigation-lifecycle.js'));
 w.openSheet=(title,html)=>{w.pcsSheetLifecycle.invalidate();w.document.getElementById('sheet').innerHTML=html;};w.closeSheet=()=>w.pcsSheetLifecycle.invalidate();
 w.call=(path,opt)=>new Promise((resolve,reject)=>calls.push({path,opt,resolve,reject}));w.openClient=async id=>clients.push(id);w.eval(source('crm-editor.js'));
 return{w,calls,notices,clients,close:()=>w.close()};
}
async function edit(h){const p=h.w.pcsCrmEditor.edit(contact.id);h.calls.at(-1).resolve({contact});await p;h.w.document.getElementById('crmEdit_name').value='Edited';}
function task(h){h.w.pcsCrmEditor.taskForm(contact.id);h.w.document.getElementById('crmTaskTitle').value='Call';}
function inline(w,node){node.onsubmit=w.Function('event',node.getAttribute('onsubmit'));return node;}
for(const kind of ['editor','task']){
 const formId=kind==='editor'?'crmEditorForm':'crmTaskForm',invoke=h=>kind==='editor'?h.w.pcsCrmEditor.save():h.w.pcsCrmEditor.createTask(),open=async h=>kind==='editor'?edit(h):task(h);
 test(`${kind}: close with retained DOM rejects hidden writes and late refresh`,async()=>{
  const h=fixture();await open(h);const pending=invoke(h),write=h.calls.at(-1);assert.ok(write.opt);h.w.closeSheet();write.resolve({contact:{...contact,edit_version:'8'}});await pending;const count=h.calls.length;await invoke(h);assert.equal(h.calls.length,count);assert.equal(h.clients.length,0);assert.equal(h.notices.length,0);h.close();
 });
 test(`${kind}: retained inline submit cannot save a reopened form`,async()=>{
  const h=fixture();await open(h);const old=inline(h.w,h.w.document.getElementById(formId));h.w.closeSheet();await open(h);const count=h.calls.length;old.dispatchEvent(new h.w.Event('submit',{cancelable:true}));await tick();assert.equal(h.calls.length,count);const active=inline(h.w,h.w.document.getElementById(formId));active.dispatchEvent(new h.w.Event('submit',{cancelable:true}));assert.equal(h.calls.length,count+1);h.w.closeSheet();h.calls.at(-1).resolve({contact});await tick();h.close();
 });
 test(`${kind}: pending response cannot close or alter a replacement sheet`,async()=>{
  const h=fixture();await open(h);const pending=invoke(h);h.w.openSheet('Other','<textarea id="other">Unsaved</textarea>');h.calls.at(-1).resolve({contact});await pending;assert.equal(h.w.document.getElementById('other').value,'Unsaved');assert.equal(h.clients.length,0);assert.equal(h.notices.length,0);h.close();
 });
}
test('refresh started after save cannot overwrite a newer sheet or cached CRM list',async()=>{
 const h=fixture();await edit(h);const p=h.w.pcsCrmEditor.save();h.calls.at(-1).resolve({contact});await tick();assert.equal(h.calls.at(-1).path,'/crm');h.w.openSheet('New draft','<input id="new" value="Unsaved">');h.calls.at(-1).resolve([{id:'stale'}]);await p;assert.equal(h.w.PCS.crm,undefined);assert.equal(h.clients.length,0);assert.equal(h.w.document.getElementById('new').value,'Unsaved');h.close();
});
test('task completion cannot reopen a client after switching sheets',async()=>{
 const h=fixture();const p=h.w.pcsCrmEditor.complete(contact.id,'task1');h.w.openSheet('Other','<input id="new" value="Unsaved">');h.calls.at(-1).resolve({ok:true});await p;assert.equal(h.calls.length,1);assert.equal(h.clients.length,0);assert.equal(h.notices.length,0);h.close();
});
test('late editor reads cannot replace a closed sheet or a later route',async()=>{
 for(const transition of ['close','route','replace']){const h=fixture();const p=h.w.pcsCrmEditor.edit(contact.id);if(transition==='close')h.w.closeSheet();else if(transition==='route')h.w.pcsNavigation.run('catalog',()=>{});else h.w.openSheet('Other','<input id="other" value="Unsaved">');h.calls[0].resolve({contact});assert.equal(await p,false);assert.equal(h.w.document.getElementById('crmEditorForm'),null);if(transition==='replace')assert.equal(h.w.document.getElementById('other').value,'Unsaved');h.close();}
});
test('late editor conflicts cannot write an error into a replacement draft',async()=>{
 const h=fixture();await edit(h);const p=h.w.pcsCrmEditor.save(),write=h.calls.at(-1);h.w.closeSheet();await edit(h);write.reject(Error('Old conflict'));await p;assert.equal(h.w.document.getElementById('crmEditorError').textContent,'');assert.equal(h.w.document.getElementById('crmEditorSave').disabled,false);h.close();
});
for(const kind of ['editor','task'])test(`${kind}: pending write freezes draft fields and failure restores editing`,async()=>{
 const h=fixture();if(kind==='editor')await edit(h);else task(h);const f=h.w.document.getElementById(kind==='editor'?'crmEditorForm':'crmTaskForm'),field=h.w.document.getElementById(kind==='editor'?'crmEdit_name':'crmTaskTitle');const before=field.value;const p=kind==='editor'?h.w.pcsCrmEditor.save():h.w.pcsCrmEditor.createTask();assert.equal(field.disabled,true);assert.ok([...f.elements].every(x=>x.disabled));h.calls.at(-1).reject(Error('Conflict'));await p;assert.equal(field.disabled,false);assert.equal(field.value,before);assert.ok([...f.elements].every(x=>!x.disabled));h.close();
});
