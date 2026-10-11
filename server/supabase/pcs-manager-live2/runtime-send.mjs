import { processMessage } from './message-processing.mjs';
import { CrmError } from './crm-policy.mjs';
import { uuid } from './portal-workflow.mjs';
export async function sendRuntimeMessage(db,id,b,transport){
 if(!uuid(id)||!uuid(b.request_id)||!['telegram','line','whatsapp','instagram','facebook'].includes(b.channel)||typeof b.text!=='string'||!b.text.trim()||b.text.length>1800||Object.keys(b).some(k=>!['request_id','channel','text'].includes(k)))throw new CrmError('Проверьте канал и текст сообщения',400);
 const found=await db.from('pcs_contacts').select('id,name,telegram_chat_id,business_connection_id,line_contact,whatsapp,instagram,facebook').eq('id',id).single();
 if(found.error||!found.data)throw new CrmError('Контакт не найден',404);const contact=found.data,text=b.text.trim();
 if(b.channel==='telegram'&&(!contact.telegram_chat_id||!contact.business_connection_id))throw new CrmError('Telegram-диалог не связан с бизнес-подключением',409);
 if(b.channel!=='telegram'&&!contact[b.channel==='line'?'line_contact':b.channel])throw new CrmError('Адрес канала не подтверждён',409);
 const outgoing={contact_id:id,channel:b.channel,text,request_id:b.request_id};
 // Bind command contents before starting transport. A changed retry cannot send a second text.
 const key='operator:'+id+':'+b.request_id;
 const prior=await db.from('pcs_channel_events').select('payload').eq('channel',b.channel).eq('external_event_id',key).maybeSingle();
 if(prior.error)throw new CrmError('Не удалось проверить предыдущую отправку',503);
 if(prior.data?.payload?.outgoing&&JSON.stringify(prior.data.payload.outgoing)!==JSON.stringify(outgoing))throw new CrmError('Текст повторной команды изменён. Проверьте историю.',409);
 const result=await processMessage({db,channel:b.channel,key,
  handle:run=>run.send(outgoing),
  send:out=>transport(out,contact),
  record:async(out,receipt)=>{
   if(out.channel!=='telegram'){if(!receipt?.ok||!receipt?.message_id)throw Error('delivery_receipt_missing');return;}
   if(!Number.isSafeInteger(receipt?.message_id))throw Error('delivery_receipt_missing');
   const existing=await db.from('pcs_messages').select('id').eq('contact_id',id).eq('telegram_message_id',receipt.message_id).eq('direction','out').maybeSingle();if(existing.error)throw existing.error;if(existing.data)return;
   const saved=await db.from('pcs_messages').insert({contact_id:id,direction:'out',text:out.text,status:'sent',channel:'telegram',telegram_message_id:receipt.message_id,business_connection_id:contact.business_connection_id,chat_id:contact.telegram_chat_id,raw:{source:'pcs-manager-operator',request_id:b.request_id}});if(saved.error)throw saved.error;
  },
  review:async(eventId)=>{const r=await db.from('pcs_tasks').insert({contact_id:id,title:'Проверить доставку ответа оператора · '+eventId,comment:'Не повторять отправку до проверки переписки.',priority:'HIGH',due_at:new Date().toISOString()});if(r.error)throw r.error;}
 });
 if(result?.delivery_review_required)throw new CrmError('Доставка не подтверждена. Проверьте переписку перед повтором.',409);
 return {ok:true,duplicate:!!result?.duplicate};
}
export async function runtimeTransport(base,key,out,contact,fetcher=fetch){
 const secret=async name=>{const r=await fetcher(base+'/rest/v1/rpc/pcs_secret_get',{method:'POST',headers:{apikey:key,authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({p_name:name}),signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('transport_config_missing');return r.json();};
 if(out.channel==='telegram'){
  const token=await secret('telegram_bot_token');if(!token)throw Error('transport_config_missing');
  const r=await fetcher('https://api.telegram.org/bot'+token+'/sendMessage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({business_connection_id:contact.business_connection_id,chat_id:String(contact.telegram_chat_id),text:out.text}),signal:AbortSignal.timeout(15000)});const d=await r.json();if(!r.ok||!d.ok)throw Error('transport_failed');return d.result;
 }
 const internal=await secret('internal_retry_secret');if(!internal)throw Error('transport_config_missing');
 const r=await fetcher(base+'/functions/v1/pcs-channel-send-v1',{method:'POST',headers:{'content-type':'application/json','x-pcs-internal-secret':internal},body:JSON.stringify(out),signal:AbortSignal.timeout(30000)});const d=await r.json();if(!r.ok||!d.ok)throw Error('transport_failed');return d;
}
