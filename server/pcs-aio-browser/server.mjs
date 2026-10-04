import http from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {WebSocket,WebSocketServer} from 'ws';
import {mkdir,open,rename,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,join} from 'node:path';

// This process serves exactly one project/container. No shell, generic proxy,
// browser cookies or profile files are exposed through the PCS REST interface.
export function createGateway(env=process.env,transport=fetch){
 const project=env.PCS_PROJECT_ID,key=env.PCS_GATEWAY_KEY,aioKey=env.AIO_API_KEY;
 const origin=new URL(env.PUBLIC_ORIGIN),aio=new URL(env.AIO_ORIGIN);
 if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(project||'')||!key||key.length<32||!aioKey||aioKey.length<32||key===aioKey)throw Error('invalid_gateway_configuration');
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Error('invalid_public_origin');
 if(!['http:','https:'].includes(aio.protocol)||aio.username||aio.password||aio.pathname!=='/'||aio.search||aio.hash)throw Error('invalid_aio_origin');
 const sessions=new Map(),tokens=new Map(),sockets=new Map();
 const filesRoot=resolve(env.FILES_ROOT||'/home/gem/pcs/files');
 const equal=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)};
 const bearer=r=>equal(r.headers['x-bb-api-key'],key);
 const active=id=>{const s=sessions.get(id);return s&&s.until>Date.now()?s:null};
 const token=(id,purpose)=>{const t=randomBytes(32).toString('hex');tokens.set(t,{id,purpose});return t};
 const valid=(t,purpose)=>{const x=tokens.get(t);return x?.purpose===purpose&&active(x.id)?x:null};
 const cookie=r=>String(r.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('pcs_view='))?.slice(10);
 const json=(r,status,data)=>{r.writeHead(status,{'content-type':'application/json','cache-control':'no-store','referrer-policy':'no-referrer'});r.end(JSON.stringify(data))};
 const revoke=id=>{sessions.delete(id);for(const [t,x] of tokens)if(x.id===id)tokens.delete(t);for(const s of sockets.get(id)||[])s.close(1000);sockets.delete(id)};
 const cleanup=setInterval(()=>{for(const [id] of sessions)if(!active(id))revoke(id)},10000);cleanup.unref();
 async function upstream(path,method='GET',body){const r=await transport(new URL(path,aio),{method,headers:{'X-AIO-API-Key':aioKey,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('aio_unavailable');const j=await r.json();if(j.success===false||j.code&&j.code!==0&&j.code!==200)throw Error('aio_rejected');return j.data||j;}
 async function body(r){let s='';for await(const c of r){s+=c;if(Buffer.byteLength(s)>1100000)throw Error('body_too_large')}return s?JSON.parse(s):{}}
 const info=async()=>upstream('/v1/browser/info');
 const describe=s=>({id:s.id,status:'RUNNING',expiresAt:new Date(s.until).toISOString(),connectUrl:origin.origin.replace(/^https:/,'wss:')+'/cdp?token='+token(s.id,'cdp')});
 const server=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,origin);res.setHeader('referrer-policy','no-referrer');
   if(req.method==='GET'&&url.pathname==='/view'){
    const x=valid(url.searchParams.get('token'),'view');if(!x)return json(res,401,{error:'view_expired'});
    tokens.delete(url.searchParams.get('token'));const c=token(x.id,'cookie');
    res.writeHead(303,{'set-cookie':'pcs_view='+c+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age='+Math.floor((active(x.id).until-Date.now())/1000),'location':'/vnc/index.html?autoconnect=true&path=websockify','cache-control':'no-store'});return res.end();
   }
   if(req.method==='GET'&&url.pathname.startsWith('/vnc/')){
    if(!valid(cookie(req),'cookie'))return json(res,401,{error:'view_expired'});
    // Login view exposes only noVNC assets. The private AIO key stays server-side.
    const u=new URL(url.pathname+url.search,aio);u.searchParams.delete('api_key');
    const r=await transport(u,{headers:{'X-AIO-API-Key':aioKey},redirect:'error',signal:AbortSignal.timeout(20000)});
    res.writeHead(r.status,{'content-type':r.headers.get('content-type')||'application/octet-stream','cache-control':'no-store'});return res.end(Buffer.from(await r.arrayBuffer()));
   }
   if(!bearer(req))return json(res,401,{error:'unauthorized'});
   if(req.method==='GET'&&url.pathname==='/health'){await info();return json(res,200,{ok:true,provider:'AIO_SANDBOX',project_id:project})}
   if(req.method==='GET'&&url.pathname==='/v1/projects/'+project)return json(res,200,{id:project,provider:'AIO_SANDBOX'});
   if(req.method==='POST'&&['/v1/files/read','/v1/files/write'].includes(url.pathname)){
    const b=await body(req);if(b.projectId!==project)return json(res,403,{error:'wrong_project'});
    if(typeof b.name!=='string'||! /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$/.test(b.name))return json(res,400,{error:'invalid_file_name'});
    await mkdir(filesRoot,{recursive:true});const path=join(filesRoot,b.name);
    if(url.pathname.endsWith('/read')){const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const st=await f.stat();if(!st.isFile()||st.size>1000000)return json(res,413,{error:'file_too_large'});return json(res,200,{name:b.name,content:await f.readFile('utf8')})}finally{await f.close()}}
    if(typeof b.content!=='string'||Buffer.byteLength(b.content)>1000000)return json(res,413,{error:'file_too_large'});
    const temp=join(filesRoot,'.pcs-'+randomBytes(16).toString('hex'));let f;
    try{f=await open(temp,'wx',0o600);await f.writeFile(b.content,'utf8');await f.sync();await f.close();f=null;await rename(temp,path);return json(res,200,{name:b.name,written:true})}finally{if(f)await f.close();await unlink(temp).catch(()=>{})}
   }
   if(req.method==='POST'&&url.pathname==='/v1/contexts'){const b=await body(req);if(b.projectId!==project)return json(res,403,{error:'wrong_project'});return json(res,200,{id:project})}
   if(req.method==='POST'&&url.pathname==='/v1/sessions'){
    const b=await body(req);if(b.projectId!==project||b.browserSettings?.context?.id!==project)return json(res,403,{error:'wrong_project'});
    for(const [id] of sessions)if(!active(id))revoke(id);if(sessions.size)return json(res,409,{error:'session_open'});
    await info();const id=randomBytes(16).toString('hex'),s={id,until:Date.now()+900000};sessions.set(id,s);return json(res,200,describe(s));
   }
   const match=url.pathname.match(/^\/v1\/sessions\/([a-f0-9]{32})(\/debug)?$/);
   if(match){const s=active(match[1]);if(!s)return json(res,404,{error:'session_expired'});
    if(req.method==='GET'&&match[2])return json(res,200,{debuggerFullscreenUrl:origin.origin+'/view?token='+token(s.id,'view')});
    if(req.method==='GET')return json(res,200,describe(s));
    if(req.method==='POST'&&!match[2]){const b=await body(req);if(b.projectId!==project||b.status!=='REQUEST_RELEASE')return json(res,400,{error:'invalid_release'});revoke(s.id);return json(res,200,{id:s.id,status:'COMPLETED'})}
   }
   return json(res,404,{error:'not_found'});
  }catch{return json(res,502,{error:'gateway_request_failed'})}
 });
 const wss=new WebSocketServer({noServer:true,maxPayload:2*1024*1024});
 server.on('upgrade',async(req,socket,head)=>{
  try{
   const u=new URL(req.url,origin),isCdp=u.pathname==='/cdp';
   const x=isCdp?valid(u.searchParams.get('token'),'cdp'):['/websockify','/vnc/websockify'].includes(u.pathname)?valid(cookie(req),'cookie'):null;
   if(!x||!isCdp&&req.headers.origin!==origin.origin){socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');return}
   let path='/websockify';if(isCdp){const i=await info(),reported=new URL(i.cdp_url,aio);if(!reported.pathname.startsWith('/cdp')&&!reported.pathname.startsWith('/devtools/'))throw Error('unexpected_cdp_path');path=reported.pathname+reported.search}
   const target=new URL(path,aio);target.protocol=aio.protocol==='https:'?'wss:':'ws:';target.searchParams.delete('api_key');
   const remote=new WebSocket(target,{headers:{'X-AIO-API-Key':aioKey},maxPayload:2*1024*1024,handshakeTimeout:15000});
   const abort=()=>remote.close();socket.once('close',abort);
   remote.once('error',()=>{socket.destroy()});
   remote.once('open',()=>{
    if(!active(x.id)){remote.close();socket.destroy();return}
    wss.handleUpgrade(req,socket,head,local=>{const set=sockets.get(x.id)||new Set();set.add(local);set.add(remote);sockets.set(x.id,set);
     local.on('message',(data,binary)=>{if(remote.readyState===WebSocket.OPEN)remote.send(data,{binary})});remote.on('message',(data,binary)=>{if(local.readyState===WebSocket.OPEN)local.send(data,{binary})});
     const close=()=>{set.delete(local);set.delete(remote);local.close();remote.close()};local.on('close',close);remote.on('close',close);local.on('error',close);remote.on('error',close);
    });
   });
  }catch{socket.destroy()}
 });
 server.on('close',()=>{clearInterval(cleanup);for(const id of sessions.keys())revoke(id);wss.close()});
 return server;
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1])createGateway().listen(Number(process.env.PORT||8080),'0.0.0.0',()=>console.log('PCS AIO gateway listening'));
