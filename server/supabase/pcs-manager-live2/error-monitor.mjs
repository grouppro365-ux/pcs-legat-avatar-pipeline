import {CrmError} from './crm-policy.mjs';
export const safeError=value=>String(value??'').replace(/postgres(?:ql)?:\/\/[^\s"']+/gi,'[скрыто подключение]').replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi,'$1[скрыто]').replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|\d{6,}:[A-Za-z0-9_-]{20,})\b/g,'[скрыто ключ]').slice(0,1000);
export async function readErrorMonitor(op,base,key,source,rawPage,transport=fetch){
 if(!['runtime','delivery'].includes(source)||!/^\d{1,5}$/.test(rawPage)||Number(rawPage)>5000)throw new CrmError('Некорректный фильтр очереди',400);
 const page=Number(rawPage),offset=page*200;let rows;
 if(source==='runtime'){
  const url=new URL(base+'/rest/v1/pcs_failed_jobs');url.searchParams.set('select','id,operation,error,attempts,status,next_retry_at,last_attempt_at,retried_at,resolved_at,created_at');url.searchParams.set('order','created_at.desc,id.desc');url.searchParams.set('offset',String(offset));url.searchParams.set('limit','201');
  const r=await transport(url.toString(),{headers:{apikey:key,authorization:'Bearer '+key}});
  if(!r.ok)throw new CrmError('Не удалось прочитать очередь обработки событий',503);
  rows=await r.json();if(!Array.isArray(rows))throw new CrmError('Некорректный ответ очереди',503);
  rows=rows.map(x=>({...x,error:safeError(x.error)}));
 }else{
  rows=await op.query(`select m.id,m.status,m.created_at,m.updated_at::text edit_version,cv.contact_id,c.name contact_name,
   case when m.raw ? 'approval_send' then 'ai_approval' else 'crm_manual' end operation
   from messages m join conversations cv on cv.id=m.conversation_id join contacts c on c.id=cv.contact_id
   where m.status='PROCESSING'::"MessageStatus" and (m.raw->'manual_send'->>'stage'='sending' or m.raw->'approval_send'->>'stage'='sending')
   order by m.created_at desc,m.id desc limit 201 offset $1`,[offset]);
 }
 return{source,page,limit:200,truncated:rows.length>200,rows:rows.slice(0,200)};
}
