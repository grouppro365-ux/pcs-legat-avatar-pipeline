import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../pcs-ai-operator-v6/crm-message.js',import.meta.url),'utf8');
function fixture(){
 const nodes={crmMessageForm:{dataset:{contact:'client1'}},crmMessageText:{value:'Reviewed text'},crmMessageError:{textContent:''},crmMessageSend:{disabled:false,textContent:''}};
 const calls=[],sheets=[],toasts=[];let resolve,error,closed=0;
 const window={openSheet:(title,html)=>sheets.push({title,html}),closeSheet:()=>closed++,toast:s=>toasts.push(s),openClient:async()=>{},call:async(...args)=>{calls.push(args);if(error)throw error;return new Promise(r=>resolve=r)}};
 vm.runInNewContext(source,{window,crypto:globalThis.crypto,document:{getElementById:id=>nodes[id]}});
 return{api:window.pcsCrmMessage,nodes,calls,sheets,toasts,window,finish:()=>resolve({ok:true}),fail:e=>error=e,closed:()=>closed};
}
test('opening a reviewed message does not send and malformed contacts never open a form',()=>{
 const f=fixture();f.api.open('client1');assert.equal(f.calls.length,0);assert.match(f.sheets[0].html,/data-request-id/);f.api.open("<bad>");assert.equal(f.sheets.length,1);
});
test('double submission produces one request and success closes only the current form',async()=>{
 const f=fixture();const first=f.api.submit();await f.api.submit();assert.equal(f.calls.length,1);assert.equal(f.nodes.crmMessageText.readOnly,true);f.finish();await first;
 assert.equal(f.closed(),1);assert.equal(f.toasts[0],'Сообщение отправлено');assert.match(JSON.parse(f.calls[0][1].body).request_id,/^[0-9a-f-]{36}$/);
});
test('a lost response preserves the exact text and request ID for retry',async()=>{
 const f=fixture();f.fail(Error('lost response'));await f.api.submit();const first=JSON.parse(f.calls[0][1].body);f.nodes.crmMessageText.value='accidentally changed';await f.api.submit();
 const second=JSON.parse(f.calls[1][1].body);assert.equal(second.request_id,first.request_id);assert.equal(second.text,first.text);assert.equal(f.toasts.length,0);assert.equal(f.nodes.crmMessageText.readOnly,true);
 assert.match(f.nodes.crmMessageError.textContent,/Доставка не подтверждена/);
});
test('a definitive rejection permits editing and issues a fresh identity without false success',async()=>{
 const f=fixture();f.fail(Object.assign(Error('Rejected'),{code:'send_rejected',status:422}));await f.api.submit();const previous=JSON.parse(f.calls[0][1].body).request_id;
 assert.equal(f.nodes.crmMessageText.readOnly,false);assert.notEqual(f.nodes.crmMessageForm.dataset.requestId,previous);assert.equal(f.toasts.length,0);
});
test('refresh failure after an accepted message never offers a duplicate send',async()=>{
 const f=fixture();f.window.openClient=async()=>{throw Error('refresh failed')};const pending=f.api.submit();f.finish();await pending;assert.equal(f.calls.length,1);assert.equal(f.closed(),1);assert.match(f.toasts.at(-1),/Сообщение отправлено/);
});
test('replacing the form while a send is pending cannot close the new form',async()=>{
 const f=fixture();const pending=f.api.submit();f.nodes.crmMessageForm={dataset:{contact:'other'}};f.finish();await pending;assert.equal(f.closed(),0);
});
