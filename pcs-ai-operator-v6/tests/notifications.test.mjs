import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function fixture(){
 const nodes={},calls=[],node=()=>({innerHTML:'',textContent:'',disabled:false});
 const window={openSheet:(title,html)=>{for(const match of html.matchAll(/id="([^"]+)"/g))nodes[match[1]]=node()},call:url=>new Promise((resolve,reject)=>calls.push({url,resolve,reject})),opsCall:url=>new Promise((resolve,reject)=>calls.push({url,resolve,reject}))};
 const document={getElementById:id=>nodes[id]};vm.runInNewContext(readFileSync(new URL('../notifications.js',import.meta.url),'utf8'),{window,document,URLSearchParams,Date});return{window,nodes,calls};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('events escape text, paginate and do not silently acknowledge or send anything',async()=>{
 const h=fixture(),p=h.window.pcsNotifications.open();assert.equal(h.calls[0].url,'/notifications?view=unread&page=0');h.calls[0].resolve({view:'unread',rows:[{title:'<script>bad</script>',body:'<img>',status:'pending'}],truncated:true});await p;
 assert.doesNotMatch(h.nodes.pcsNotificationList.innerHTML,/<script>|<img>/);assert.equal(h.nodes.pcsNotificationNext.disabled,false);assert.equal(h.calls.length,1);
});
test('old event responses cannot replace a reopened sheet and read failures stay visible',async()=>{
 const h=fixture();h.window.pcsNotifications.open();const p=h.window.pcsNotifications.open();h.calls[1].reject(Error('events unavailable'));await p;h.calls[0].resolve({view:'unread',rows:[{title:'stale'}]});await tick();assert.equal(h.nodes.pcsNotificationList.textContent,'events unavailable');assert.doesNotMatch(h.nodes.pcsNotificationList.innerHTML,/stale/);
});
test('application detail uses exact identity and ignores a previous detail response',async()=>{
 const h=fixture(),first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';const p=h.window.pcsOpenOperationalApplication(first),q=h.window.pcsOpenOperationalApplication(second);
 h.calls[1].resolve({application:{id:second,public_id:'<APP>',human_review_reason:'<img>'}});await q;h.calls[0].resolve({application:{id:first,public_id:'old'}});await p;assert.match(h.nodes.pcsOperationalApplication.innerHTML,/&lt;APP&gt;/);assert.doesNotMatch(h.nodes.pcsOperationalApplication.innerHTML,/old|<img>/);
});
