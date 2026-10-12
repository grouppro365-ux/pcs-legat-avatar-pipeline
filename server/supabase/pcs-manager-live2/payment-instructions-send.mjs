import {sendRuntimeMessage} from './runtime-send.mjs';
export const enqueuePaymentInstructions=`insert into pcs_workflow_outbox(aggregate_type,aggregate_id,event_type,idempotency_key,payload)
 select 'APPLICATION',a.id,'PAYMENT_INSTRUCTIONS_READY',
 'payment-instructions:'||a.id::text||':'||md5(i.updated_at::text),
 jsonb_build_object('application_id',a.id,'public_id',a.public_id,'client_profile_id',c.id,'contact_id',c.source_contact_id,
 'revision',i.updated_at::text,'instructions',i.instructions,'recipient',i.recipient,
 'price',a.accepted_offer_snapshot->>'client_price_thb','deposit',a.accepted_offer_snapshot->>'deposit_thb')
 from applications a join pcs.application_payment_instructions i on i.application_id=a.id
 join client_profiles c on c.id=a.client_profile_id
 where a.operational_status='CONFIRMED' and a.client_payment_status in ('AWAITING_PAYMENT','INSTRUCTIONS_SENT','PARTIALLY_PAID')
 and c.blocked is not true and c.merged_into_id is null and c.source_contact_id is not null
 and i.recipient='PARTNER' and not exists(select 1 from pcs_workflow_outbox e where e.idempotency_key='payment-instructions:'||a.id::text||':'||md5(i.updated_at::text))
 order by i.updated_at,a.id limit 50 on conflict(idempotency_key) do nothing returning id`;
export const claimPaymentInstructions=`with due as (
 select id from pcs_workflow_outbox where event_type='PAYMENT_INSTRUCTIONS_READY' and aggregate_type='APPLICATION'
 and status in ('PENDING','FAILED','PROCESSING') and next_attempt_at<=now() order by created_at,id limit 10 for update skip locked
 ) update pcs_workflow_outbox e set status='PROCESSING',attempts=e.attempts+1,next_attempt_at=now()+interval '10 minutes',
 payload=e.payload||jsonb_build_object('payment_worker_owner',gen_random_uuid()),last_error=null from due d where e.id=d.id returning e.id,e.payload,e.attempts`;
export const currentPaymentInstructions=`select a.id from applications a join pcs.application_payment_instructions i on i.application_id=a.id
 join client_profiles c on c.id=a.client_profile_id where a.id=$1::uuid and a.client_profile_id=$2::uuid
 and a.operational_status='CONFIRMED' and a.client_payment_status in ('AWAITING_PAYMENT','INSTRUCTIONS_SENT','PARTIALLY_PAID')
 and i.updated_at::text=$3 and c.source_contact_id=$4::uuid and c.blocked is not true and c.merged_into_id is null
 and i.recipient='PARTNER'`;
export const finishPaymentInstructions=`with changed as (
 update pcs_workflow_outbox set status=$3,sent_at=case when $3='SENT' then clock_timestamp() else sent_at end,
 last_error=$4,next_attempt_at=case when $3='FAILED' then now()+interval '5 minutes' else next_attempt_at end
 where id=$1::uuid and status='PROCESSING' and payload->>'payment_worker_owner'=$2 returning id,aggregate_id
 ),notified as (
 insert into notifications(event_key,entity_type,entity_id,title,body,status,dedupe_key)
 select 'payment.instructions_review','applications',aggregate_id::text,'Проверить отправку реквизитов',
 'Откройте заявку и проверьте адрес канала или историю доставки перед повтором.','PENDING','payment-send-review:'||id::text
 from changed where $3='CANCELLED' and $4<>'superseded' on conflict(dedupe_key) do nothing returning id
 ),audited as (
 insert into audit_events(actor_role,action,entity_type,entity_id,patch,result)
 select 'SYSTEM','payment_instructions_delivery','applications',aggregate_id::text,jsonb_build_object('outbox_id',id,'delivery_status',$3,'reason',$4),'SUCCESS' from changed returning entity_id
 ) select id from changed where exists(select 1 from audited where entity_id=changed.aggregate_id::text)`;
export function paymentInstructionsText(p,language='ru'){
 if(p.recipient!=='PARTNER'||typeof p.instructions!=='string'||!p.instructions.trim()||!/^\d+(?:\.\d{1,2})?$/.test(p.price||'')||Number(p.price)<=0)throw Error('payment_instructions_invalid');
 const en=String(language).toLowerCase().startsWith('en'),th=String(language).toLowerCase().startsWith('th');
 const title=th?'ข้อมูลการชำระเงิน':en?'Payment details':'Данные для оплаты';
 const amount=th?'ค่าบริการ':en?'Service price':'Стоимость услуги';
 const deposit=th?'เงินประกันคืนได้':en?'Refundable security deposit':'Возвратный депозит';
 const note=th?'ชำระให้ผู้ให้บริการตามข้อมูลด้านล่าง หลังโอนโปรดส่งหมายเลขรายการหรือหลักฐาน เจ้าหน้าที่จะตรวจสอบยอดชำระ':en?'Pay the partner using the details below. After payment, send the transfer reference or confirmation. An operator will verify the payment.':'Оплата партнёру по реквизитам ниже. После перевода пришлите номер операции или подтверждение. Поступление проверит оператор.';
 return `${title} · ${p.public_id||'PCS'}\n${amount}: ${p.price} THB${/^\d+(?:\.\d{1,2})?$/.test(p.deposit||'')?`\n${deposit}: ${p.deposit} THB`:''}\n\n${p.instructions.trim()}\n\n${note}`;
}
export async function dispatchPaymentInstructions(biz,db,transport,options={}){
 const enqueue=options.enqueue||enqueuePaymentInstructions,claim=options.claim||claimPaymentInstructions,currentQuery=options.current||currentPaymentInstructions,finish=options.finish||finishPaymentInstructions,textFor=options.text||paymentInstructionsText;
 await biz.query(enqueue,[]);const jobs=await biz.query(claim,[]);
 const stats={sent:0,duplicates:0,review:0,superseded:0,retry:0};
 for(const job of jobs){
  const p=job.payload,owner=p.payment_worker_owner;let channel=p.channel,status='CANCELLED',reason='preflight_failed';
  try{
   const current=await biz.query(currentQuery,[p.application_id,p.client_profile_id,p.revision,p.contact_id]);
   if(!current.length){reason='superseded';stats.superseded++;}
   else {
    const found=await db.from('pcs_contacts').select('id,preferred_channel,detected_language,language,telegram_chat_id,business_connection_id').eq('id',p.contact_id).single();
    if(found.error||!found.data)throw Error('payment_contact_missing');const contact=found.data;
    if(!channel)channel=['telegram','line','whatsapp','instagram','facebook'].includes(contact.preferred_channel)?contact.preferred_channel:contact.telegram_chat_id&&contact.business_connection_id?'telegram':null;
    const text=p.delivery_text||textFor(p,contact.detected_language||contact.language);
    if(!p.delivery_text){
     if(!channel)throw Error('payment_channel_missing');
     if(text.length>(channel==='telegram'?4000:1800))throw Error('payment_instructions_too_long');
     const locked=await biz.query("update pcs_workflow_outbox set payload=payload||jsonb_build_object('channel',$3,'delivery_text',$4) where id=$1::uuid and status='PROCESSING' and payload->>'payment_worker_owner'=$2 returning id",[job.id,owner,channel,text]);
     if(!locked.length)throw Error('payment_lease_lost');
    }
    if(text.length>(channel==='telegram'?4000:1800))throw Error('payment_instructions_too_long');
    const result=await sendRuntimeMessage(db,p.contact_id,{request_id:job.id,channel,text},transport);
    status='SENT';reason=null;stats[result.duplicate?'duplicates':'sent']++;
   }
  }catch{
   // Only a durable provider receipt or a pre-send failure permits recovery.
   // Unknown delivery, abandoned active work and configuration errors require review.
   let event;
   if(channel){const r=await db.from('pcs_channel_events').select('status').eq('channel',channel).eq('external_event_id','operator:'+p.contact_id+':'+job.id).maybeSingle();if(!r.error)event=r.data;}
   if(['sent','failed'].includes(event?.status)&&job.attempts<5){status='FAILED';reason='recoverable_recording_failure';stats.retry++;}
   else{reason='delivery_review_required';stats.review++;}
  }
  const result=await biz.query(finish,[job.id,owner,status,reason]);
  if(!result.length)throw Error('payment_delivery_lease_lost');
 }
 return {ok:true,...stats};
}
