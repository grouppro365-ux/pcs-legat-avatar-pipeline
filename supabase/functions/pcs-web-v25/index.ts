import { createClient } from 'jsr:@supabase/supabase-js@2';
import { acquisition } from './acquisition.ts';
const TARGET='https://pcs-ai-operator-live-grouppro365-2288s-projects.vercel.app/?tg=login-fix-20260826-1746';
const sb=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
async function secret(n:string){if(n!=='navi_pcs_bridge_key')throw Error('Unsupported credential');const {data,error}=await sb.rpc('pcs_secret_get',{p_name:n});if(error)throw error;return String(data||'')}
function reply(_r:Request,d:any,status=200){return Response.json(d,{status,headers:{'cache-control':'no-store'}})}
Deno.serve(async r=>{
 const path=(new URL(r.url).pathname.split('/pcs-web-v25')[1]||'').split('/').filter(Boolean);
 if(path[0]==='navi')return await acquisition(r,path,sb,secret,reply)||reply(r,{error:'Действие недоступно.'},404);
 return new Response(null,{status:302,headers:{location:TARGET,'cache-control':'no-store, no-cache, must-revalidate, max-age=0','pragma':'no-cache'}});
});
