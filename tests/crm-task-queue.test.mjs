import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../pcs-ai-operator-v6/crm-task-queue.js',import.meta.url),'utf8');
const task={id:'task1',contact_id:'contact1',title:'Call <client>',comment:'<private note>',contact_name:'A & B',priority:'URGENT',due_at:null,is_overdue:false};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
function fixture(call=async()=>({tasks:[task],truncated:false})){
 const nodes={},calls=[],toasts=[];
 const window={call:async(...args)=>{calls.push(args);return call(...args)},toast:s=>toasts.push(s),fmtDateTime:s=>s,
  openSheet:()=>{for(const id of ['crmTaskQueue','crmTaskQueueView','crmTaskQueueError','crmTaskQueueList','crmTaskQueueLimit','crmTaskQueuePrevious','crmTaskQueueNext'])nodes[id]={innerHTML:'',textContent:''}},closeSheet:()=>{delete nodes.crmTaskQueue},go:async()=>{},openClient:async()=>{}};
 vm.runInNewContext(source,{window,document:{getElementById:id=>nodes[id]||null}});
 return{queue:window.pcsTaskQueue,nodes,calls,toasts,window};
}
test('queue opening reads actual tasks, escapes fields and distinguishes an absent deadline',async()=>{
 const f=fixture();await f.queue.open();assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'/crm-tasks?view=open&page=0');
 assert.match(f.nodes.crmTaskQueueList.innerHTML,/Call &lt;client&gt;/);assert.match(f.nodes.crmTaskQueueList.innerHTML,/A &amp; B/);
 assert.match(f.nodes.crmTaskQueueList.innerHTML,/Без срока/);assert.doesNotMatch(f.nodes.crmTaskQueueList.innerHTML,/<private note>/);
});
test('changing filters cannot be overwritten by an older response',async()=>{
 const first=deferred(),second=deferred();let n=0;const f=fixture(()=>++n===1?first.promise:second.promise);
 const opening=f.queue.open(),filtering=f.queue.filter('overdue');second.resolve({tasks:[{...task,title:'New filter',is_overdue:true}],truncated:true});await filtering;
 first.resolve({tasks:[{...task,title:'Stale'}]});await opening;
 assert.match(f.nodes.crmTaskQueueList.innerHTML,/New filter/);assert.doesNotMatch(f.nodes.crmTaskQueueList.innerHTML,/Stale/);
 assert.match(f.nodes.crmTaskQueueLimit.textContent,/ещё задачи/);assert.match(f.nodes.crmTaskQueueList.innerHTML,/Просрочена/);
});
test('duplicate completion taps write once; refresh failure does not claim completion failed',async()=>{
 const send=deferred();let reads=0;const f=fixture((path,opt)=>opt?send.promise:++reads===1?{tasks:[task]}:Promise.reject(Error('Reload unavailable')));
 await f.queue.open();const first=f.queue.complete(0),second=f.queue.complete(0);await second;
 assert.equal(f.calls.filter(x=>x[1]).length,1);send.resolve({ok:true});await first;
 assert.equal(f.toasts[0],'Задача завершена');assert.match(f.nodes.crmTaskQueueError.textContent,/Reload unavailable/);
 assert.equal(f.nodes.crmTaskQueueList.textContent,'');
});
test('failed completion retains the row and allows a retry without false success',async()=>{
 let attempts=0;const f=fixture((path,opt)=>opt?(++attempts===1?Promise.reject(Error('Save failed')):{ok:true}):{tasks:[task]});
 await f.queue.open();await f.queue.complete(0);assert.equal(f.toasts.length,0);assert.match(f.nodes.crmTaskQueueError.textContent,/Save failed/);
 assert.match(f.nodes.crmTaskQueueList.innerHTML,/Call/);await f.queue.complete(0);assert.equal(attempts,2);assert.equal(f.toasts.length,1);
});
test('a closed or replaced sheet is never overwritten by a pending response',async()=>{
 const pending=deferred(),f=fixture(()=>pending.promise);const opening=f.queue.open();f.window.closeSheet();f.nodes.crmTaskQueueList.textContent='Other sheet';
 pending.resolve({tasks:[task]});await opening;assert.equal(f.nodes.crmTaskQueueList.textContent,'Other sheet');
});
test('invalid row identities never reach completion or navigation endpoints',async()=>{
 const f=fixture(async()=>({tasks:[{...task,id:"bad'id",contact_id:"<client>"}]}));await f.queue.open();await f.queue.complete(0);await f.queue.client(0);assert.equal(f.calls.length,1);
 assert.match(f.nodes.crmTaskQueueList.innerHTML,/disabled/);
});

test('pagination reaches remaining tasks and resets when the filter changes',async()=>{
 const f=fixture(async path=>({tasks:[{...task,title:path}],truncated:!path.includes('page=1')}));
 await f.queue.open();assert.equal(f.nodes.crmTaskQueuePrevious.disabled,true);assert.equal(f.nodes.crmTaskQueueNext.disabled,false);
 await f.queue.page(1);assert.match(f.calls.at(-1)[0],/page=1/);assert.equal(f.nodes.crmTaskQueueNext.disabled,true);
 const count=f.calls.length;await f.queue.page(1);assert.equal(f.calls.length,count);
 await f.queue.filter('undated');assert.equal(f.calls.at(-1)[0],'/crm-tasks?view=undated&page=0');
});
