import {CrmError,contactId} from './crm-policy.mjs';
export class DeliveryError extends CrmError {
 constructor(message,code,status=409){super(message,status);this.code=code}
}
export class ProviderRejection extends Error {}
const uncertain=()=>new DeliveryError('Доставка не подтверждена. Проверьте диалог; повторная отправка заблокирована.','delivery_uncertain');
export function validateManualSend(cid,b){
 contactId(cid);
 if(!b||Object.keys(b).some(k=>!['text','request_id'].includes(k))||typeof b.text!=='string'||!b.text.trim()||b.text.length>4000||typeof b.request_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(b.request_id))throw new DeliveryError('Введите сообщение до 4000 символов и обновите форму отправки.','invalid_send',400);
 return{id:b.request_id.toLowerCase(),text:b.text.trim()};
}
export async function manualTelegram(token,payload,transport=fetch){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
 try{
  const r=await transport('https://api.telegram.org/bot'+token+'/sendMessage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});
  const data=await r.json();
  if(data.ok===false&&Number(data.error_code)>=400&&Number(data.error_code)<500&&Number(data.error_code)!==408)throw new ProviderRejection('telegram_rejected');
  if(!r.ok||data.ok!==true||!Number.isSafeInteger(data.result?.message_id)||data.result.message_id<=0)throw Error('telegram_outcome_unknown');
  return data.result;
 }finally{clearTimeout(timer)}
}
async function existing(sql,id){return(await sql.query('select m.*,cv.contact_id request_contact from messages m join conversations cv on cv.id=m.conversation_id where m.id=$1 limit 1',[id]))[0]}
function replay(row,cid,request){
 if(!row)return null;
 const state=row.raw?.manual_send;
 if(row.request_contact!==cid||state?.contact_id!==cid||row.text!==request.text||row.direction!=='OUT')throw new DeliveryError('Идентификатор уже используется другим сообщением. Откройте новую форму.','send_conflict');
 if(row.status==='SENT'&&state.stage==='sent'&&row.raw?.delivery_review?.method==='operator_attestation'&&row.raw.delivery_review.outcome==='delivered')return{ok:true,request_id:request.id,replayed:true,operator_confirmed:true};
 if(row.status==='SENT'&&state.stage==='sent'&&Number.isSafeInteger(Number(row.telegram_message_id))&&Number(row.telegram_message_id)>0)return{ok:true,message_id:Number(row.telegram_message_id),request_id:request.id,replayed:true};
 if(row.status!=='FAILED'||state.stage!=='rejected')throw uncertain();
 return null;
}
export async function sendManualMessage(sql,cid,input,deliver){
 const request=validateManualSend(cid,input),prior=await existing(sql,request.id),done=replay(prior,cid,request);if(done)return done;
 const route=(await sql.query("select cv.id,cv.connection_id,cv.chat_id::text chat_id,tc.enabled,tc.rights from conversations cv left join telegram_connections tc on tc.connection_id=cv.connection_id where cv.contact_id=$1 order by coalesce(cv.last_message_at,cv.updated_at,cv.created_at) desc,cv.id desc limit 1",[cid]))[0];
 if(!route||route.enabled!==true||route.rights?.can_reply!==true||!route.connection_id||!/^\d{1,19}$/.test(String(route.chat_id))||BigInt(route.chat_id)<=0n)throw new DeliveryError('Telegram-подключение клиента недоступно для ответа. Проверьте подключения.','send_route_unavailable',409);
 if(prior&&prior.conversation_id!==route.id)throw new DeliveryError('Маршрут клиента изменился. Проверьте диалог перед новой отправкой.','send_route_unavailable');
 const raw={manual_send:{contact_id:cid,stage:'sending'}};
 const claim=prior
  ?await sql.query("update messages set status='PROCESSING'::\"MessageStatus\",raw=$2::jsonb,updated_at=now() where id=$1 and status='FAILED'::\"MessageStatus\" and raw->'manual_send'->>'stage'='rejected' and text=$3 returning id",[request.id,JSON.stringify(raw),request.text])
  :await sql.query("insert into messages(id,conversation_id,business_connection_id,direction,status,text,raw,created_at,updated_at) values($1,$2,$3,'OUT'::\"MessageDirection\",'PROCESSING'::\"MessageStatus\",$4,$5::jsonb,now(),now()) on conflict(id) do nothing returning id",[request.id,route.id,route.connection_id,request.text,JSON.stringify(raw)]);
 if(!claim.length){const receipt=replay(await existing(sql,request.id),cid,request);if(receipt)return receipt;throw uncertain()}
 let receipt;
 try{receipt=await deliver({business_connection_id:route.connection_id,chat_id:String(route.chat_id),text:request.text})}
 catch(error){
  if(error instanceof ProviderRejection){
   try{const failed=await sql.query("update messages set status='FAILED'::\"MessageStatus\",raw=jsonb_set(raw,'{manual_send,stage}','\"rejected\"'),updated_at=now() where id=$1 and status='PROCESSING'::\"MessageStatus\" and raw->'manual_send'->>'stage'='sending' returning id",[request.id]);if(failed.length)throw new DeliveryError('Telegram отклонил сообщение. Исправьте подключение и повторите попытку.','send_rejected',422)}catch(e){if(e instanceof DeliveryError)throw e}
  }
  throw uncertain();
 }
 if(!Number.isSafeInteger(receipt?.message_id)||receipt.message_id<=0)throw uncertain();
 try{
  const saved=await sql.query(`with written as (
   update messages set telegram_message_id=$2,status='SENT'::"MessageStatus",raw=jsonb_set(raw,'{manual_send,stage}','"sent"'),sent_at=now(),updated_at=now()
   where id=$1 and status='PROCESSING'::"MessageStatus" and raw->'manual_send'->>'stage'='sending' returning id,conversation_id
  ), conversation_touch as (update conversations cv set last_message_at=now(),updated_at=now() from written w where cv.id=w.conversation_id returning cv.id),
  contact_touch as (update contacts set last_contact_at=now(),updated_at=now() where id=$3 and exists(select 1 from written) returning id),
  audit as (insert into audit_logs(id,actor,action,entity_type,entity_id,payload,created_at) select $4,'admin','crm_message_sent','message',w.id,jsonb_build_object('conversation_id',w.conversation_id),now() from written w returning id)
  select id from written`,[request.id,receipt.message_id,cid,crypto.randomUUID()]);
  if(!saved.length)throw uncertain();
 }catch{throw uncertain()}
 return{ok:true,message_id:receipt.message_id,request_id:request.id};
}
