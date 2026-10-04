import assert from 'node:assert/strict';
import {mkdtemp,rm,symlink,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createGateway} from './server.mjs';
const project='eca81e59-97e3-49c1-a573-87343e4135fd';
const root=await mkdtemp(join(tmpdir(),'pcs-gateway-'));
const env={FILES_ROOT:root,PCS_PROJECT_ID:project,PCS_GATEWAY_KEY:'n'.repeat(64),AIO_API_KEY:'a'.repeat(64),PUBLIC_ORIGIN:'https://browser.example.com',AIO_ORIGIN:'http://sandbox:8080'};
const upstream=[];const server=createGateway(env,async(u,o)=>{upstream.push({url:String(u),options:o});return Response.json({data:{cdp_url:'ws://sandbox:8080/cdp'}})});
server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
async function api(path,b,auth=true){const r=await fetch(base+path,{method:b?'POST':'GET',headers:{...(auth?{'X-BB-API-Key':env.PCS_GATEWAY_KEY}:{}),'content-type':'application/json'},...(b?{body:JSON.stringify(b)}:{})});return {...await r.json(),httpStatus:r.status}}
try{
 assert.equal((await api('/health',undefined,false)).httpStatus,401);assert.equal(upstream.length,0);
 assert.equal((await api('/v1/projects/'+project)).id,project);
 assert.equal((await api('/v1/contexts',{projectId:'another'})).httpStatus,403);
 assert.equal((await api('/v1/sessions',{projectId:project,browserSettings:{context:{id:'another'}}})).httpStatus,403);
 const s=await api('/v1/sessions',{projectId:project,browserSettings:{context:{id:project}}});assert.equal(s.httpStatus,200);assert(s.connectUrl.startsWith('wss://browser.example.com/cdp?token='));
 assert.equal((await api('/v1/sessions',{projectId:project,browserSettings:{context:{id:project}}})).httpStatus,409);
 const d=await api('/v1/sessions/'+s.id+'/debug');const view=d.debuggerFullscreenUrl.replace(env.PUBLIC_ORIGIN,base);
 const r=await fetch(view,{redirect:'manual'});assert.equal(r.status,303);assert(r.headers.get('set-cookie').includes('HttpOnly; Secure; SameSite=Strict'));
 assert.equal((await fetch(view,{redirect:'manual'})).status,401);
 assert.equal((await fetch(base+'/vnc/index.html')).status,401);
 assert.equal((await api('/v1/files/write',{projectId:'another',name:'note.txt',content:'private'})).httpStatus,403);
 assert.equal((await api('/v1/files/write',{projectId:project,name:'../profile/Cookies',content:'private'})).httpStatus,400);
 assert.equal((await api('/v1/files/write',{projectId:project,name:'note.txt',content:'isolated'})).written,true);
 assert.equal((await api('/v1/files/read',{projectId:project,name:'note.txt'})).content,'isolated');
 await symlink('/etc/passwd',join(root,'link.txt'));
 assert.equal((await api('/v1/files/read',{projectId:project,name:'link.txt'})).httpStatus,502);
 await api('/v1/files/write',{projectId:project,name:'link.txt',content:'safe replacement'});
 assert.equal(await readFile(join(root,'link.txt'),'utf8'),'safe replacement');
 assert.equal((await api('/v1/file/read',{file:'/etc/passwd'})).httpStatus,404);
 assert.equal((await api('/v1/sessions/'+s.id,{projectId:project,status:'REQUEST_RELEASE'})).httpStatus,200);
 assert.equal((await api('/v1/sessions/'+s.id)).httpStatus,404);
 assert(!JSON.stringify(s).includes(env.AIO_API_KEY));assert(!JSON.stringify(d).includes(env.PCS_GATEWAY_KEY));
 assert(upstream.every(x=>x.url.startsWith(env.AIO_ORIGIN)&&x.options.headers['X-AIO-API-Key']===env.AIO_API_KEY));
 console.log('PASS: one-project gateway, private upstream authentication, session lock/revocation, one-use manual login link, HttpOnly view cookie, no generic file/shell proxy');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true})}
