import { processMessage } from './message-processing.mjs';
import {channelConnectionFingerprint} from './connection-snapshot.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function channelCommand(body){
 const channel=String(body?.channel||'').toLowerCase(),contact_id=String(body?.contact_id||''),request_id=String(body?.request_id||''),text=String(body?.text||'').trim();
 if(!['whatsapp','instagram','facebook','line'].includes(channel)||!UUID.test(contact_id)||!UUID.test(request_id)||!text||text.length>1800)throw Error('channel_command_invalid');
 if(Object.hasOwn(body,'expected_recipient')&&(typeof body.expected_recipient!=='string'||!body.expected_recipient||body.expected_recipient.length>512))throw Error('channel_command_invalid');
 if(Object.hasOwn(body,'expected_connection_fingerprint')&&(typeof body.expected_connection_fingerprint!=='string'||!Object.hasOwn(body,'expected_recipient')||!/^[a-f0-9]{64}$/.test(body.expected_connection_fingerprint)))throw Error('channel_command_invalid');
 return {channel,contact_id,request_id,text,...(Object.hasOwn(body,'expected_connection_fingerprint')?{expected_connection_fingerprint:body.expected_connection_fingerprint}:{}),...(Object.hasOwn(body,'expected_recipient')?{expected_recipient:body.expected_recipient}:{})};
}
export async function durableChannelSend({db,body,target,config,connection,send}){
 const command=channelCommand(body),key='channel-send:'+command.contact_id+':'+command.request_id;
 const read=async()=>{const r=await db.from('pcs_channel_events').select('*').eq('channel',command.channel).eq('external_event_id',key).maybeSingle();if(r.error)throw r.error;return r.data;};
 const prior=await read();
 if(prior?.payload?.outgoing){for(const k of Object.keys(command))if(k==='expected_recipient'&&prior.payload.outgoing[k]===undefined?prior.payload.outgoing.recipient!==command[k]:prior.payload.outgoing[k]!==command[k])throw Error('channel_command_changed');}
 const accepted=prior&&['sent','processed','recording'].includes(prior.status)&&prior.payload?.receipt?.id;
 if(!accepted){
  if(command.expected_recipient&&command.expected_recipient!==target.id)throw Error('channel_destination_changed');
  if(command.expected_connection_fingerprint&&command.expected_connection_fingerprint!==await channelConnectionFingerprint(connection,command.channel))throw Error('channel_connection_changed');
 }
 const outgoing=prior?.payload?.outgoing||{...command,recipient:target.id,transport:String(config.transport||command.channel),message_id:crypto.randomUUID(),retry_key:crypto.randomUUID(),contact_name:target.contact.name||null};
 const review=async(eventId)=>{
  const title='Проверить доставку канала · '+eventId;
  const existing=await db.from('pcs_tasks').select('id').eq('contact_id',command.contact_id).eq('title',title).limit(1).maybeSingle();if(existing.error)throw existing.error;
  if(!existing.data){const r=await db.from('pcs_tasks').insert({contact_id:command.contact_id,title,comment:'Результат внешней отправки неизвестен. Не повторять до проверки переписки.',priority:'HIGH',due_at:new Date().toISOString()});if(r.error)throw r.error;}
 };
 const result=await processMessage({db,channel:command.channel,key,handle:run=>run.send(outgoing),send,
  record:async(out,receipt)=>{
   if(!receipt||!receipt.id)throw Error('channel_delivery_receipt_missing');
   const existing=await db.from('pcs_messages').select('id').eq('id',out.message_id).maybeSingle();if(existing.error)throw existing.error;if(existing.data)return;
   const r=await db.from('pcs_messages').insert({id:out.message_id,contact_id:out.contact_id,direction:'out',text:out.text,status:'sent',raw:{source:'pcs-channel-send-v1',transport:out.transport,request_id:out.request_id,provider_message_id:receipt.id},contact_name:out.contact_name,channel:out.channel,external_message_id:receipt.id,external_chat_id:out.recipient});if(r.error)throw r.error;
  },review});
 if(result?.delivery_review_required)throw Error('channel_delivery_review_required');
 const event=await read();
 if(!event?.payload?.outgoing||Object.keys(command).some(k=>k==='expected_recipient'&&event.payload.outgoing[k]===undefined?event.payload.outgoing.recipient!==command[k]:event.payload.outgoing[k]!==command[k]))throw Error('channel_command_changed');
 if(event?.status!=='processed'||!event.payload?.receipt?.id)throw Error('channel_delivery_receipt_missing');
 return {ok:true,message_id:event.payload.outgoing.message_id,external_message_id:event.payload.receipt.id,duplicate:!!result?.duplicate};
}
