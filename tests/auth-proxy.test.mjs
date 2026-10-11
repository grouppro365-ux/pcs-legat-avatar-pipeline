import test from 'node:test';import assert from 'node:assert/strict';import proxy from '../api/pcs-auth.js';
const origin='https://pcs-ai-operator-live.vercel.app';
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(b){this.body=b;return this},send(b){this.body=b;return this}};}
test('proxy forwards auth cookies while dropping platform hostname headers',async()=>{
 const handler=proxy.createAuthProxy(async(url,init)=>{assert.match(url,/neonauth.*\/auth\/get-session/);assert.equal(init.headers.cookie,'session=qa');assert.equal(init.headers['x-forwarded-host'],undefined);assert.equal(init.headers.host,undefined);return new Response('null',{headers:{'content-type':'application/json','set-cookie':'session=qa; Domain=auth.example; Path=/neondb/auth; HttpOnly; Secure; SameSite=Lax'}})});
 const r=response();await handler({method:'GET',query:{auth_path:'get-session'},url:'/api/pcs-auth/get-session',headers:{cookie:'session=qa',host:'wrong','x-forwarded-host':'wrong'}},r);
 assert.equal(r.code,200);assert.equal(r.body,'null');assert.match(r.headers['Set-Cookie'][0],/Path=\//);assert.doesNotMatch(r.headers['Set-Cookie'][0],/Domain=/);assert.match(r.headers['Set-Cookie'][0],/HttpOnly/);
});
test('only supported methods and same-origin mutations can reach the provider',async()=>{
 const handler=proxy.createAuthProxy(()=>assert.fail('unexpected provider call'));
 for(const [path,method,headers,code] of [['admin/list-users','GET',{},404],['sign-in/email','POST',{},403],['sign-up/email','POST',{origin:'https://attacker.example'},403],['token','POST',{origin},404]]){
  const r=response();await handler({method,query:{auth_path:path},url:'/api/pcs-auth/'+path,headers,body:{}},r);assert.equal(r.code,code);
 }
});
