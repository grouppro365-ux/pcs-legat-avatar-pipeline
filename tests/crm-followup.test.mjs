import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const cid='11111111-1111-4111-8111-111111111111';
function fixture(){
 const nodes={crmFollowupForm:{dataset:{contact:cid}},crmFollowupText:{value:'Edited message'},crmFollowupError:{textContent:''},crmFollowupSend:{disabled:false,textContent:'Отправить клиенту'}};
 const calls=[],sheets=[],toasts=[];let finish,fail=false,closed=0;
 const window={call:async(path,opt)=>{calls.push({path,opt});if(!opt)return{contact:{name:'<Client>',need:'<img onerror=x>',language:'ru'}};if(fail)throw Error('unavailable');return new Promise(resolve=>{finish=resolve})},openSheet:(title,html)=>sheets.push({title,html}),toast:s=>toasts.push(s),closeSheet:()=>closed++,openClient:async()=>{}};
 vm.runInNewContext(readFileSync(new URL('../pcs-ai-operator-v6/crm-followup.js',import.meta.url),'utf8'),{window,document:{getElementById:id=>nodes[id]}});
 return{api:window.pcsCrmFollowup,window,nodes,calls,sheets,toasts,finish:()=>finish({ok:true}),fail:()=>{fail=true},closed:()=>closed};
}
test('opening a follow-up performs a read and escapes client data, without sending',async()=>{
 const f=fixture();await f.api.open(cid);assert.equal(f.calls.length,1);assert.equal(f.calls[0].opt,undefined);assert.match(f.sheets[0].html,/&lt;Client&gt;/);assert.doesNotMatch(f.sheets[0].html,/<img/);
});
test('edited text is sent only on submit and repeated taps send once',async()=>{
 const f=fixture();const pending=f.api.submit();await f.api.submit();assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,`/crm/${cid}/send`);assert.equal(JSON.parse(f.calls[0].opt.body).text,'Edited message');assert.equal(f.nodes.crmFollowupSend.disabled,true);f.finish();await pending;assert.equal(f.closed(),1);
});
test('failed send keeps the message and enables retry without claiming success',async()=>{
 const f=fixture();f.fail();await f.api.submit();assert.equal(f.nodes.crmFollowupText.value,'Edited message');assert.equal(f.nodes.crmFollowupSend.disabled,false);assert.match(f.nodes.crmFollowupError.textContent,/не отправлено/);assert.equal(f.closed(),0);assert.equal(f.toasts.length,0);
});
test('a failed card refresh after delivery does not report the message as unsent',async()=>{
 const f=fixture();f.window.openClient=async()=>{throw Error('refresh failed')};const pending=f.api.submit();f.finish();await pending;assert.equal(f.calls.length,1);assert.equal(f.closed(),1);assert.equal(f.nodes.crmFollowupError.textContent,'');assert.match(f.toasts.at(-1),/Сообщение отправлено/);
});
test('empty messages and malformed client IDs do not send requests',async()=>{
 const f=fixture();f.nodes.crmFollowupText.value=' ';await f.api.submit();assert.equal(f.calls.length,0);await f.api.open("');send()");assert.equal(f.calls.length,0);
});
test('drafts support Russian, English, Thai and mark unsupported language fallback',()=>{
 const f=fixture();assert.match(f.api.draft({language:'ru'}).text,/Ваш запрос/);assert.match(f.api.draft({language:'en'}).text,/Hello/);assert.match(f.api.draft({language:'th'}).text,/ค่ะ/);assert.equal(f.api.draft({language:'ja'}).fallback,true);
});
