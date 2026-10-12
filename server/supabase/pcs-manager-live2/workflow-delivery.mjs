import {dispatchPaymentInstructions,claimPaymentInstructions,finishPaymentInstructions} from './payment-instructions-send.mjs';
// Current canonical state is checked both while enqueueing and immediately before delivery.
// Never replay historical transitions when enabling this worker.
export const workflowCandidates=`with enabled as (
 select (value->>'enabled_from')::timestamptz since from system_settings where key='workflow_client_delivery'
), candidates as (
 select a.id application_id,a.public_id,a.client_profile_id,'OFFER_READY' kind,'offer:'||o.id::text||':'||md5(o.updated_at::text) revision,
 o.client_price_thb::text price,o.deposit_thb::text deposit,o.terms
 from applications a join pcs_partner_offers o on o.application_id=a.id and o.partner_id=a.assigned_partner_id cross join enabled
 where o.status='APPROVED' and o.reviewed_at>=enabled.since and o.expires_at>now() and a.selected_partner_offer_id is null
 and a.operational_status in ('QUOTE_READY','QUOTE_SENT','AWAITING_CLIENT_DECISION')
 union all
 select a.id,a.public_id,a.client_profile_id,e.event_type,'event:'||e.id::text,null,null,null
 from applications a join pcs_workflow_outbox e on e.aggregate_id=a.id and e.aggregate_type='APPLICATION' cross join enabled
 where e.created_at>=enabled.since and e.created_at>now()-interval '3 days' and (
 (e.event_type='PARTNER_FINAL_CONFIRMED' and a.operational_status='AWAITING_PARTNER_CONFIRMATION' and a.partner_response_status='ACCEPTED') or
 (e.event_type='PARTNER_FINAL_DECLINED' and a.operational_status='CANCELLED_BY_PARTNER' and a.partner_response_status='DECLINED') or
 (e.event_type='CLIENT_BOOKING_CONFIRMED' and a.operational_status='CONFIRMED' and a.client_payment_status='AWAITING_PAYMENT'))
 union all
 select a.id,a.public_id,a.client_profile_id,'PAYMENT_'||c.status,'claim:'||c.id::text||':'||md5(c.updated_at::text),c.amount_thb::text,null,null
 from applications a join pcs.application_payment_claims c on c.application_id=a.id cross join enabled
 where c.reviewed_at>=enabled.since and c.reviewed_at>now()-interval '3 days' and c.status in ('VERIFIED','REJECTED') and a.operational_status='CONFIRMED'
 union all
 select a.id,a.public_id,a.client_profile_id,a.operational_status,'phase:'||a.id::text||':'||a.operational_status,null,null,null
 from applications a cross join enabled where a.updated_at>=enabled.since and a.updated_at>now()-interval '3 days'
 and a.operational_status in ('SERVICE_IN_PROGRESS','COMPLETED') and a.client_payment_status='PAID_TO_PARTNER'
), eligible as (
 select x.*,c.source_contact_id contact_id from candidates x join client_profiles c on c.id=x.client_profile_id
 where c.blocked is not true and c.merged_into_id is null and c.source_contact_id is not null
)`;
export const enqueueWorkflowDelivery=workflowCandidates+`
 insert into pcs_workflow_outbox(aggregate_type,aggregate_id,event_type,idempotency_key,payload)
 select 'APPLICATION',application_id,'CLIENT_WORKFLOW_NOTICE_READY','client-workflow:'||revision,
 jsonb_build_object('application_id',application_id,'public_id',public_id,'client_profile_id',client_profile_id,'contact_id',contact_id,'kind',kind,'revision',revision,'price',price,'deposit',deposit,'terms',terms)
 from eligible where not exists(select 1 from pcs_workflow_outbox e where e.idempotency_key='client-workflow:'||eligible.revision)
 order by revision limit 50 on conflict(idempotency_key) do nothing returning id`;
export const currentWorkflowDelivery=workflowCandidates+` select application_id id from eligible where application_id=$1::uuid and client_profile_id=$2::uuid and revision=$3 and contact_id=$4::uuid`;
export const claimWorkflowDelivery=claimPaymentInstructions.replaceAll('PAYMENT_INSTRUCTIONS_READY','CLIENT_WORKFLOW_NOTICE_READY');
export const finishWorkflowDelivery=finishPaymentInstructions.replaceAll('payment.instructions_review','workflow.delivery_review').replaceAll('Проверить отправку реквизитов','Проверить отправку сообщения по сделке').replaceAll('payment-send-review:','workflow-send-review:').replaceAll('payment_instructions_delivery','workflow_client_delivery');
const messages={
 ru:{OFFER_READY:'Предложение согласовано. Откройте свой кабинет по ранее выданной ссылке, проверьте условия и выберите предложение.',PARTNER_FINAL_CONFIRMED:'Партнёр подтвердил выбранные условия. Для завершения согласования подтвердите сделку в своём кабинете.',PARTNER_FINAL_DECLINED:'Партнёр не подтвердил выбранные условия. Оператору передана задача подобрать альтернативу.',CLIENT_BOOKING_CONFIRMED:'Ваше подтверждение сделки сохранено. Реквизиты партнёра для перевода будут отправлены после проверки оператором.',PAYMENT_VERIFIED:'Оператор проверил и зачёл перевод. Зачтённая сумма, остаток и статус доступны в вашем кабинете.',PAYMENT_REJECTED:'Оператор не подтвердил перевод. Проверьте подтверждение и свяжитесь с оператором для уточнения.',SERVICE_IN_PROGRESS:'В PCS зарегистрировано начало оказания услуги.',COMPLETED:'В PCS зарегистрировано завершение услуги.'},
 en:{OFFER_READY:'An offer has been approved. Open your portal using your saved personal link, review the terms and select the offer.',PARTNER_FINAL_CONFIRMED:'The partner confirmed the selected terms. Please give your final confirmation in your portal.',PARTNER_FINAL_DECLINED:'The partner did not confirm the selected terms. The operator has been asked to find an alternative.',CLIENT_BOOKING_CONFIRMED:'Your final confirmation has been saved. Partner payment details will be sent after the operator checks them.',PAYMENT_VERIFIED:'The operator verified and credited the transfer. Your current balance and payment status are available in your portal.',PAYMENT_REJECTED:'The operator did not verify the transfer. Check your confirmation and contact the operator.',SERVICE_IN_PROGRESS:'The start of service has been recorded in PCS.',COMPLETED:'Completion of service has been recorded in PCS.'},
 th:{OFFER_READY:'ข้อเสนอได้รับการอนุมัติแล้ว กรุณาเปิดพอร์ทัลด้วยลิงก์ส่วนตัวที่ได้รับ ตรวจสอบเงื่อนไขและเลือกข้อเสนอ',PARTNER_FINAL_CONFIRMED:'ผู้ให้บริการยืนยันเงื่อนไขแล้ว กรุณายืนยันขั้นสุดท้ายในพอร์ทัล',PARTNER_FINAL_DECLINED:'ผู้ให้บริการไม่ได้ยืนยันเงื่อนไข เจ้าหน้าที่จะหาทางเลือกอื่น',CLIENT_BOOKING_CONFIRMED:'บันทึกการยืนยันของคุณแล้ว ข้อมูลการโอนเงินให้ผู้ให้บริการจะส่งหลังจากเจ้าหน้าที่ตรวจสอบ',PAYMENT_VERIFIED:'เจ้าหน้าที่ตรวจสอบและบันทึกยอดโอนแล้ว ดูยอดคงเหลือและสถานะในพอร์ทัล',PAYMENT_REJECTED:'เจ้าหน้าที่ยังไม่ยืนยันยอดโอน กรุณาตรวจสอบหลักฐานและติดต่อเจ้าหน้าที่',SERVICE_IN_PROGRESS:'PCS บันทึกการเริ่มให้บริการแล้ว',COMPLETED:'PCS บันทึกการให้บริการเสร็จสิ้นแล้ว'}
};
export function workflowDeliveryText(p,language='ru'){
 const lang=String(language).toLowerCase(),dictionary=messages[lang.startsWith('th')?'th':lang.startsWith('en')?'en':'ru'];
 if(!dictionary[p.kind])throw Error('workflow_kind_invalid');
 let text=`PCS · ${p.public_id||'PCS'}\n${dictionary[p.kind]}`;
 if(p.kind==='OFFER_READY'){
  if(!/^\d+(?:\.\d{1,2})?$/.test(p.price||'')||Number(p.price)<=0||typeof p.terms!=='string'||!p.terms.trim())throw Error('workflow_offer_invalid');
  text+=`\n${p.price} THB${/^\d+(?:\.\d{1,2})?$/.test(p.deposit||'')?`\n${lang.startsWith('en')?'Refundable deposit':lang.startsWith('th')?'เงินประกันคืนได้':'Возвратный депозит'}: ${p.deposit} THB`:''}\n${p.terms}`;
 }
 return text;
}
export async function dispatchWorkflowDelivery(biz,db,transport){return dispatchPaymentInstructions(biz,db,transport,{enqueue:enqueueWorkflowDelivery,claim:claimWorkflowDelivery,current:currentWorkflowDelivery,finish:finishWorkflowDelivery,text:workflowDeliveryText});}
