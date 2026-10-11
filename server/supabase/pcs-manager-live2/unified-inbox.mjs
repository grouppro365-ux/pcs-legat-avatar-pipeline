import { CrmError } from './crm-policy.mjs';
import { uuid } from './portal-workflow.mjs';
export function inboxPage(value){if(!/^\d{1,4}$/.test(String(value))||Number(value)>1000)throw new CrmError('Некорректная страница',400);return Number(value);}
async function rest(base,key,path,fetcher=fetch){const r=await fetcher(base+'/rest/v1/'+path,{headers:{apikey:key,authorization:'Bearer '+key},signal:AbortSignal.timeout(12000)});if(!r.ok)throw new CrmError('Не удалось прочитать входящие канала',503);return r.json();}
export async function unifiedInbox(op,base,key,pageValue='0',fetcher=fetch){
 const page=inboxPage(pageValue),offset=page*50;
 // Two independently paged feeds, with a source-qualified identity. Never merge people by display name.
 const results=await Promise.allSettled([
  op.query('select c.id,c.name,c.username,c.need,c.last_contact_at,(select m.text from conversations v join messages m on m.conversation_id=v.id where v.contact_id=c.id order by coalesce(m.sent_at,m.created_at) desc,m.id desc limit 1) last_message from contacts c order by c.last_contact_at desc nulls last,c.id limit 51 offset $1',[offset]),
  rest(base,key,'pcs_contacts?select=id,name,username,need,last_contact_at,preferred_channel&order=last_contact_at.desc.nullslast,id&limit=51&offset='+offset,fetcher)
 ]);
 const rows=[],unavailable=[];let more=false;
 for(let i=0;i<2;i++){const r=results[i],source=i?'runtime':'operator';if(r.status!=='fulfilled'){unavailable.push(source);continue;}more ||=r.value.length>50;rows.push(...r.value.slice(0,50).map(x=>({...x,source,channel:x.preferred_channel||(source==='operator'?'telegram':'runtime')})));}
 rows.sort((a,b)=>(Date.parse(b.last_contact_at)||0)-(Date.parse(a.last_contact_at)||0)||a.id.localeCompare(b.id));
 return {page,rows,truncated:more,unavailable};
}
export async function runtimeConversation(base,key,id,fetcher=fetch){
 if(!uuid(id))throw new CrmError('Некорректный диалог',400);
 const contacts=await rest(base,key,'pcs_contacts?select=id,name,username,need,summary,telegram_id,telegram_chat_id,business_connection_id,preferred_channel&id=eq.'+id,fetcher);
 if(!contacts.length)throw new CrmError('Диалог не найден',404);
 const messages=await rest(base,key,'pcs_messages?select=id,direction,text,status,channel,created_at&contact_id=eq.'+id+'&order=created_at.desc,id.desc&limit=200',fetcher);
 return {source:'runtime',contact:contacts[0],messages:messages.reverse(),limit:200};
}
export async function intakeRuntime(biz,base,key,b,fetcher=fetch){
 if(!uuid(b.contact_id)||!uuid(b.request_id)||typeof b.need!=='string'||!b.need.trim()||b.need.length>4000)throw new CrmError('Проверьте заявку',400);
 const {contact}=await runtimeConversation(base,key,b.contact_id,fetcher);
 // Canonical profile uses the existing trusted Telegram identity provisioner.
 if(!contact.telegram_id)throw new CrmError('Для этого канала сначала свяжите контакт с профилем клиента',409);
 const profile=(await biz.query('select pcs.ensure_telegram_client_profile($1::uuid,$2,$3,$4) profile',[contact.id,String(contact.telegram_id),contact.username,contact.name]))[0].profile.id;
 const rows=await biz.query(`with added as (
  insert into applications(id,public_id,client_profile_id,client_name,client_contact,category,client_visible_notes,source_code,human_review_required,next_action_code)
  values($1,'APP-'||replace($1::text,'-',''),$2,$3,$4,'general',$5,'UNIFIED_INBOX',true,'QUALIFY_REQUEST')
  on conflict(id) do nothing returning id
 ) select id,public_id,client_profile_id,client_visible_notes from applications where id=$1 union all select id,'APP-'||replace(id::text,'-',''),$2::uuid,$5::text from added`,[b.request_id,profile,contact.name,String(contact.telegram_id),b.need.trim()]);
 const application=rows[0];if(!application||(application.client_profile_id!==profile||application.client_visible_notes!==b.need.trim()))throw new CrmError('Номер заявки уже используется',409);
 return {ok:true,application};
}
