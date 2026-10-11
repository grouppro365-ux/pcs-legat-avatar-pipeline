const AUTH='https://ep-small-cell-av1ecg0k.neonauth.c-11.us-east-1.aws.neon.tech/neondb/auth';
const ORIGIN='https://pcs-ai-operator-live.vercel.app';
const routes=new Map([['get-session','GET'],['token','GET'],['sign-in/email','POST'],['sign-up/email','POST'],['sign-out','POST']]);
function createAuthProxy(fetcher=fetch){return async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 const parts=req.query?.path,path=Array.isArray(parts)?parts.join('/'):String(parts||'');
 if(!routes.has(path)||req.method!==routes.get(path))return res.status(404).json({error:'Auth operation unavailable'});
 const origin=req.headers.origin;
 if(origin&&origin!==ORIGIN||req.method==='POST'&&origin!==ORIGIN)return res.status(403).json({error:'Invalid origin'});
 let body;
 if(req.method==='POST'){
  try{body=typeof req.body==='string'?req.body:JSON.stringify(req.body||{});}catch{return res.status(400).json({error:'Invalid request'});}
  if(Buffer.byteLength(body)>8192)return res.status(413).json({error:'Request too large'});
 }
 // Never forward Vercel's Host/X-Forwarded-* to Neon's hostname router.
 const headers={accept:'application/json',origin:ORIGIN};
 for(const key of ['cookie','user-agent','authorization'])if(typeof req.headers[key]==='string')headers[key]=req.headers[key];
 if(body!==undefined)headers['content-type']='application/json';
 try{
  const query=new URL(req.url,ORIGIN).search;
  const upstream=await fetcher(AUTH+'/'+path+query,{method:req.method,headers,body,redirect:'manual',signal:AbortSignal.timeout(20000)});
  const cookies=upstream.headers.getSetCookie();
  if(cookies.length)res.setHeader('Set-Cookie',cookies.map(cookie=>cookie.replace(/;\s*Domain=[^;]+/ig,'').replace(/;\s*Path=[^;]+/ig,'; Path=/')));
  res.setHeader('Content-Type',upstream.headers.get('content-type')||'application/json');
  return res.status(upstream.status).send(await upstream.text());
 }catch{return res.status(503).json({error:'Auth temporarily unavailable'});}
};}
module.exports=createAuthProxy();
module.exports.createAuthProxy=createAuthProxy;
