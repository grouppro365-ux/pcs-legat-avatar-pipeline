import {CrmError,contactId} from './crm-policy.mjs';
import {DeliveryError,ProviderRejection} from './manual-send.mjs';
const uncertain=()=>new DeliveryError('Доставка не подтверждена. Проверьте диалог клиента; повторная отправка заблокирована.','delivery_uncertain');
export function approvalInput(b){
 if(!b||Object.keys(b).some(k=>!['id','action','expected_version','text'].includes(k)))throw new CrmError('Некорректное согласование',400);
 contactId(b.id);
 if(!['send','reject'].includes(b.action)||typeof b.expected_version!=='string'||b.expected_version.length>100||!b.expected_version)throw new CrmError('Обновите очередь перед решением',400);
 if(b.action==='send'&&(typeof b.text!=='string'||!b.text.trim()||b.text.length>4000))throw new CrmError('Ответ должен содержать от 1 до 4000 символов',400);
 return b;
}
export function approvalClaimQuery(b){return{query:`with claimed as (
 update ai_generations g set updated_at=greatest(clock_timestamp()::timestamp,g.updated_at+interval '1 microsecond')
 from conversations cv join telegram_connections tc on tc.connection_id=cv.connection_id
 where g.id=$1 and g.status='APPROVAL_REQUIRED'::"AiGenerationStatus" and g.updated_at::text=$2 and g.answer=$3
 and cv.id=g.conversation_id and tc.enabled=true and tc.rights->'can_reply'='true'::jsonb
 and cv.chat_id>0 returning g.id,g.conversation_id,cv.connection_id,cv.contact_id
 ), inserted as (
 insert into messages(id,conversation_id,business_connection_id,direction,status,text,raw,created_at,updated_at)
 select $4,c.conversation_id,c.connection_id,'OUT'::"MessageDirection",'PROCESSING'::"MessageStatus",$3,jsonb_build_object('approval_send',jsonb_build_object('generation_id',c.id,'stage','sending')),now(),now() from claimed c
 on conflict(id) do update set status='PROCESSING'::"MessageStatus",raw=excluded.raw,updated_at=now()
 where messages.status='FAILED'::"MessageStatus" and messages.raw->'approval_send'->>'stage'='rejected' and messages.raw->'approval_send'->>'generation_id'=$1 and messages.text=excluded.text and messages.conversation_id=excluded.conversation_id
 returning id,conversation_id,business_connection_id
 ) select i.*,cv.chat_id::text chat_id from inserted i join conversations cv on cv.id=i.conversation_id`,params:[b.id,b.expected_version,b.text,'approval:'+b.id]}}
export function approvalRejectQuery(b,auditId){return{query:`with changed as (
 update ai_generations g set status='REJECTED'::"AiGenerationStatus",updated_at=now()
 where g.id=$1 and g.status='APPROVAL_REQUIRED'::"AiGenerationStatus" and g.updated_at::text=$2
 and not exists(select 1 from messages m where m.id=$3 and (m.status<>'FAILED'::"MessageStatus" or m.raw->'approval_send'->>'stage' is distinct from 'rejected')) returning g.id
 ), audit as(insert into audit_logs(id,actor,action,entity_type,entity_id,payload,created_at) select $4,'admin','ai_answer_rejected','ai_generation',id,'{}'::jsonb,now() from changed returning id)
 select id from changed`,params:[b.id,b.expected_version,'approval:'+b.id,auditId]}}
export function approvalReceiptQuery(id,messageId,auditId){return{query:`with written as (
 update messages set telegram_message_id=$2,status='SENT'::"MessageStatus",raw=jsonb_set(raw,'{approval_send,stage}','"sent"'),sent_at=now(),updated_at=now()
 where id=$1 and status='PROCESSING'::"MessageStatus" and raw->'approval_send'->>'generation_id'=$3 and raw->'approval_send'->>'stage'='sending' returning id,conversation_id
 ), generation_touch as(update ai_generations set status='SENT'::"AiGenerationStatus",updated_at=now() where id=$3 and status='APPROVAL_REQUIRED'::"AiGenerationStatus" and exists(select 1 from written) returning id),
 conversation_touch as(update conversations cv set last_message_at=now(),updated_at=now() from written w where cv.id=w.conversation_id returning cv.contact_id),
 contact_touch as(update contacts c set last_contact_at=now(),updated_at=now() from conversation_touch cv where c.id=cv.contact_id returning c.id),
 audit as(insert into audit_logs(id,actor,action,entity_type,entity_id,payload,created_at) select $4,'admin','ai_answer_sent','ai_generation',$3,jsonb_build_object('message_id',w.id,'conversation_id',w.conversation_id),now() from written w returning id)
 select id from written`,params:['approval:'+id,messageId,id,auditId]}}
export async function decideApproval(sql,input,deliver){
 const b=approvalInput(input),mid='approval:'+b.id;
 const g=(await sql.query('select id,conversation_id,status,answer,updated_at::text edit_version from ai_generations where id=$1 limit 1',[b.id]))[0];
 if(!g)throw new CrmError('Черновик не найден',404);
 const prior=(await sql.query('select id,conversation_id,direction,status,text,telegram_message_id,raw from messages where id=$1 limit 1',[mid]))[0];
 if(prior&&(prior.raw?.approval_send?.generation_id!==b.id||prior.direction!=='OUT'||prior.conversation_id!==g.conversation_id))throw new CrmError('Конфликт идентификатора согласования',409);
 if(b.action==='reject'){
  if(prior&&(prior.status!=='FAILED'||prior.raw.approval_send.stage!=='rejected'))throw uncertain();
  if(g.status==='REJECTED')return{ok:true,replayed:true};
  const q=approvalRejectQuery(b,crypto.randomUUID()),r=await sql.query(q.query,q.params);
  if(!r.length)throw new CrmError('Черновик изменился. Обновите очередь.',409);
  return{ok:true};
 }
 if(prior){
  if(prior.text!==b.text)throw new CrmError('Текст попытки уже зафиксирован. Проверьте диалог.',409);
  if(prior.status==='SENT'&&prior.raw.approval_send.stage==='sent'&&Number.isSafeInteger(Number(prior.telegram_message_id))&&Number(prior.telegram_message_id)>0)return{ok:true,message_id:Number(prior.telegram_message_id),replayed:true};
  if(prior.status!=='FAILED'||prior.raw.approval_send.stage!=='rejected')throw uncertain();
 }
 if(g.status!=='APPROVAL_REQUIRED'||g.edit_version!==b.expected_version||g.answer!==b.text)throw new CrmError('Черновик изменился. Обновите очередь перед отправкой.',409);
 const q=approvalClaimQuery(b),route=(await sql.query(q.query,q.params))[0];
 if(!route)throw new CrmError('Черновик или Telegram-подключение изменились. Обновите очередь и проверьте подключение.',409);
 let receipt;
 try{receipt=await deliver({business_connection_id:route.business_connection_id,chat_id:route.chat_id,text:b.text})}
 catch(e){
  if(e instanceof ProviderRejection){try{
   const rows=await sql.query(`update messages set status='FAILED'::"MessageStatus",raw=jsonb_set(raw,'{approval_send,stage}','"rejected"'),updated_at=now() where id=$1 and status='PROCESSING'::"MessageStatus" and raw->'approval_send'->>'stage'='sending' returning id`,[mid]);
   if(rows.length)throw new DeliveryError('Telegram отклонил ответ. Обновите очередь и проверьте подключение.','send_rejected',422);
  }catch(err){if(err instanceof DeliveryError)throw err}}
  throw uncertain();
 }
 if(!Number.isSafeInteger(receipt?.message_id)||receipt.message_id<=0)throw uncertain();
 try{const q=approvalReceiptQuery(b.id,receipt.message_id,crypto.randomUUID());if(!(await sql.query(q.query,q.params)).length)throw uncertain()}catch{throw uncertain()}
 return{ok:true,message_id:receipt.message_id};
}
