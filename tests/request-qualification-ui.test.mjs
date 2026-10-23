import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {qualificationTypes} from '../server/supabase/pcs-manager-live2/request-qualification.mjs';
const source=readFileSync(new URL('../pcs-ai-operator-v6/request-qualification.js',import.meta.url),'utf8'),id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const data=()=>({application:{id,edit_version:'a'.repeat(32),qualification:{type:'car_rental',answers:{city:'<unsafe>'},source_note:'Synthetic client chat'}},types:qualificationTypes,editable:true});
const pending=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};};
function harness(){
 let root,epoch=0,response=data(),rejectWrite=false,deferred,writeResponse,readFailure=false;
 const calls=[],document={addEventListener(){},getElementById(){return root}};
 function makeRoot(){
  const node={html:'',form:null};
  Object.defineProperty(node,'innerHTML',{get:()=>node.html,set(value){
   node.html=value;node.feedback={textContent:''};node.progress={textContent:''};let answers=[],html='';
   const elements=[];elements.type={value:'car_rental'};elements.source_note={value:'Synthetic client chat'};elements.push(elements.type,elements.source_note);
   const f=node.form={elements,querySelector(s){return {'[data-answers]':holder,'[data-progress]':node.progress,'[data-feedback]':node.feedback}[s]},querySelectorAll(){return answers},addEventListener(k,fn){f[k]=fn}};
   const holder=node.holder={set innerHTML(x){html=x;answers=[...x.matchAll(/data-answer name="([^"]+)"[^>]*?value="([^"]*)"/g)].map(m=>({name:m[1],value:m[2]}));elements.splice(2,elements.length,...answers)},get innerHTML(){return html}};
  }});node.querySelector=()=>node.form;return node;
 }
 const window={pcsSheetLifecycle:{capture:()=>({epoch}),current:ticket=>ticket.epoch===epoch},openSheet(){epoch++;root=makeRoot()},async pcsManagerRequest(op,b){
  calls.push({op,...b});if(b.method==='POST'){if(writeResponse)return await writeResponse;if(rejectWrite)throw Error('Network unavailable');return {ok:true};}
  if(readFailure)throw Error('Refresh unavailable');return deferred?await deferred:response;
 }};
 vm.runInNewContext(source,{window,document,crypto});
 return{window,calls,get root(){return root},response(x){response=x},reject(x){rejectWrite=x},defer(x){deferred=x},deferWrite(x){writeResponse=x},failRead(x){readFailure=x},invalidate(){epoch++},detach(){root=makeRoot()}};
}
test('qualification escapes saved client values and does not create messages',async()=>{const h=harness();await h.window.pcsQualification.open(id);assert.match(h.root.holder.innerHTML,/&lt;unsafe&gt;/);assert.equal(h.calls.length,1);assert.match(h.root.innerHTML,/не подтверждаются/);});
test('network retry reuses command and retains draft',async()=>{const h=harness();await h.window.pcsQualification.open(id);h.reject(true);const f=h.root.form;await f.onsubmit({preventDefault(){}});const first=h.calls.at(-1).body;assert.match(h.root.feedback.textContent,/остались в форме/);await f.onsubmit({preventDefault(){}});assert.equal(h.calls.at(-1).body.request_id,first.request_id);assert.equal(h.calls.at(-1).body.expected_version,'a'.repeat(32));assert.equal(f.elements.type.disabled,false);});
test('detached slow read cannot overwrite newly opened screen',async()=>{const h=harness();let resolve;h.defer(new Promise(r=>resolve=r));const pending=h.window.pcsQualification.open(id);h.detach();const screen=h.root;resolve(data());await pending;assert.equal(screen.innerHTML,'');});
test('read only form cannot submit',async()=>{const h=harness();h.response({...data(),editable:false});await h.window.pcsQualification.open(id);assert.doesNotMatch(h.root.innerHTML,/type="submit"/);await h.root.form.onsubmit({preventDefault(){}});assert.equal(h.calls.length,1);});

test('switching visa and transfer preserves per-service drafts and submits only selected fields',async()=>{
 const h=harness();await h.window.pcsQualification.open(id);const f=h.root.form;
 f.elements.type.value='visa';f.elements.type.onchange();
 assert.match(h.root.holder.innerHTML,/name="nationality"/);assert.match(h.root.holder.innerHTML,/name="target_visa"/);
 assert.doesNotMatch(h.root.holder.innerHTML,/name="vehicle_class"/);
 f.querySelectorAll().find(x=>x.name==='nationality').value='Synthetic nationality';f.input();
 f.elements.type.value='transfer';f.elements.type.onchange();
 assert.match(h.root.holder.innerHTML,/name="transfer_date" type="date"/);assert.match(h.root.holder.innerHTML,/name="transfer_time" type="time"/);
 f.querySelectorAll().find(x=>x.name==='pickup').value='BKK';f.input();
 f.elements.type.value='visa';f.elements.type.onchange();
 assert.equal(f.querySelectorAll().find(x=>x.name==='nationality').value,'Synthetic nationality');
 assert.match(h.root.progress.textContent,/Текущий визовый статус/);
 f.elements.type.value='transfer';f.elements.type.onchange();h.reject(true);await f.onsubmit({preventDefault(){}});
 const write=h.calls.at(-1).body;assert.equal(write.type,'transfer');assert.equal(write.answers.pickup,'BKK');assert.equal(Object.hasOwn(write.answers,'nationality'),false);
});

test('closed sheet with mounted root cannot paint a late qualification read',async()=>{
 const h=harness(),read=pending();h.defer(read.promise);const loading=h.window.pcsQualification.open(id);const root=h.root;h.invalidate();read.resolve(data());await loading;
 assert.equal(h.root,root);assert.equal(root.innerHTML,'');assert.equal(root.form,null);
});
test('closing a sheet during save cannot reopen it or start a refresh',async()=>{
 const h=harness(),write=pending();await h.window.pcsQualification.open(id);h.deferWrite(write.promise);const f=h.root.form,saving=f.onsubmit({preventDefault(){}});h.invalidate();write.resolve({ok:true});await saving;
 assert.equal(h.calls.length,2);assert.equal(h.root.form,f);
});
test('a stale save failure cannot update a newly opened request',async()=>{
 const h=harness(),write=pending();await h.window.pcsQualification.open(id);h.deferWrite(write.promise);const saving=h.root.form.onsubmit({preventDefault(){}});await h.window.pcsQualification.open('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');const root=h.root;write.reject(Error('Old failure'));await saving;
 assert.equal(h.root,root);assert.equal(root.feedback.textContent,'');assert.equal(root.form.elements.type.disabled,undefined);
});
test('rapid repeated submit sends only one POST while save is pending',async()=>{
 const h=harness(),write=pending();await h.window.pcsQualification.open(id);h.deferWrite(write.promise);const f=h.root.form,saving=f.onsubmit({preventDefault(){}});await f.onsubmit({preventDefault(){}});
 assert.equal(h.calls.filter(c=>c.method==='POST').length,1);assert.equal(f.elements.type.disabled,true);write.reject(Error('Network unavailable'));await saving;assert.equal(f.elements.type.disabled,false);
});
test('unknown-result retry with unchanged values retains ID even after a harmless input event',async()=>{
 const h=harness();await h.window.pcsQualification.open(id);h.reject(true);const f=h.root.form;await f.onsubmit({preventDefault(){}});const first=h.calls.at(-1).body;
 f.input();await f.onsubmit({preventDefault(){}});assert.equal(h.calls.at(-1).body.request_id,first.request_id);
});
test('changed values get a new request ID even without an input event',async()=>{
 const h=harness();await h.window.pcsQualification.open(id);h.reject(true);const f=h.root.form;await f.onsubmit({preventDefault(){}});const first=h.calls.at(-1).body;
 f.elements.source_note.value='Changed source details';f.querySelectorAll().find(x=>x.name==='city').value='Bangkok';await f.onsubmit({preventDefault(){}});const changed=h.calls.at(-1).body;
 assert.notEqual(changed.request_id,first.request_id);assert.equal(changed.answers.city,'Bangkok');assert.equal(first.source_note,'Synthetic client chat');assert.notEqual(first.answers.city,changed.answers.city);
});
test('successful save with failed refresh preserves answers and exact retry command',async()=>{
 const h=harness();await h.window.pcsQualification.open(id);const root=h.root,f=root.form;f.elements.source_note.value='Keep this source';f.querySelectorAll().find(x=>x.name==='city').value='Pattaya';h.failRead(true);
 await f.onsubmit({preventDefault(){}});const command=h.calls.find(c=>c.method==='POST').body;
 assert.equal(h.root,root);assert.equal(root.form,f);assert.equal(f.querySelectorAll().find(x=>x.name==='city').value,'Pattaya');assert.equal(f.elements.source_note.value,'Keep this source');assert.match(root.feedback.textContent,/Ответы сохранены, но/);assert.equal(f.elements.type.disabled,false);
 await f.onsubmit({preventDefault(){}});assert.equal(h.calls.filter(c=>c.method==='POST').at(-1).body.request_id,command.request_id);
});
test('closing during post-save refresh prevents stale rendering',async()=>{
 const h=harness(),read=pending();await h.window.pcsQualification.open(id);h.defer(read.promise);const f=h.root.form,saving=f.onsubmit({preventDefault(){}});await new Promise(setImmediate);assert.equal(h.calls.length,3);h.invalidate();read.resolve(data());await saving;
 assert.equal(h.root.form,f);assert.equal(h.calls.length,3);
});
test('successful refresh replaces the form and preserves read-only permissions',async()=>{
 const h=harness();await h.window.pcsQualification.open(id);const f=h.root.form;h.response({...data(),editable:false});await f.onsubmit({preventDefault(){}});
 assert.notEqual(h.root.form,f);assert.doesNotMatch(h.root.innerHTML,/type="submit"/);assert.equal(h.calls.length,3);await h.root.form.onsubmit({preventDefault(){}});assert.equal(h.calls.length,3);
});

test('automatic exact-source answers stay separate from operator answers',async()=>{const h=harness();h.response({...data(),automatic:{status:'EXTRACTED_UNVERIFIED',type:'car_rental',answers:{city:'<automatic>'},assessment:{missing_questions:[{question:'Dates?'}]}}});await h.window.pcsQualification.open(id);assert.match(h.root.innerHTML,/&lt;automatic&gt;/);assert.match(h.root.innerHTML,/ещё не подтверждены оператором/);assert.match(h.root.holder.innerHTML,/&lt;unsafe&gt;/);assert.doesNotMatch(h.root.holder.innerHTML,/automatic/);assert.equal(h.calls.length,1);});
test('source extraction reuses command and cannot submit read-only or closed forms',async()=>{const h=harness();await h.window.pcsQualification.open(id);h.reject(true);const button={disabled:false};await h.window.pcsQualification.extract(button);const first=h.calls.at(-1);assert.equal(first.op,'request-source-qualification');await h.window.pcsQualification.extract(button);assert.equal(h.calls.at(-1).body.request_id,first.body.request_id);h.invalidate();const n=h.calls.length;await h.window.pcsQualification.extract(button);assert.equal(h.calls.length,n);const ro=harness();ro.response({...data(),editable:false});await ro.window.pcsQualification.open(id);await ro.window.pcsQualification.extract();assert.equal(ro.calls.length,1);});
test('extraction freezes pending fields and preserves unsaved operator draft on refresh',async()=>{const h=harness();await h.window.pcsQualification.open(id);const old=h.root.form;old.elements.source_note.value='Unsaved source';old.querySelectorAll().find(x=>x.name==='city').value='Unsaved city';const write=pending();h.deferWrite(write.promise);const extracting=h.window.pcsQualification.extract({disabled:false});assert.equal(old.elements.type.disabled,true);write.resolve({ok:true});await extracting;assert.notEqual(h.root.form,old);assert.equal(h.root.form.querySelectorAll().find(x=>x.name==='city').value,'Unsaved city');assert.match(h.root.innerHTML,/Unsaved source/);});

test('source extraction preserves drafts for every service, not only the currently selected service',async()=>{
 const h=harness();await h.window.pcsQualification.open(id);let f=h.root.form;
 f.elements.type.value='visa';f.elements.type.onchange();f.querySelectorAll().find(x=>x.name==='nationality').value='Unsaved visa nationality';f.input();
 f.elements.type.value='transfer';f.elements.type.onchange();f.querySelectorAll().find(x=>x.name==='pickup').value='Unsaved BKK pickup';f.input();
 await h.window.pcsQualification.extract({disabled:false});f=h.root.form;assert.equal(f.querySelectorAll().find(x=>x.name==='pickup').value,'Unsaved BKK pickup');
 f.elements.type.value='visa';f.elements.type.onchange();assert.equal(f.querySelectorAll().find(x=>x.name==='nationality').value,'Unsaved visa nationality');
 f.elements.type.value='transfer';f.elements.type.onchange();assert.equal(f.querySelectorAll().find(x=>x.name==='pickup').value,'Unsaved BKK pickup');
});
