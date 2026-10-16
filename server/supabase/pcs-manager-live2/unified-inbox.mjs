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
async function runtimeContact(base,key,id,fetcher=fetch){
 if(!uuid(id))throw new CrmError('Некорректный диалог',400);
 const contacts=await rest(base,key,'pcs_contacts?select=id,name,username,need,summary,telegram_id,telegram_chat_id,business_connection_id,preferred_channel&id=eq.'+id,fetcher);
 if(!contacts.length)throw new CrmError('Диалог не найден',404);
 return contacts[0];
}
export async function runtimeConversation(base,key,id,fetcher=fetch){
 const contact=await runtimeContact(base,key,id,fetcher);
 const messages=await rest(base,key,'pcs_messages?select=id,direction,text,status,channel,created_at&contact_id=eq.'+id+'&order=created_at.desc,id.desc&limit=200',fetcher);
 return {source:'runtime',contact,messages:messages.reverse(),limit:200};
}
export async function intakeRuntime(biz,base,key,b,fetcher=fetch,actor='pcs-manager-admin'){
 if(!b||Array.isArray(b)||Object.keys(b).some(k=>!['contact_id','request_id','need'].includes(k))||!uuid(b.contact_id)||!uuid(b.request_id)||typeof b.need!=='string'||!b.need.trim()||b.need.length>4000)throw new CrmError('Проверьте заявку',400);
 const contact=await runtimeContact(base,key,b.contact_id,fetcher);
 let channel='telegram',message=null;
 if(!contact.telegram_id){
  // Use persisted ingress, not a caller supplied channel, mutable phone or name.
  const received=await rest(base,key,'pcs_messages?select=id,channel,raw&contact_id=eq.'+contact.id+'&direction=eq.in&status=eq.received&channel=in.(whatsapp,instagram,facebook)&order=created_at.desc,id.desc&limit=1',fetcher);
  const inbound=received[0];
  if(!inbound||!uuid(inbound.id)||!['whatsapp','instagram','facebook'].includes(inbound.channel)||inbound.raw?.source!=='pcs-meta-webhook-v1')throw new CrmError('Не найдено подтверждённое входящее сообщение поддерживаемого канала. Связь клиента требует проверки.',409);
  channel=inbound.channel;message=inbound.id;
 }
 try{
  const rows=await biz.query('select pcs.runtime_intake($1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7,$8,$9) application',[contact.id,b.request_id,channel,message,contact.telegram_id?String(contact.telegram_id):null,contact.username||null,contact.name||null,b.need.trim(),actor]);
  if(!rows[0]?.application)throw new CrmError('Не удалось создать заявку',503);
  return {ok:true,application:rows[0].application};
 }catch(e){
  if(e instanceof CrmError)throw e;
  if(/runtime_intake_|client_identity_|client_profile_not_available/.test(String(e?.message||'')))throw new CrmError(e.code==='42501'?'Профиль клиента недоступен. Требуется проверка связи.':'Идентификатор заявки или связь клиента уже изменены. Обновите диалог.',e.code==='22023'?400:409);
  throw e;
 }
}
