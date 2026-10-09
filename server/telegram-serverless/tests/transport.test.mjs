import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../scripts/telegram-transport.js',import.meta.url),'utf8');
const url='https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-manager-live2?op=clients';
function fixture(host='app123.tgcloud.ai'){
 const native=[],rpc=[];const window={fetch:async(...args)=>{native.push(args);return new Response('{}')},Telegram:{WebApp:{Serverless:{call:(...args)=>rpc.push(args)}}}};
 vm.runInNewContext(source,{window,location:{hostname:host,href:'https://'+host+'/'},URL,Headers,Request,Response,Set});return {window,native,rpc};
}
test('hosted Mini App uses native RPC and reconstructs its original HTTP response',async()=>{
 const h=fixture(),pending=h.window.fetch(url,{headers:{authorization:'Bearer unit-admin'},method:'GET'});
 assert.equal(h.rpc.length,1);assert.equal(h.native.length,0);assert.equal(h.rpc[0][0],'pcsApi');assert.equal(h.rpc[0][1].token,'unit-admin');assert.equal(h.rpc[0][1].service,'pcs-manager-live2');
 h.rpc[0][2](null,{status:409,body:'{"error":"changed"}',content_type:'application/json'});
 const r=await pending;assert.equal(r.status,409);assert.deepEqual(await r.json(),{error:'changed'});
});
test('uncertain mutation result is not retried through the old HTTP path',async()=>{
 const h=fixture(),pending=h.window.fetch(url,{headers:{authorization:'Bearer unit-admin'},method:'POST',body:'{}'});
 h.rpc[0][2](Error('unknown result'));await assert.rejects(()=>pending,/unknown result/);assert.equal(h.native.length,0);assert.equal(h.rpc.length,1);
});
test('existing hosting, login, large uploads, Request objects and unrelated services keep their current transport',async()=>{
 const other=fixture('pcs-ai-operator-live.vercel.app');await other.window.fetch(url);assert.equal(other.native.length,1);assert.equal(other.rpc.length,0);
 const h=fixture(),headers={authorization:'Bearer unit-admin'};
 for(const [target,init] of [[url.replace('clients','login'),{headers,method:'POST',body:'{}'}],[url,{headers,method:'POST',body:'x'.repeat(1000001)}],[new Request(url,{headers}),{}],['https://example.invalid/',{headers}],['https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-unknown',{headers}]])await h.window.fetch(target,init);
 assert.equal(h.native.length,5);assert.equal(h.rpc.length,0);
});
test('missing SDK and malformed receipts fail visibly without another write',async()=>{
 const h=fixture();delete h.window.Telegram.WebApp.Serverless;await assert.rejects(()=>h.window.fetch(url,{headers:{authorization:'Bearer unit-admin'}}),/Обновите Telegram/);assert.equal(h.native.length,0);
 const g=fixture(),p=g.window.fetch(url,{headers:{authorization:'Bearer unit-admin'}});g.rpc[0][2](null,{status:200,body:{ok:true},content_type:'application/json'});await assert.rejects(()=>p,/Ответ PCS/);assert.equal(g.native.length,0);
});
