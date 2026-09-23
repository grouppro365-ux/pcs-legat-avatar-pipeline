const ENTRY='https://pcs-ai-operator-live-grouppro365-2288s-projects.vercel.app/';
const BASE=Deno.env.get('SUPABASE_URL')||'';
const SERVICE_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const ORIGINS=new Set([
  'https://pcs-ai-operator-live.vercel.app',
  'https://pcs-ai-operator-live-grouppro365-2288s-projects.vercel.app',
  'https://pcs-ai-operator-grouppro365-2288s-projects.vercel.app'
]);

function headers(req:Request){const origin=req.headers.get('origin')||'';return {
  'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store',
  'vary':'Origin',
  ...(ORIGINS.has(origin)?{'access-control-allow-origin':origin}:{})
}}
function json(req:Request,body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:headers(req)})}
async function sha256(value:string){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function authorized(req:Request){const authorization=req.headers.get('authorization')||'';if(!/^Bearer\s+\S+$/i.test(authorization)||!BASE||!SERVICE_KEY)return false;
  const token=authorization.replace(/^Bearer\s+/i,'');
  const query=new URLSearchParams({token_hash:`eq.${await sha256(token)}`,expires_at:`gt.${new Date().toISOString()}`,select:'token_hash',limit:'1'});
  try{
    const session=await fetch(`${BASE}/rest/v1/pcs_sessions?${query}`,{headers:{apikey:SERVICE_KEY,authorization:`Bearer ${SERVICE_KEY}`}});
    if(session.ok&&(await session.json()).length)return true;
  }catch{}
  try{const session=await fetch(`${BASE}/functions/v1/pcs-manager-live2?op=session`,{headers:{authorization}});return session.ok}catch{return false}
}
async function botToken(){if(!BASE||!SERVICE_KEY)throw new Error('server_config_missing');const response=await fetch(`${BASE}/rest/v1/rpc/pcs_edge_runtime_config`,{method:'POST',headers:{apikey:SERVICE_KEY,authorization:`Bearer ${SERVICE_KEY}`,'content-type':'application/json'},body:'{}'});if(!response.ok)throw new Error('runtime_config_'+response.status);const config=await response.json();if(!config?.telegram_bot_token)throw new Error('telegram_token_missing');return String(config.telegram_bot_token)}
async function telegram(token:string,method:string,payload:unknown={}){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);try{const response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.description||`telegram_${response.status}`);return data.result}finally{clearTimeout(timer)}}

Deno.serve(async(req:Request)=>{
  if(req.method==='GET'||req.method==='HEAD')return new Response(null,{status:302,headers:{location:ENTRY,'cache-control':'no-store'}});
  const origin=req.headers.get('origin')||'';
  if(origin&&!ORIGINS.has(origin))return json(req,{error:'origin_not_allowed'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers(req),'access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'authorization,content-type'}});
  if(req.method!=='POST')return json(req,{error:'method_not_allowed'},405);
  if(!await authorized(req))return json(req,{error:'unauthorized'},401);
  try{
    const token=await botToken();
    const desired={type:'web_app',text:'Открыть PCS',web_app:{url:ENTRY}};
    await telegram(token,'setChatMenuButton',{menu_button:desired});
    const menu=await telegram(token,'getChatMenuButton');
    if(menu?.type!=='web_app'||menu?.web_app?.url!==ENTRY)throw new Error('menu_verification_failed');
    return json(req,{ok:true,entry:ENTRY,menu});
  }catch(error){return json(req,{error:error instanceof Error?error.message:String(error)},502)}
});
