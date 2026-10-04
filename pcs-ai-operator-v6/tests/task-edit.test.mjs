import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../crm-task-edit.js',import.meta.url),'utf8'),task={id:'task1',contact_id:'contact1',title:'Call <client>',comment:'Preserved',priority:'NORMAL',due_at:null,assignee:null,edit_version:'2026-10-04 12:00:00.123456'};
function fixture(){const calls=[],nodes={},toasts=[],sheets=[];let writeResolve,writeReject;
 const window={PCS:{page:'crm'},call:async(path,opt)=>{calls.push({path,opt});if(!opt)return{task};return new Promise((resolve,reject)=>{writeResolve=resolve;writeReject=reject})},toast:v=>toasts.push(v),openSheet:(title,html)=>{sheets.push(html);for(const [id,value] of Object.entries({pcsTaskEditForm:'',pcsTaskTitle:task.title,pcsTaskComment:task.comment,pcsTaskPriority:task.priority,pcsTaskDue:'',pcsTaskAssignee:'',pcsTaskEditError:'',pcsTaskEditSave:''}))nodes[id]={value,textContent:'',disabled:false,addEventListener(){}}},closeSheet:()=>{delete nodes.pcsTaskEditForm},pcsTaskQueue:{open:async()=>{throw Error('Refresh failed')}}};
 vm.runInNewContext(source,{window,document:{getElementById:id=>nodes[id]||null},Date});return{window,nodes,calls,sheets,toasts,resolve:x=>writeResolve(x),reject:x=>writeReject(x)};}
test('editor reads exact task identity, escapes fields and writes only changed values once',async()=>{
 const h=fixture();await h.window.pcsTaskEdit.open('contact1','task1');assert.match(h.sheets[0],/Call &lt;client&gt;/);h.nodes.pcsTaskPriority.value='HIGH';const first=h.window.pcsTaskEdit.submit();await h.window.pcsTaskEdit.submit();assert.equal(h.calls.filter(x=>x.opt).length,1);
 const body=JSON.parse(h.calls[1].opt.body);assert.deepEqual(body,{expected_version:task.edit_version,priority:'HIGH'});h.resolve({ok:true,task:{...task,priority:'HIGH'}});await first;assert.equal(h.toasts[0],'Задача обновлена');assert.match(h.toasts[1],/сохранена/);
});
test('conflicts preserve draft and re-enable fields without false success',async()=>{
 const h=fixture();await h.window.pcsTaskEdit.open('contact1','task1');h.nodes.pcsTaskComment.value='New draft';const save=h.window.pcsTaskEdit.submit();h.reject(Error('Task changed'));await save;assert.equal(h.nodes.pcsTaskComment.value,'New draft');assert.equal(h.nodes.pcsTaskComment.disabled,false);assert.equal(h.nodes.pcsTaskEditError.textContent,'Task changed');assert.equal(h.toasts.length,0);
});
test('unmodified deadline never loses seconds, and UTC values are converted for local input',async()=>{
 const h=fixture();assert.equal(h.window.pcsTaskEdit.localDate(null),'');assert.equal(h.window.pcsTaskEdit.localDate('invalid'),'');const expected=new Date(Date.parse('2026-10-05T12:34:56Z')-new Date('2026-10-05T12:34:56Z').getTimezoneOffset()*60000).toISOString().slice(0,16);assert.equal(h.window.pcsTaskEdit.localDate('2026-10-05 12:34:56'),expected);
});
