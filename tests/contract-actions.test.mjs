import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function fixture(prefix='contract:'){
 const attrs={},button={dataset:{contractAction:prefix+'aaaa'},disabled:false,textContent:'Начать',isConnected:true,setAttribute:(k,v)=>{attrs[k]=v},removeAttribute:k=>{delete attrs[k]}};
 const calls=[],toasts=[],edits=[];let finish;
 const context={localStorage:{pcsToken:'qa'},document:{querySelectorAll:()=>[button]},esc:s=>String(s),toast:s=>toasts.push(s),openSheet:()=>{},$:()=>({value:'Test',files:[{name:'scan.pdf',type:'application/pdf',size:1000}]}),FileReader:class{readAsDataURL(){this.result='data:application/pdf;base64,JVBERi0=';this.onload()}},fetch:async(url,options)=>{
  calls.push({url,options});return new Promise(resolve=>{finish=(ok=true,error='contract_version_locked')=>resolve({ok,status:ok?200:409,json:async()=>ok?{id:'aaaa',reservation_id:'bbbb',missing_fields:[]}:{error}})})
 }};
 context.window=context;
 vm.runInNewContext(readFileSync(new URL('../pcs-ai-operator-v6/contracts.js',import.meta.url),'utf8'),context);
 context.editContract=async id=>edits.push(id);context.contractCenter=async()=>{};context.downloadContractPdf=async()=>{};
 return{api:context,button,attrs,calls,toasts,edits,finish:(...args)=>finish(...args)};
}
test('repeated new-version taps send one request and expose a busy button',async()=>{
 const f=fixture('reservation:');const pending=f.api.generateContract('aaaa');await f.api.generateContract('aaaa');
 assert.equal(f.calls.length,1);assert.equal(f.button.disabled,true);assert.equal(f.attrs['aria-busy'],'true');assert.equal(f.button.textContent,'Создаю…');
 f.finish();await pending;assert.deepEqual(f.edits,['aaaa']);assert.equal(f.button.disabled,false);assert.equal(f.button.textContent,'Начать');assert.equal(f.attrs['aria-busy'],undefined);
});
test('saving and finalizing the same contract cannot race within one session',async()=>{
 const f=fixture();const pending=f.api.saveContract('aaaa');await f.api.finalizeContract('aaaa');assert.equal(f.calls.length,1);
 f.finish();await pending;const finalize=f.api.finalizeContract('aaaa');assert.equal(f.calls.length,2);f.finish();await finalize;
});
test('a failed request restores controls and allows retry with a friendly error',async()=>{
 const f=fixture('reservation:');const pending=f.api.generateContract('aaaa');f.finish(false,'booking_cancelled');await pending;
 assert.match(f.toasts.at(-1),/Бронь отменена/);assert.equal(f.button.disabled,false);
 const retry=f.api.generateContract('aaaa');assert.equal(f.calls.length,2);f.finish();await retry;
});
test('signed scan upload is guarded against a repeated tap',async()=>{
 const f=fixture();const pending=f.api.uploadSignedCopy('aaaa');await Promise.resolve();await Promise.resolve();await f.api.uploadSignedCopy('aaaa');
 assert.equal(f.calls.length,1);f.finish(false,'signed_copy_already_exists');await pending;assert.match(f.toasts.at(-1),/уже прикреплён/);assert.equal(f.button.disabled,false);
});
test('completion does not rewrite detached controls and retains originally disabled state',async()=>{
 const f=fixture('reservation:');f.button.disabled=true;const pending=f.api.generateContract('aaaa');f.finish();await pending;assert.equal(f.button.disabled,true);
 const next=f.api.generateContract('aaaa');f.button.isConnected=false;f.finish();await next;assert.equal(f.button.textContent,'Создаю…');
});
