import { createClient } from 'jsr:@supabase/supabase-js@2';
import {knowledgeInput,KnowledgeError} from './knowledge-policy.mjs';
const BASE=Deno.env.get('SUPABASE_URL')!;
const KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const sb=createClient(BASE,KEY,{auth:{persistSession:false}});
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, content-type','Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS','Access-Control-Max-Age':'86400'};
const json=(d:any,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...cors,'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-pcs-kb':'v26'}});
const sha=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
async function admin(req:Request){
  const auth=req.headers.get('authorization')||'';
  const token=auth.replace(/^Bearer\s+/i,'');
  if(!token)return false;
  // Current PCS Mini App session first.
  try{
    const r=await fetch(BASE+'/functions/v1/pcs-manager-live2?op=session',{headers:{authorization:'Bearer '+token,accept:'application/json'}});
    if(r.ok)return true;
  }catch{}
  // Legacy PCS session fallback.
  try{
    const h=await sha(token);
    const {data}=await sb.from('pcs_sessions').select('token_hash').eq('token_hash',h).gt('expires_at',new Date().toISOString()).maybeSingle();
    return !!data;
  }catch{return false}
}
function parts(req:Request){const a=new URL(req.url).pathname.split('/').filter(Boolean),i=a.indexOf('pcs-kb');return i>=0?a.slice(i+1):[]}
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(!(await admin(req)))return json({error:'Требуется вход администратора'},401);
  try{
    const r=parts(req);
    if(r.length===2&&r[1]==='media'&&req.method==='DELETE'){
      if(!/^[0-9a-f-]{36}$/i.test(r[0]))return json({error:'Некорректный идентификатор'},400);
      const {data:row,error}=await sb.from('pcs_knowledge_items').select('id,media,revision').eq('id',r[0]).maybeSingle();
      if(error)throw error;if(!row)return json({error:'Запись не найдена'},404);
      const photos=row.media||[],b=await req.json(),ids=b.ids;
      if(!Array.isArray(ids)||!ids.length||ids.length>30||new Set(ids).size!==ids.length||ids.some(id=>!photos.some(photo=>photo.id===id)))return json({error:'Фото не принадлежит выбранной записи'},400);
      const saved=await sb.from('pcs_knowledge_items').update({media:photos.filter(photo=>!ids.includes(photo.id)),revision:row.revision+1,updated_at:new Date().toISOString()}).eq('id',r[0]).eq('revision',row.revision).select('id').maybeSingle();
      if(saved.error||!saved.data)return json({error:'Запись изменилась. Обновите фото и повторите.'},409);
      const removed=await sb.storage.from('pcs-knowledge-media').remove(photos.filter(photo=>ids.includes(photo.id)).map(photo=>photo.storage_key));
      return json({ok:true,ids,warning:removed.error?'Файлы скрыты из записи; очистка хранилища не завершена':undefined});
    }
    if(r.length===2&&r[1]==='media'&&req.method==='POST'){
      if(!/^[0-9a-f-]{36}$/i.test(r[0]))return json({error:'Некорректный идентификатор'},400);
      const {data:row,error}=await sb.from('pcs_knowledge_items').select('id,media,revision').eq('id',r[0]).maybeSingle();
      if(error)throw error;if(!row)return json({error:'Запись не найдена'},404);
      const photos=row.media||[];if(photos.length>=30)return json({error:'Лимит 30 фото'},400);
      const b=await req.json(),extensions={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
      const extension=extensions[b.content_type];
      if(!extension||typeof b.content_base64!=='string')return json({error:'Нужен JPG, PNG или WEBP'},400);
      const encoded=b.content_base64.replace(/^data:image\/(jpeg|png|webp);base64,/, '');
      if(encoded.length>13981016)return json({error:'Фото больше 10 МБ'},400);
      let bytes;try{bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))}catch{return json({error:'Некорректный файл'},400)}
      const valid=b.content_type==='image/png'?bytes.slice(0,8).join(',')==='137,80,78,71,13,10,26,10':b.content_type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes[0]===82&&bytes[1]===73&&bytes[2]===70&&bytes[3]===70&&bytes[8]===87&&bytes[9]===69&&bytes[10]===66&&bytes[11]===80;
      if(!valid||bytes.length>10485760)return json({error:'Содержимое не соответствует формату фото'},400);
      const photo={id:crypto.randomUUID(),filename:String(b.filename||'photo').slice(0,200),storage_key:''};
      photo.storage_key=r[0]+'/'+photo.id+'.'+extension;
      const bucket=sb.storage.from('pcs-knowledge-media');
      const uploaded=await bucket.upload(photo.storage_key,bytes,{contentType:b.content_type,upsert:false});
      if(uploaded.error)throw uploaded.error;
      const saved=await sb.from('pcs_knowledge_items').update({media:[...photos,photo],revision:row.revision+1,updated_at:new Date().toISOString()}).eq('id',r[0]).eq('revision',row.revision).select('id').maybeSingle();
      if(saved.error||!saved.data){await bucket.remove([photo.storage_key]);return json({error:'Запись изменилась. Обновите фото и повторите.'},409)}
      return json({id:photo.id,filename:photo.filename},201);
    }
    if(r.length===2&&r[1]==='media'&&req.method==='GET'){
      if(!/^[0-9a-f-]{36}$/i.test(r[0]))return json({error:'Некорректный идентификатор'},400);
      const {data:row,error}=await sb.from('pcs_knowledge_items').select('id,media,revision').eq('id',r[0]).maybeSingle();
      if(error)throw error;if(!row)return json({error:'Запись не найдена'},404);
      const photos=await Promise.all((row.media||[]).map(async photo=>{
        const signed=await sb.storage.from('pcs-knowledge-media').createSignedUrl(photo.storage_key,3600);
        if(signed.error)throw signed.error;
        return {id:photo.id,filename:photo.filename,url:signed.data.signedUrl};
      }));
      return json(photos);
    }
    if(req.method==='GET'&&r.length===1&&r[0]==='list'){
      const u=new URL(req.url),page=u.searchParams.get('page')||'0',q=(u.searchParams.get('q')||'').trim(),view=u.searchParams.get('view')||'all';
      if(!/^\d{1,5}$/.test(page)||Number(page)>5000||q.length>120||!['all','active','draft','outdated','disabled','expired','customer_safe','approval_only','internal_only'].includes(view))return json({error:'Некорректный фильтр базы знаний'},400);
      const {data,error}=await sb.rpc('pcs_knowledge_list_v1',{p_page:Number(page),p_query:q,p_view:view});if(error)throw error;return json(data);
    }
    if(req.method==='GET'&&r.length===1&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r[0])){
      const {data,error}=await sb.rpc('pcs_knowledge_list_v1',{p_id:r[0]});if(error)throw error;return data?.rows?.[0]?json(data.rows[0]):json({error:'Запись не найдена'},404);
    }
    if(req.method==='GET'&&r.length===0){
      const {data,error}=await sb.from('pcs_knowledge_items').select('*').order('updated_at',{ascending:false});
      if(error)throw error;return json(data||[]);
    }
    if(req.method==='DELETE'&&r.length===1){
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r[0]))return json({error:'Некорректный идентификатор'},400);
      const {data,error}=await sb.from('pcs_knowledge_items').delete().eq('id',r[0]).select('id').maybeSingle();
      if(error)throw error;
      if(!data)return json({error:'Запись уже удалена или не найдена'},404);
      return json({ok:true,id:data.id});
    }
    if((req.method==='POST'&&r.length===0)||(req.method==='PATCH'&&r.length===1)){
      const create=req.method==='POST';if(!create&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r[0]))return json({error:'Некорректный идентификатор'},400);
      const raw=await req.text();if(new TextEncoder().encode(raw).byteLength>65536)return json({error:'Запись слишком большая'},413);let b;try{b=JSON.parse(raw)}catch{return json({error:'Некорректный запрос'},400)}
      const input=knowledgeInput(b,create),{data,error}=await sb.rpc('pcs_knowledge_save_v1',{p_id:create?input.id:r[0],p_expected_revision:input.expected_revision,p_record:input.record});
      if(error?.code==='40001'||error?.code==='23505')return json({error:'Запись изменилась. Черновик сохранён в форме; откройте актуальную запись перед повторным сохранением.'},409);
      if(error?.code==='P0002')return json({error:'Запись не найдена'},404);if(error)throw error;return json(data,create?201:200);
    }
    return json({error:'Маршрут не найден'},404);
  }catch(e){if(e instanceof KnowledgeError)return json({error:e.message},e.status);console.error('pcs-kb',{name:e instanceof Error?e.name:'Error'});return json({error:'Не удалось выполнить действие с базой знаний. Повторите позже.'},500)}
});
