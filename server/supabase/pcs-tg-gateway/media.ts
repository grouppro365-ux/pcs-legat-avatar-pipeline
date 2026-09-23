import {sb,tg,sec,MEDIA} from './common.ts';
import {bookingDocumentType} from './booking-document-type.mjs';
import {bookingFileId,bookingMime} from './booking-file.mjs';
function b64(u:Uint8Array){let s='';for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode(...u.subarray(i,Math.min(i+0x8000,u.length)));return btoa(s)}
export async function transcribe(fileId:string){const token=await sec('telegram_bot_token'),key=await sec('openrouter_key'),f=await tg('getFile',{file_id:fileId});if(!f?.file_path)throw new Error('voice_path_missing');const r=await fetch(`https://api.telegram.org/file/bot${token}/${f.file_path}`);if(!r.ok)throw new Error(`voice_download_${r.status}`);const u=new Uint8Array(await r.arrayBuffer());if(u.length>24*1024*1024)throw new Error('voice_too_large');let fmt=(f.file_path.split('.').pop()||'ogg').toLowerCase();if(fmt==='oga')fmt='ogg';const tr=await fetch('https://openrouter.ai/api/v1/audio/transcriptions',{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json','HTTP-Referer':'https://vipthaiconcierge.com','X-OpenRouter-Title':'Premium Concierge Service Thailand'},body:JSON.stringify({model:'openai/whisper-1',input_audio:{data:b64(u),format:fmt}})}),j=await tr.json();if(!tr.ok)throw new Error(j?.error?.message||`transcription_${tr.status}`);const text=String(j?.text||'').trim();if(!text)throw new Error('empty_transcript');return text}
export function fileId(m:any){if(Array.isArray(m?.photo)&&m.photo.length)return m.photo[m.photo.length-1]?.file_id||null;if(m?.document?.file_id&&String(m.document.mime_type||'').startsWith('image/'))return m.document.file_id;return null}
export {bookingFileId};
// Booking documents bypass third-party vision classification. The caption is
// only a routing hint; a human must inspect the private file before approval.
export async function bookingMedia(m:any){
  const id=bookingFileId(m);
  if(!id||!m?.business_connection_id)return null;
  const {data:contact,error:ce}=await sb.from('pcs_contacts').select('id').eq('telegram_chat_id',m.chat.id).eq('business_connection_id',m.business_connection_id).order('last_contact_at',{ascending:false}).limit(1).maybeSingle();
  if(ce)throw ce;
  if(!contact)return null;
  const {data:request,error:re}=await sb.from('pcs_booking_requests').select('id,status,contact_id,booking_deposit_amount,payment_status,passport_status,international_permit_status').eq('contact_id',contact.id).in('status',['collecting','ready_for_booking','booked']).order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(re)throw re;
  if(!request)return null;
  const {data:prior,error:pe}=await sb.from('pcs_media_intake').select('id,classification').eq('contact_id',contact.id).eq('business_connection_id',m.business_connection_id).eq('telegram_message_id',m.message_id).eq('action_taken','private_booking_document_received').contains('extracted',{booking_request_id:request.id}).limit(1).maybeSingle();
  if(pe)throw pe;
  if(prior)return{ok:true,classification:prior.classification,booking_request_id:request.id,review_status:'needs_review',duplicate:true};
  const f=await tg('getFile',{file_id:id});
  if(!f?.file_path)throw new Error('booking_document_file_missing');
  if(Number(f.file_size)>15*1024*1024)throw new Error('booking_document_too_large');
  const token=await sec('telegram_bot_token');
  const response=await fetch(`https://api.telegram.org/file/bot${token}/${f.file_path}`);
  if(!response.ok)throw new Error('booking_document_download_failed');
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(!bytes.length||bytes.length>15*1024*1024)throw new Error('booking_document_invalid_size');
  const {mime,ext}=bookingMime(bytes),cls=bookingDocumentType(m.caption||'');
  const path=`booking-requests/${request.id}/${crypto.randomUUID()}.${ext}`;
  const {error:up}=await sb.storage.from('pcs-contracts').upload(path,bytes,{contentType:mime,upsert:false});
  if(up)throw up;
  const {data:intake,error:ie}=await sb.from('pcs_media_intake').insert({source_channel:'telegram',telegram_chat_id:m.chat.id,business_connection_id:m.business_connection_id,contact_id:contact.id,telegram_message_id:m.message_id,telegram_file_id:id,media_type:mime==='application/pdf'?'document':'photo',classification:cls,confidence:0,extracted:{storage_bucket:'pcs-contracts',storage_path:path,booking_request_id:request.id,caption_only:true},action_taken:'private_booking_document_received',review_status:'needs_review'}).select('id').single();
  if(ie)throw ie;
  if(request.status==='collecting'){
    const update:any={updated_at:new Date().toISOString()};
    if(cls==='passport'&&request.passport_status!=='approved'){update.passport_status='received';update.passport_media_intake_id=intake.id}
    else if(cls==='international_permit'&&request.international_permit_status!=='approved'){update.international_permit_status='received';update.permit_media_intake_id=intake.id}
    else if(cls==='receipt'&&['requested','receipt_pending'].includes(request.payment_status)){update.receipt_media_intake_id=intake.id;if(request.booking_deposit_amount)update.payment_status='receipt_pending'}
    if(Object.keys(update).length>1){const {error:ue}=await sb.from('pcs_booking_requests').update(update).eq('id',request.id).eq('status','collecting');if(ue)throw ue}
  }
  return{ok:true,classification:cls,booking_request_id:request.id,review_status:'needs_review'};
}
export async function media(m:any,admin:boolean){const id=fileId(m);if(!id)return null;const secret=await sec('internal_retry_secret'),r=await fetch(MEDIA,{method:'POST',headers:{'content-type':'application/json','x-pcs-internal-secret':secret},body:JSON.stringify({file_id:id,chat_id:m.chat?.id||null,business_connection_id:m.business_connection_id||null,message_id:m.message_id||null,caption:m.caption||'',admin})});const j=await r.json();if(!r.ok)throw new Error(j?.error||`media_${r.status}`);return j}
export async function ackMedia(m:any,r:any){const {data:c}=await sb.from('pcs_contacts').select('language,detected_language').eq('telegram_chat_id',m.chat.id).order('last_contact_at',{ascending:false}).limit(1).maybeSingle();const lang=String(c?.detected_language||c?.language||'ru').slice(0,2),cls=r?.classification;let ru='Фото получил и сохранил. Если понадобится уточнение, напишу.';if(r?.booking_request_id){ru=cls==='passport'?'Паспорт получил. Проверим его перед оформлением брони.':cls==='international_permit'?'МВУ получил. Проверим документ перед оформлением брони.':cls==='receipt'?'Чек получил. Поступление денег ещё проверим; бронь пока не подтверждена.':'Фото получил в закрытое хранилище. Подпишите, пожалуйста, что на нём: паспорт, МВУ или чек.'}else if(cls==='receipt')ru='Чек получил. Внёс его в финансы на проверку. После подтверждения оплаты напишу сюда.';else if(cls==='vehicle'&&r?.related?.catalog_item_id)ru='Фото машины получил. Определил вариант и связал его с карточкой.';else if(cls==='vehicle')ru='Фото машины получил. Распознал, сейчас сверю с доступными вариантами.';else if(cls==='payment_details'||cls==='qr_payment')ru='Реквизиты на фото распознал и сохранил.';else if(cls==='passport'||cls==='driver_license')ru='Документ получил. Данные распознал и привязал к вашему запросу.';const en=r?.booking_request_id?'I received the document securely for review. The booking is not confirmed yet.':cls==='receipt'?'I received the receipt and added it to finance for verification. I’ll confirm here once the payment is checked.':'I received the photo and saved the details.',text=lang==='ru'?ru:en;const s=await tg('sendMessage',{business_connection_id:m.business_connection_id,chat_id:String(m.chat.id),text});await sb.from('pcs_messages').insert({telegram_message_id:s.message_id,business_connection_id:m.business_connection_id,contact_id:r?.booking_request_id?c?.id:null,chat_id:m.chat.id,direction:'out',text,status:'sent',raw:s})}
