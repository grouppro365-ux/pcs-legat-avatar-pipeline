import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
const files=['crm-message.js','crm-followup.js'];
const entrypoints=[['pcsCrmMessage','crmMessage'],['pcsCrmFollowup','crmFollowup']];
function fixture(storage=new Map()){
 const nodes=new Map(),writes=[],pending=[];let outcome='uncertain';
 const document={getElementById:id=>nodes.get(id)||null};
 const c=vm.createContext({document,crypto:webcrypto,console});c.window=c;c.PCS={page:'crm'};c.toast=()=>{};c.openClient=async()=>{};c.closeSheet=()=>{};
 c.sessionStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
 c.openSheet=(title,html)=>{nodes.clear();for(const [,id] of html.matchAll(/id="([^"]+)"/g))nodes.set(id,{value:'',textContent:'',dataset:{}});const prefix=html.includes('crmMessageForm')?'crmMessage':'crmFollowup';nodes.get(prefix+'Form').dataset={contact:html.match(/data-contact="([^"]+)"/)[1],requestId:html.match(/data-request-id="([^"]+)"/)[1]};nodes.get(prefix+'Text').value='Reviewed text'};
 c.call=async(path,opt)=>{if(!opt)return{contact:{name:'Client',language:'ru'}};const body=JSON.parse(opt.body);writes.push({path,body});if(outcome==='pending')return new Promise((resolve,reject)=>pending.push({resolve,reject}));if(outcome==='success')return{ok:true};const e=Error(outcome);e.code=outcome==='rejected'?'send_rejected':'delivery_uncertain';e.status=outcome==='rejected'?422:409;throw e};
 for(const file of files)vm.runInContext(readFileSync(new URL('../pcs-ai-operator-v6/'+file,import.meta.url),'utf8'),c);
 return{c,nodes,writes,pending,storage,mode:value=>outcome=value};
}
for(const [api,prefix] of entrypoints){
 test(`${api}: close/reopen preserves uncertain message, id and readonly text`,async()=>{
  const h=fixture();await h.c[api].open('client1');await h.c[api].submit();const original=h.writes[0].body;h.c.closeSheet();await h.c[api].open('client1');assert.equal(h.nodes.get(prefix+'Text').readOnly,true);assert.equal(h.nodes.get(prefix+'Text').value,original.text);h.nodes.get(prefix+'Text').value='accidental edit';await h.c[api].submit();assert.deepEqual(h.writes[1].body,original);
 });
 test(`${api}: reload restores uncertain request and another contact stays independent`,async()=>{
  const old=fixture();await old.c[api].open('client1');await old.c[api].submit();const h=fixture(old.storage);await h.c[api].open('client1');await h.c[api].submit();assert.deepEqual(h.writes[0].body,old.writes[0].body);await h.c[api].open('client2');await h.c[api].submit();assert.notEqual(h.writes[1].body.request_id,old.writes[0].body.request_id);assert.equal(h.writes[1].path,'/crm/client2/send');
 });
 test(`${api}: reopening during flight cannot create another transport attempt`,async()=>{
  const h=fixture();h.mode('pending');await h.c[api].open('client1');const first=h.c[api].submit();await h.c[api].open('client1');await h.c[api].submit();assert.equal(h.writes.length,1);h.pending[0].resolve({ok:true});await first;h.mode('success');await h.c[api].submit();assert.deepEqual(h.writes[1].body,h.writes[0].body);
 });
 test(`${api}: definitive rejection permits a fresh reviewed draft on reopen`,async()=>{
  const h=fixture();h.mode('rejected');await h.c[api].open('client1');await h.c[api].submit();const id=h.writes[0].body.request_id;await h.c[api].open('client1');assert.notEqual(h.nodes.get(prefix+'Text').readOnly,true);h.nodes.get(prefix+'Text').value='Corrected draft';h.mode('success');await h.c[api].submit();assert.notEqual(h.writes[1].body.request_id,id);assert.equal(h.writes[1].body.text,'Corrected draft');
 });
}
test('switching between manual message and follow-up shares the unresolved operation',async()=>{
 const h=fixture();await h.c.pcsCrmMessage.open('client1');await h.c.pcsCrmMessage.submit();await h.c.pcsCrmFollowup.open('client1');await h.c.pcsCrmFollowup.submit();assert.deepEqual(h.writes[1].body,h.writes[0].body);
});
test('successful confirmed send allows a new message on a later deliberate open',async()=>{
 const h=fixture();h.mode('success');await h.c.pcsCrmMessage.open('client1');await h.c.pcsCrmMessage.submit();await h.c.pcsCrmMessage.open('client1');h.nodes.get('crmMessageText').value='Next message';await h.c.pcsCrmMessage.submit();assert.notEqual(h.writes[1].body.request_id,h.writes[0].body.request_id);assert.equal(h.writes[1].body.text,'Next message');
});
function lifecycle(h){
 vm.runInContext(readFileSync(new URL('../pcs-ai-operator-v6/sheet-lifecycle.js',import.meta.url),'utf8'),h.c);
 const open=h.c.openSheet;h.c.openSheet=(...args)=>{h.c.pcsSheetLifecycle.invalidate();open(...args)};
 h.c.closeSheet=()=>h.c.pcsSheetLifecycle.invalidate();
}
test('deferred follow-up intent is discarded after close, navigation or another sheet',async()=>{
 for(const action of ['close','page','replace']){
  const h=fixture();lifecycle(h);let resolve;h.c.call=()=>new Promise(r=>resolve=r);const p=h.c.pcsCrmFollowup.open('client1');
  if(action==='close')h.c.closeSheet();else if(action==='page')h.c.PCS.page='catalog';else h.c.pcsCrmMessage.open('client2');
  resolve({contact:{name:'Old client'}});await p;assert.equal(h.nodes.has('crmFollowupForm'),false);
 }
});
test('deferred follow-up ignores older contact responses without lifecycle support',async()=>{
 const h=fixture(),reads=[];h.c.call=()=>new Promise(resolve=>reads.push(resolve));const old=h.c.pcsCrmFollowup.open('client1'),fresh=h.c.pcsCrmFollowup.open('client2');reads[1]({contact:{name:'New'}});await fresh;reads[0]({contact:{name:'Old'}});await old;assert.equal(h.nodes.get('crmFollowupForm').dataset.contact,'client2');
});
for(const [api,prefix] of entrypoints){
 test(`${api}: late success after closing retained DOM does not close or open client`,async()=>{
  const h=fixture();lifecycle(h);let closed=0,opened=0;const close=h.c.closeSheet;h.c.closeSheet=()=>{closed++;close()};h.c.openClient=async()=>opened++;h.mode('pending');await h.c[api].open('client1');const p=h.c[api].submit();h.c.closeSheet();h.pending[0].resolve({ok:true});await p;assert.equal(closed,1);assert.equal(opened,0);await h.c[api].submit();assert.equal(h.writes.length,1);
 });
 test(`${api}: uncertain send followed by authentication failure preserves original id`,async()=>{
  const h=fixture();await h.c[api].open('client1');await h.c[api].submit();const original=h.writes[0].body;
  h.c.call=async(path,opt)=>{h.writes.push({path,body:JSON.parse(opt.body)});throw Object.assign(Error('Unauthorized'),{status:401})};await h.c[api].submit();
  const restored=fixture(h.storage);await restored.c[api].open('client1');await restored.c[api].submit();assert.deepEqual(restored.writes[0].body,original);
 });
}
test('logout clear removes restored private drafts and prevents late responses repopulating ledger',async()=>{
 const h=fixture();h.mode('pending');await h.c.pcsCrmMessage.open('client1');const p=h.c.pcsCrmMessage.submit();assert.equal(h.storage.size,1);h.c.pcsCrmSendAttempts.clear();h.pending[0].resolve({ok:true});await p;assert.equal(h.storage.size,0);assert.equal(h.c.pcsCrmSendAttempts.get('client1'),null);
});
