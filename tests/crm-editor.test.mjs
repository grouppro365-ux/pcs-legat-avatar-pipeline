import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function fixture(){
 const contact={id:'cmcontact1',edit_version:'2026-10-03 00:00:00.123456',name:'Actual',priority:'URGENT',status:'WAITING_CLIENT',next_action_at:null};
 const nodes={},calls=[],toasts=[],sheets=[];let fail=false,finish,closed=0;
 const window={PCS:{crm:[{name:'Outdated'}]},call:async(path,opt)=>{calls.push({path,opt});if(!opt)return path==='/crm'?[]:{contact};if(fail)throw Error('Карточка изменилась');return new Promise(resolve=>{finish=()=>resolve({contact:{...contact,name:'Changed'}})})},openSheet:(title,html)=>sheets.push(html),closeSheet:()=>closed++,toast:s=>toasts.push(s),openClient:async()=>{}};
 vm.runInNewContext(readFileSync(new URL('../pcs-ai-operator-v6/crm-editor.js',import.meta.url),'utf8'),{window,document:{getElementById:id=>nodes[id]},crypto:globalThis.crypto,Date});
 function editorNodes(){nodes.crmEditorForm={};nodes.crmEditorError={textContent:''};nodes.crmEditorSave={disabled:false};for(const k of ['name','phone','username','language','city','country','budget','need','next_action','status','priority','next_action_at'])nodes['crmEdit_'+k]={value:contact[k]||''};nodes.crmEdit_name.value='Changed'}
 function taskNodes(){nodes.crmTaskForm={};nodes.crmTaskError={textContent:''};nodes.crmTaskSave={disabled:false};nodes.crmTaskTitle={value:'Call'};nodes.crmTaskComment={value:''};nodes.crmTaskDue={value:''}}
 return{api:window.pcsCrmEditor,calls,toasts,sheets,nodes,editorNodes,taskNodes,fail:()=>{fail=true},recover:()=>{fail=false},finish:()=>finish(),closed:()=>closed};
}
test('editor reads the current server contact and preserves all priority values',async()=>{
 const f=fixture();await f.api.edit('cmcontact1');assert.equal(f.calls[0].path,'/crm/cmcontact1');assert.match(f.sheets[0],/value="Actual"/);assert.match(f.sheets[0],/value="URGENT" selected/);assert.doesNotMatch(f.sheets[0],/Outdated/);
});
test('partial saves carry exact versions and do not invent reminders or overwrite unchanged priorities',async()=>{
 const f=fixture();await f.api.edit('cmcontact1');f.editorNodes();const pending=f.api.save();await f.api.save();const writes=f.calls.filter(c=>c.opt);assert.equal(writes.length,1);assert.deepEqual(JSON.parse(writes[0].opt.body),{expected_version:'2026-10-03 00:00:00.123456',name:'Changed'});f.finish();await pending;assert.equal(f.closed(),1);
});
test('conflicts keep edits visible and allow retry',async()=>{
 const f=fixture();await f.api.edit('cmcontact1');f.editorNodes();f.fail();await f.api.save();assert.equal(f.nodes.crmEdit_name.value,'Changed');assert.equal(f.nodes.crmEditorSave.disabled,false);assert.equal(f.closed(),0);assert.equal(f.toasts.length,0);assert.match(f.nodes.crmEditorError.textContent,/изменилась/);
});
test('task retries reuse one stable ID and preserve an absent deadline',async()=>{
 const f=fixture();f.api.taskForm('cmcontact1');f.taskNodes();f.fail();await f.api.createTask();const first=JSON.parse(f.calls[0].opt.body);assert.equal(first.due_at,null);assert.equal(f.closed(),0);f.recover();const pending=f.api.createTask();await f.api.createTask();const second=JSON.parse(f.calls[1].opt.body);assert.equal(first.id,second.id);assert.equal(f.calls.length,2);f.finish();await pending;assert.equal(f.closed(),1);
});
test('repeated complete taps send once and malformed IDs do not send',async()=>{
 const f=fixture();await f.api.complete("bad'id",'task');assert.equal(f.calls.length,0);const pending=f.api.complete('cmcontact1','task1');await f.api.complete('cmcontact1','task1');assert.equal(f.calls.length,1);f.finish();await pending;
});
test('quick actions prepare a reviewable edit and do not mutate on opening',async()=>{
 for(const [kind,key,value] of [['hot','priority','HOT'],['waiting','status','WAITING_CLIENT'],['lost','status','LOST'],['paid','status','PAID']]){
  const f=fixture();f.editorNodes();await f.api.action('cmcontact1',kind);assert.equal(f.nodes['crmEdit_'+key].value,value);assert.equal(f.calls.length,1);assert.equal(f.calls[0].opt,undefined);
 }
});
test('readiness keeps existing next-step notes and does not fabricate a payment status',async()=>{
 const f=fixture();f.editorNodes();f.nodes.crmEdit_next_action.value='Ask about dates';await f.api.action('cmcontact1','ready_to_pay');assert.match(f.nodes.crmEdit_next_action.value,/Клиент готов к оплате/);assert.match(f.nodes.crmEdit_next_action.value,/Ask about dates/);assert.equal(f.nodes.crmEdit_status.value,'WAITING_CLIENT');assert.equal(f.calls.length,1);
});
