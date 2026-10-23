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
 const document={getElementById:id=>nodes.get(id)||null,addEventListener(){},body:{classList:{contains:()=>false}}};
 const c=vm.createContext({document,console,Date,URLSearchParams,Intl});c.window=c;c.PCS={page:'crm'};c.scrollTo=()=>{};c.esc=String;c.toast=()=>{};
 c.call=(path,opt)=>new Promise((resolve,reject)=>calls.push({path,opt,resolve,reject}));c.opsCall=c.call;
 vm.runInContext(source('sheet-lifecycle.js'),c);vm.runInContext(source('navigation-lifecycle.js'),c);
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

test('closed offers discard late results and retained controls cannot reopen the application',async()=>{
 const h=fixture('application-offers.js'),id='11111111-1111-4111-8111-111111111111';
 let reopened=0;h.c.pcsApplications={openDetail(){reopened++}};
 const pending=h.c.pcsApplicationOffers.open(id),root=h.nodes.get('pcsOfferRows');
 h.c.closeSheet();h.calls[0].resolve({application:{id},source:'partner',page:0,rows:[{item_title:'stale offer'}]});await pending;
 assert.equal(root.innerHTML,'');h.nodes.get('pcsOfferBack').onclick();h.nodes.get('pcsOfferRefresh').onclick();h.nodes.get('pcsOfferSource').onchange({target:{value:'quotes'}});
 assert.equal(reopened,0);assert.equal(h.calls.length,1);
});
test('closed inventory discards late failures and retained date changes cannot enable retries',async()=>{
 const h=fixture('inventory-check.js');h.c.pcsInventory.open('11111111-1111-4111-8111-111111111111');
 h.nodes.get('pcsInventoryStart').value='2026-11-01';h.nodes.get('pcsInventoryEnd').value='2026-11-05';
 const pending=h.nodes.get('pcsInventoryCheck').onclick(),root=h.nodes.get('pcsInventoryResult');
 const prior=root.textContent;h.c.closeSheet();h.calls[0].reject(Error('stale failure'));await pending;
 assert.equal(root.textContent,prior);h.nodes.get('pcsInventoryEnd').onchange();await h.nodes.get('pcsInventoryCheck').onclick();assert.equal(root.textContent,prior);assert.equal(h.calls.length,1);
});
const deliveryRow={id:'11111111-1111-4111-8111-111111111111',contact_id:'client1',operation:'crm_manual',edit_version:'v1'};
function deliveryFixture(){
 const h=fixture('delivery-review.js');h.c.PCS.page='errors';h.c.localStorage={pcsToken:'fixture'};h.c.fetch=h.c.call;
 let refreshes=0,toasts=0;h.c.errorsPage=async()=>refreshes++;h.c.toast=()=>toasts++;
 h.c.pcsDeliveryReview.setRows([deliveryRow]);
 const open=()=>{h.c.pcsDeliveryReview.open(0);h.nodes.get('pcsDeliveryReviewed').checked=true;h.nodes.get('pcsDeliveryNote').value='Проверен фактический диалог';};
 return {...h,open,counts:()=>({refreshes,toasts})};
}
test('closed delivery review cannot send through a retained form',async()=>{
 const h=deliveryFixture();h.open();h.c.closeSheet();await h.c.pcsDeliveryReview.submit();assert.equal(h.calls.length,0);
});
test('late delivery acknowledgement does not close or refresh a reopened review',async()=>{
 const h=deliveryFixture();h.open();const old=h.c.pcsDeliveryReview.submit();h.c.closeSheet();h.open();
 const form=h.nodes.get('pcsDeliveryReviewForm'),button=h.nodes.get('pcsDeliveryReviewSave');
 h.calls[0].resolve({ok:true,json:async()=>({ok:true,operator_confirmed:true,review:deliveryRow})});await old;
 assert.equal(h.nodes.get('pcsDeliveryReviewForm'),form);assert.equal(button.disabled,false);assert.deepEqual(h.counts(),{refreshes:0,toasts:0});
 const current=h.c.pcsDeliveryReview.submit();assert.equal(h.calls.length,2);h.calls[1].resolve({ok:false,json:async()=>({error:'current error'})});await current;
 assert.equal(h.nodes.get('pcsDeliveryReviewError').textContent,'current error');
});

test('returning to the same route cannot revive an abandoned offers window',async()=>{
 const h=fixture('application-offers.js'),id='11111111-1111-4111-8111-111111111111';
 const pending=h.c.pcsApplicationOffers.open(id),root=h.nodes.get('pcsOfferRows');
 h.c.pcsNavigation.run('inbox',()=>{});h.c.pcsNavigation.run('crm',()=>{});
 h.calls[0].resolve({application:{id},source:'partner',page:0,rows:[{item_title:'stale same-route offer'}]});await pending;
 assert.equal(root.innerHTML,'');h.nodes.get('pcsOfferRefresh').onclick();assert.equal(h.calls.length,1);
});
test('a retained delivery form cannot submit the replacement form',async()=>{
 const h=deliveryFixture();h.open();const old=h.nodes.get('pcsDeliveryReviewForm');h.c.closeSheet();h.open();
 old.listeners.submit({preventDefault(){}});assert.equal(h.calls.length,0);
});

for(const item of [
 {file:'data-quality.js',open:c=>c.pcsDataQuality.open(),root:'pcsQualityRows',refresh:'pcsQualityRefresh',next:'pcsQualityNext',response:{view:'telegram',page:0,rows:[]}},
 {file:'audit-log.js',open:c=>c.pcsAudit.open(),root:'pcsAuditList',refresh:'pcsAuditRefresh',next:'pcsAuditNext',response:{source:'crm',page:0,rows:[]}},
 {file:'application-workspace.js',open:c=>c.pcsApplications.open(),root:'pcsApplicationQueue',refresh:'pcsApplicationRefresh',next:'pcsApplicationNext',response:{view:'active',page:0,q:'',rows:[]}}
])test(`${item.file}: a closed retained list ignores completion and cannot request another page`,async()=>{
 const h=fixture(item.file),pending=item.open(h.c),root=h.nodes.get(item.root),before=root.innerHTML;
 h.c.closeSheet();h.calls[0].resolve(item.response);await pending;
 assert.equal(root.innerHTML,before);h.nodes.get(item.refresh).onclick();h.nodes.get(item.next).disabled=false;h.nodes.get(item.next).onclick();assert.equal(h.calls.length,1);
});
test('a hidden application queue cannot open a request over another route',async()=>{
 const h=fixture('application-workspace.js'),id='11111111-1111-4111-8111-111111111111',pending=h.c.pcsApplications.open();
 h.calls[0].resolve({view:'active',page:0,q:'',rows:[{id,public_id:'APP-1'}]});await pending;
 const root=h.nodes.get('pcsApplicationQueue');h.c.pcsNavigation.run('inbox',()=>{});
 root.onclick({target:{closest:()=>({dataset:{applicationOpen:'0'}})}});
 assert.equal(h.calls.length,1);assert.equal(h.sheets.length,1);
});
