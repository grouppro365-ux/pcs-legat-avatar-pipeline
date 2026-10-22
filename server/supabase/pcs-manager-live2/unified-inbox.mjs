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
 const contacts=await rest(base,key,'pcs_contacts?select=id,name,username,need,summary,telegram_id,telegram_chat_id,business_connection_id,preferred_channel,line_contact&id=eq.'+id,fetcher);
 if(!contacts.length)throw new CrmError('Диалог не найден',404);
 return contacts[0];
}
export async function runtimeConversation(base,key,id,fetcher=fetch){
 const contact=await runtimeContact(base,key,id,fetcher);
 const messages=await rest(base,key,'pcs_messages?select=id,direction,text,status,channel,created_at,raw&contact_id=eq.'+id+'&order=created_at.desc,id.desc&limit=200',fetcher);
 return {source:'runtime',contact,messages:messages.reverse().map(({raw,...m})=>({...m,attachments:runtimeAttachments(m,raw)})),limit:200};
}
export async function intakeRuntime(biz,base,key,b,fetcher=fetch,actor='pcs-manager-admin'){
 if(!b||Array.isArray(b)||Object.keys(b).some(k=>!['contact_id','request_id','need'].includes(k))||!uuid(b.contact_id)||!uuid(b.request_id)||typeof b.need!=='string'||!b.need.trim()||b.need.length>4000)throw new CrmError('Проверьте заявку',400);
 const contact=await runtimeContact(base,key,b.contact_id,fetcher);
 let channel='telegram',message=null;
 if(!contact.telegram_id){
  // Use persisted ingress, not a caller supplied channel, mutable phone or name.
  const received=await rest(base,key,'pcs_messages?select=id,channel,raw,external_message_id,external_chat_id&contact_id=eq.'+contact.id+'&direction=eq.in&status=eq.received&channel=in.(whatsapp,instagram,facebook,line)&order=created_at.desc,id.desc&limit=1',fetcher);
  const inbound=received[0];
  let verified=Boolean(inbound&&uuid(inbound.id)&&['whatsapp','instagram','facebook'].includes(inbound.channel)&&inbound.raw?.source==='pcs-meta-webhook-v1');
  if(inbound?.channel==='line')verified=await verifiedLineMessage(base,key,contact,inbound,fetcher);
  if(!verified)throw new CrmError('Не найдено подтверждённое входящее сообщение поддерживаемого канала. Связь клиента требует проверки.',409);
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

export function runtimeAttachments(message,raw){
 if(message.channel!=='line'||message.direction!=='in'||raw?.source!=='pcs-line-webhook-v1'||!uuid(raw.event_id))return [];
 return (Array.isArray(raw.attachments)?raw.attachments:[]).slice(0,10).filter(a=>['image','audio','video','file'].includes(a?.type)&&/^[0-9]{1,64}$/.test(a?.id||'')).map(a=>({type:a.type,id:a.id,downloadable:a.downloadable===true&&a.provider==='line',...(typeof a.name==='string'?{name:a.name.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,160)}:{}),...(Number.isSafeInteger(a.size)&&a.size>0?{size:a.size}:{})}));
}
async function verifiedLineMessage(base,key,contact,message,fetcher){
 if(!uuid(message?.id)||message.raw?.source!=='pcs-line-webhook-v1'||!uuid(message.raw.event_id)||!/^U[0-9a-f]{32}$/i.test(contact.line_contact||'')||message.raw.external_user_id!==contact.line_contact)return false;
 const rows=await rest(base,key,'pcs_channel_events?select=id,status,payload&id=eq.'+message.raw.event_id+'&channel=eq.line&status=eq.processed&limit=1',fetcher),event=rows[0];
 return event?.status==='processed'&&event.payload?.source==='pcs-line-webhook-v1'&&Array.isArray(event.payload.rows)&&event.payload.rows.some(r=>r.sender===contact.line_contact&&r.message_id===message.external_message_id&&r.chat===message.external_chat_id&&r.account===message.raw.account);
}
export async function runtimeAttachment(base,key,contactId,messageId,fetcher=fetch){
 if(!uuid(contactId)||!uuid(messageId))throw new CrmError('Некорректное вложение',400);
 const contact=await runtimeContact(base,key,contactId,fetcher);
 const rows=await rest(base,key,'pcs_messages?select=id,channel,direction,status,raw,external_message_id,external_chat_id&id=eq.'+messageId+'&contact_id=eq.'+contactId+'&direction=eq.in&channel=eq.line&status=eq.received&limit=1',fetcher),message=rows[0];
 if(!message||message.channel!=='line'||message.direction!=='in'||!(await verifiedLineMessage(base,key,contact,message,fetcher)))throw new CrmError('Подтверждённое вложение не найдено',404);
 const attachment=runtimeAttachments(message,message.raw).find(a=>a.id===message.external_message_id&&a.downloadable);
 if(!attachment)throw new CrmError('Вложение недоступно для скачивания',409);
 const MAX=5*1024*1024;if(attachment.size>MAX)throw new CrmError('Размер вложения превышает 5 МБ',413);
 let token;try{const r=await fetcher(base+'/rest/v1/rpc/pcs_secret_get',{method:'POST',headers:{apikey:key,authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({p_name:'channel_line_channel_access_token'}),signal:AbortSignal.timeout(10000),redirect:'error'});if(!r.ok)throw Error();token=await r.json();if(typeof token!=='string'||!token||token.length>4096)throw Error();}catch{throw new CrmError('Не удалось прочитать настройки LINE',503);}
 try{
  const r=await fetcher('https://api-data.line.me/v2/bot/message/'+attachment.id+'/content',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!r.ok||!r.body)throw Error();if(Number(r.headers.get('content-length'))>MAX){await r.body.cancel();throw new CrmError('Размер вложения превышает 5 МБ',413);}
  const reader=r.body.getReader(),parts=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX)throw new CrmError('Размер вложения превышает 5 МБ',413);parts.push(value);}}finally{await reader.cancel().catch(()=>{});}
  const allowed={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','audio/mpeg':'mp3','audio/mp4':'m4a','audio/ogg':'ogg','video/mp4':'mp4','application/pdf':'pdf','application/octet-stream':'bin'},raw=(r.headers.get('content-type')||'').split(';')[0].toLowerCase(),content_type=Object.hasOwn(allowed,raw)?raw:'application/octet-stream';
  let binary='';for(const part of parts)for(let i=0;i<part.length;i+=8192)binary+=String.fromCharCode(...part.subarray(i,i+8192));
  return {filename:'line-'+attachment.id+'.'+allowed[content_type],content_type,data_base64:btoa(binary),size};
 }catch(e){if(e instanceof CrmError)throw e;throw new CrmError('LINE больше не предоставляет это вложение. Попросите клиента отправить его повторно.',409);}
}
