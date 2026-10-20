import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=f=>readFileSync(new URL('../pcs-ai-operator-v6/'+f,import.meta.url),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
const task={id:'task1',contact_id:'client1',title:'Call',comment:'',priority:'NORMAL',due_at:null,assignee:'',edit_version:'v1'};
function fixture(file){
 const nodes=new Map(),calls=[],sheets=[];
 const node=id=>({id,value:'',innerHTML:'',textContent:'',disabled:false,dataset:{},listeners:{},classList:{contains:()=>false},addEventListener(k,v){this.listeners[k]=v},querySelectorAll(){return []}});
 nodes.set('main',node('main'));nodes.set('sheetbox',node('sheetbox'));
 const document={getElementById:id=>nodes.get(id)||null,addEventListener(){}};
 const c=vm.createContext({document,console,Date,URLSearchParams,Intl});c.window=c;c.PCS={page:'crm'};c.esc=String;c.toast=()=>{};
 c.call=(path,opt)=>new Promise((resolve,reject)=>calls.push({path,opt,resolve,reject}));c.opsCall=c.call;
 vm.runInContext(source('sheet-lifecycle.js'),c);
 c.openSheet=(title,html)=>{c.pcsSheetLifecycle.invalidate();sheets.push(title);for(const [id] of nodes)if(id!=='main'&&id!=='sheetbox')nodes.delete(id);nodes.get('sheetbox').innerHTML=html;for(const [,id] of html.matchAll(/id="([^"]+)"/g))nodes.set(id,node(id));};
 // Production closeSheet hides the sheet and retains all its nodes.
 c.closeSheet=()=>c.pcsSheetLifecycle.invalidate();
 c.fmtDateTime=String;c.pcsTaskQueue={open:async()=>sheets.push('queue reopened')};c.openClient=()=>sheets.push('client opened');
 vm.runInContext(source(file),c);return{c,nodes,calls,sheets};
}
test('cancelled search leaves retained results untouched',async()=>{
 const h=fixture('global-search.js');h.c.pcsSearch.open('call');const box=h.nodes.get('pcsSearchResults');h.c.closeSheet();h.calls[0].resolve({groups:[{scope:'contacts',rows:[{title:'stale'}]}]});await tick();assert.equal(box.innerHTML,'');assert.equal(box.textContent,'Ищу…');
});
test('cancelled notifications discard late list and application responses',async()=>{
 const h=fixture('notifications.js');const list=h.c.pcsNotifications.open(),box=h.nodes.get('pcsNotificationList');h.c.closeSheet();h.calls[0].resolve({view:'unread',rows:[{title:'stale'}]});await list;assert.equal(box.innerHTML,'');
 const id='11111111-1111-4111-8111-111111111111',p=h.c.pcsOpenOperationalApplication(id),detail=h.nodes.get('pcsOperationalApplication');h.c.closeSheet();h.calls[1].resolve({application:{id,public_id:'stale'}});await p;assert.equal(detail.innerHTML,'');
});
test('cancelled task queue neither renders late rows nor accepts retained row actions',async()=>{
 const h=fixture('crm-task-queue.js'),p=h.c.pcsTaskQueue.open(),box=h.nodes.get('crmTaskQueueList');h.c.closeSheet();h.calls[0].resolve({tasks:[task]});await p;assert.equal(box.innerHTML,'');
 const q=h.c.pcsTaskQueue.open();h.calls[1].resolve({tasks:[task]});await q;h.c.closeSheet();await h.c.pcsTaskQueue.complete(0);await h.c.pcsTaskQueue.client(0);assert.equal(h.calls.length,2);assert.equal(h.sheets.length,2);
});
test('cancel while task detail loads prevents editor reopening even with unchanged page and markup',async()=>{
 const h=fixture('crm-task-edit.js'),p=h.c.pcsTaskEdit.open('client1','task1');h.c.closeSheet();h.calls[0].resolve({task});await p;assert.deepEqual(h.sheets,[]);
});
test('task save after cancel cannot reopen queue or accept a hidden-form retry',async()=>{
 const h=fixture('crm-task-edit.js'),p=h.c.pcsTaskEdit.open('client1','task1');h.calls[0].resolve({task});await p;
 for(const [id,v] of Object.entries({pcsTaskTitle:'Call updated',pcsTaskComment:'',pcsTaskPriority:'NORMAL',pcsTaskDue:'',pcsTaskAssignee:''}))h.nodes.get(id).value=v;
 const save=h.c.pcsTaskEdit.submit();h.c.closeSheet();h.calls[1].resolve({ok:true,task});await save;assert.deepEqual(h.sheets,['Изменить задачу']);await h.c.pcsTaskEdit.submit();assert.equal(h.calls.length,2);
});
test('notification acknowledgement finishing after cancel does not reload retained sheet',async()=>{
 const h=fixture('notifications.js'),id='11111111-1111-4111-8111-111111111111',p=h.c.pcsNotifications.open();h.calls[0].resolve({view:'unread',rows:[{id,title:'event',read_version:'a'.repeat(32)}]});await p;
 const button={disabled:false,dataset:{notificationRead:'0'}};h.nodes.get('pcsNotificationList').onclick({target:{closest:s=>s==='[data-notification-read]'?button:null}});h.c.closeSheet();h.calls[1].resolve({ok:true,id,read_at:'2026-10-20T10:00:00Z'});await tick();assert.equal(h.calls.length,2);
});
