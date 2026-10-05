import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const id='11111111-1111-4111-8111-111111111111',version='a'.repeat(32);
function fixture(){const nodes={},calls=[];function parse(html){for(const m of html.matchAll(/id="([^"]+)"/g)){let content='';const n={value:'',disabled:false,textContent:''};Object.defineProperty(n,'innerHTML',{get:()=>content,set:html=>{content=html;parse(html)}});nodes[m[1]]=n}}const window={openSheet:(title,html)=>parse(html),call:(url,init)=>new Promise((resolve,reject)=>calls.push({url,init,resolve,reject}))};vm.runInNewContext(readFileSync(new URL('../application-workspace.js',import.meta.url),'utf8'),{window,document:{getElementById:id=>nodes[id]},URLSearchParams,Date,Intl});return {nodes,calls,window};}
const tick=()=>new Promise(r=>setImmediate(r));
async function detail(h){const p=h.window.pcsApplications.openDetail(id);h.calls.at(-1).resolve({application:{id,edit_version:version,public_id:'APP-QA',operational_status:'NEW',follow_up_at:null,follow_up_note:null}});await p;}
test('queue escapes records, filters and pages; stale/error responses do not look empty',async()=>{
 const h=fixture(),p=h.window.pcsApplications.open();h.calls[0].resolve({view:'active',page:0,q:'',rows:[{id,client_name:'<img>',item_title:'<script>'}],truncated:true});await p;assert.doesNotMatch(h.nodes.pcsApplicationQueue.innerHTML,/<img>|<script>/);assert.equal(h.nodes.pcsApplicationNext.disabled,false);
 h.nodes.pcsApplicationView.onchange({target:{value:'attention'}});h.nodes.pcsApplicationView.onchange({target:{value:'all'}});h.calls[2].resolve({view:'all',page:0,q:'',rows:[{id,public_id:'Current'}]});await tick();h.calls[1].resolve({view:'attention',page:0,q:'',rows:[{id,public_id:'Old'}]});await tick();assert.match(h.nodes.pcsApplicationQueue.innerHTML,/Current/);assert.doesNotMatch(h.nodes.pcsApplicationQueue.innerHTML,/Old/);
 h.nodes.pcsApplicationRefresh.onclick();h.calls[3].reject(Error('Unavailable'));await tick();assert.equal(h.nodes.pcsApplicationQueue.textContent,'Unavailable');
});
test('search is explicit, trimmed, resets page and safely binds URL characters',async()=>{
 const h=fixture();h.window.pcsApplications.open();h.nodes.pcsApplicationSearch.value="  100% & <q>  ";h.nodes.pcsApplicationSearchForm.onsubmit({preventDefault(){}});const u=new URL(h.calls[1].url,'https://test.invalid');assert.equal(u.searchParams.get('q'),'100% & <q>');assert.equal(u.searchParams.get('page'),'0');
});
test('followup save guards double click, verifies receipt and refreshes the version',async()=>{
 const h=fixture();await detail(h);h.nodes.pcsApplicationFollowupAt.value='2026-10-08T12:00';h.nodes.pcsApplicationFollowupNote.value=' Check dates ';const submit=()=>h.nodes.pcsApplicationFollowupForm.onsubmit({preventDefault(){}});submit();submit();assert.equal(h.calls.length,2);const b=JSON.parse(h.calls[1].init.body);assert.equal(b.expected_version,version);assert.equal(b.follow_up_note,' Check dates ');assert.equal(b.follow_up_at,new Date('2026-10-08T12:00').toISOString());assert.equal(h.nodes.pcsApplicationFollowupSave.disabled,true);
 h.calls[1].resolve({ok:true,application:{id,edit_version:'b'.repeat(32),follow_up_at:b.follow_up_at,follow_up_note:'Check dates'}});await tick();assert.equal(h.nodes.pcsApplicationFollowupSave.disabled,false);assert.match(h.nodes.pcsApplicationFollowupMessage.textContent,/сохранён/);submit();assert.equal(JSON.parse(h.calls[2].init.body).expected_version,'b'.repeat(32));
});
test('failed or mismatched saves retain draft and a closed sheet cannot be updated',async()=>{
 const h=fixture();await detail(h);h.nodes.pcsApplicationFollowupNote.value='Keep draft';h.nodes.pcsApplicationFollowupForm.onsubmit({preventDefault(){}});h.calls[1].reject(Error('Conflict'));await tick();assert.equal(h.nodes.pcsApplicationFollowupNote.value,'Keep draft');assert.equal(h.nodes.pcsApplicationFollowupMessage.textContent,'Conflict');
 h.nodes.pcsApplicationFollowupForm.onsubmit({preventDefault(){}});h.calls[2].resolve({ok:true,application:{id,edit_version:version,follow_up_at:null,follow_up_note:'Wrong'}});await tick();assert.match(h.nodes.pcsApplicationFollowupMessage.textContent,/Проверьте заявку/);assert.equal(h.nodes.pcsApplicationFollowupNote.value,'Keep draft');
 h.nodes.pcsApplicationFollowupForm.onsubmit({preventDefault(){}});const old=h.nodes.pcsApplicationFollowupMessage;await detail(h);h.calls[3].resolve({ok:true,application:{id,edit_version:version,follow_up_at:null,follow_up_note:'Keep draft'}});await tick();assert.equal(old.textContent,'Сохраняю…');assert.notEqual(h.nodes.pcsApplicationFollowupMessage,old);
});
test('clear deadline changes draft only; terminal requests disable planning',async()=>{
 const h=fixture();await detail(h);h.nodes.pcsApplicationFollowupAt.value='2026-10-08T12:00';h.nodes.pcsApplicationFollowupClear.onclick();assert.equal(h.nodes.pcsApplicationFollowupAt.value,'');assert.equal(h.calls.length,1);
 const p=h.window.pcsApplications.openDetail(id);h.calls[1].resolve({application:{id,edit_version:version,operational_status:'COMPLETED'}});await p;assert.match(h.nodes.pcsApplicationDetail.innerHTML,/Завершённую заявку/);h.nodes.pcsApplicationFollowupForm.onsubmit({preventDefault(){}});assert.equal(h.calls.length,2);
});
