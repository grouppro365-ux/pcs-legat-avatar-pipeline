import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../pcs-ai-operator-v6/approval-review.js',import.meta.url),'utf8');
function fixture({delivery_status,delivery_stage,listError}={}){
 const row={id:'generation1',contact_id:'client1',contact_name:'<Customer>',source_text:'<Incoming>',answer:'<Reviewed answer>',edit_version:'exact version',delivery_status,delivery_stage};
 const nodes={main:{innerHTML:''},approvalList:{innerHTML:''},approvalReviewForm:{dataset:{id:row.id}},approvalReviewError:{},approvalSend:{},approvalReject:{}};
 const calls=[],sheets=[],toasts=[];let resolve,error,closed=0;
 const window={openSheet:(title,html)=>sheets.push(html),closeSheet:()=>closed++,toast:s=>toasts.push(s),call:async(path,opts)=>{
  calls.push({path,opts});if(path.startsWith('/approvals?')){if(listError)throw Error('Queue unavailable');return[row]}
  if(error)throw error;return new Promise(r=>resolve=r);
 }};
 vm.runInNewContext(source,{window,document:{getElementById:id=>nodes[id]}});
 return{api:window.pcsApprovals,nodes,calls,sheets,toasts,closed:()=>closed,finish:()=>resolve({ok:true}),fail:e=>error=e,row};
}
test('approval queue is read-only, escapes content and opens a review before any decision',async()=>{
 const f=fixture();await f.api.list();f.api.open('generation1');assert.equal(f.calls.length,1);
 assert.match(f.nodes.approvalList.innerHTML,/&lt;Incoming&gt;/);assert.doesNotMatch(f.nodes.approvalList.innerHTML,/<Incoming>/);
 assert.match(f.sheets[0],/readonly/);assert.match(f.sheets[0],/&lt;Reviewed answer&gt;/);assert.match(f.sheets[0],/Диалог клиента/);
});
test('reviewed answer and exact version are sent once despite repeated clicks',async()=>{
 const f=fixture();await f.api.list();const first=f.api.decide('send');await f.api.decide('send');await f.api.decide('reject');
 assert.equal(f.calls.length,2);assert.deepEqual(JSON.parse(f.calls[1].opts.body),{expected_version:'exact version',text:'<Reviewed answer>'});
 assert.equal(f.nodes.approvalSend.disabled,true);f.finish();await first;assert.equal(f.closed(),1);assert.equal(f.toasts[0],'Ответ отправлен');
});
test('reopened uncertain approval keeps rejection blocked and offers receipt check',async()=>{
 const f=fixture({delivery_status:'PROCESSING',delivery_stage:'sending'});await f.api.list();f.api.open('generation1');
 assert.match(f.sheets[0],/Проверить отправку/);assert.match(f.sheets[0],/id="approvalReject"[^>]+disabled/);
 f.fail(Object.assign(Error('Delivery unknown'),{code:'delivery_uncertain',status:409}));await f.api.decide('send');assert.equal(f.toasts.length,0);assert.equal(f.nodes.approvalReject.disabled,true);
});
test('network loss prevents a contradictory rejection without falsely confirming delivery',async()=>{
 const f=fixture();await f.api.list();f.fail(Error('Network lost'));await f.api.decide('send');
 assert.equal(f.toasts.length,0);assert.equal(f.nodes.approvalReject.disabled,true);assert.equal(f.nodes.approvalSend.textContent,'Проверить отправку');
});
test('queue errors remain visible instead of claiming an empty queue',async()=>{
 const f=fixture({listError:true});await f.api.list();assert.equal(f.nodes.approvalList.textContent,'Queue unavailable');
});
test('an async decision cannot close a replaced review form',async()=>{
 const f=fixture();await f.api.list();const pending=f.api.decide('reject');f.nodes.approvalReviewForm={dataset:{id:'other'}};f.finish();await pending;assert.equal(f.closed(),0);
});

test('approval queue requests a bounded page without dropping access to older answers',async()=>{
 const f=fixture();await f.api.list(2);assert.equal(f.calls[0].path,'/approvals?page=2');assert.match(f.nodes.approvalList.innerHTML,/Страница 3/);
 await f.api.list(-1);assert.equal(f.calls.length,1);
});
