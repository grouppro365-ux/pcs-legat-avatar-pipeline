import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareRequest,forwardRequest} from '../tgcloud/lib/legacy-api.js';
const ctx={initData:{user:{id:12345}}};
const request=()=>({service:'pcs-manager-live2',path:'',query:[['op','clients']],method:'GET',token:'unit-admin-session',body:null});
test('the server uses a fixed PCS host, verified Telegram context and the original admin session',()=>{
 const r=prepareRequest(request(),ctx);assert.equal(r.url,'https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-manager-live2?op=clients');assert.equal(r.options.headers.authorization,'Bearer unit-admin-session');
 assert.throws(()=>prepareRequest(request(),{}),/telegram_user_required/);
 assert.throws(()=>prepareRequest({...request(),token:''},ctx),/admin_session_required/);
 for(const user of [{id:'123'},{id:-1},{id:123,is_bot:true}])assert.throws(()=>prepareRequest(request(),{initData:{user}}),/telegram_user_required/);
});
test('arbitrary hosts, secret endpoints, worker operations, traversal and header injection cannot be relayed',()=>{
 for(const patch of [{service:'https://evil.invalid'},{service:'pcs-tg-gateway'},{service:'pcs-secret-get'},{path:'/../secret'},{path:'/a%2fb'},{token:'bad\r\nX:1'},{query:[['op','login']]},{query:[['op','prospecting-worker']]},{url:'https://evil.invalid'},{method:'CONNECT'},{query:{op:'clients'}}])assert.throws(()=>prepareRequest({...request(),...patch},ctx));
});
test('invalid and oversized bodies fail before any upstream call',async()=>{
 const fetch=()=>assert.fail('invalid request reached upstream');
 for(const body of ['not JSON','x'.repeat(1000001),{}])await assert.rejects(()=>forwardRequest({...request(),method:'POST',body},ctx,fetch));
 await assert.rejects(()=>forwardRequest({...request(),body:'{}'},ctx,fetch),/invalid_body/);
});
test('mutation is forwarded once; status/body, including authorization failures, are preserved',async()=>{
 let calls=0;const body=JSON.stringify({id:'id',expected_version:'version'});
 const result=await forwardRequest({...request(),method:'POST',query:[['op','task-update']],body},ctx,async(url,options)=>{calls++;assert.equal(options.body,body);return new Response('{"error":"stale"}',{status:409,headers:{'content-type':'application/json'}})});
 assert.equal(calls,1);assert.equal(result.status,409);assert.equal(result.body,'{"error":"stale"}');
 const denied=await forwardRequest(request(),ctx,async()=>new Response('{"error":"login"}',{status:401}));assert.equal(denied.status,401);
});
test('unknown upstream results never trigger an automatic retry',async()=>{
 let calls=0;await assert.rejects(()=>forwardRequest({...request(),method:'POST',body:'{}'},ctx,async()=>{calls++;throw Error('timeout after commit')}),/timeout after commit/);assert.equal(calls,1);
});
