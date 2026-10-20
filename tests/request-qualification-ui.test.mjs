import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {qualificationTypes} from '../server/supabase/pcs-manager-live2/request-qualification.mjs';
const source=readFileSync(new URL('../pcs-ai-operator-v6/request-qualification.js',import.meta.url),'utf8'),id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const data=()=>({application:{id,edit_version:'a'.repeat(32),qualification:{type:'car_rental',answers:{city:'<unsafe>'},source_note:'Synthetic client chat'}},types:qualificationTypes,editable:true});
function harness(){let root;const calls=[];let response=data(),rejectWrite=false,deferred;const document={addEventListener(){},getElementById(){return root}};
 function makeRoot(){const feedback={textContent:''},progress={textContent:''};let answers=[],html='';const elements=[];elements.type={value:'car_rental'};elements.source_note={value:'Synthetic client chat'};elements.push(elements.type,elements.source_note);const f={elements,querySelector(s){return {'[data-answers]':holder,'[data-progress]':progress,'[data-feedback]':feedback}[s]},querySelectorAll(){return answers},addEventListener(k,fn){f[k]=fn}};const holder={set innerHTML(x){html=x;answers=[...x.matchAll(/data-answer name="([^"]+)"[^>]*?value="([^"]*)"/g)].map(m=>({name:m[1],value:m[2]}));elements.splice(2,elements.length,...answers)},get innerHTML(){return html}};return {html:'',set innerHTML(x){this.html=x},get innerHTML(){return this.html},querySelector(){return f},form:f,feedback,progress,holder};}
 const window={openSheet(){root=makeRoot()},async pcsManagerRequest(op,b){calls.push({op,...b});if(b.method==='POST'){if(rejectWrite)throw Error('Network unavailable');return {ok:true};}return deferred?await deferred:response;}};
 vm.runInNewContext(source,{window,document,crypto});return {window,calls,get root(){return root},response(x){response=x},reject(x){rejectWrite=x},defer(x){deferred=x},detach(){root=makeRoot()}};
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
