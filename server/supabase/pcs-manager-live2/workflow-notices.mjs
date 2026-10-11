// Project durable deal events into the existing operator notification centre.
// External delivery remains owned by the outbox: never mark an event SENT here.
export const workflowNoticeQuery=`with due as materialized (
 select e.id,e.aggregate_id,e.event_type,a.public_id,'workflow-operator:'||e.id::text dedupe_key
 from pcs_workflow_outbox e join applications a on a.id=e.aggregate_id
 where e.aggregate_type='APPLICATION' and e.status in ('PENDING','FAILED')
 and e.event_type=any($1::text[]) and not(e.payload ? 'operator_notification_id')
 order by e.created_at,e.id limit 50 for update of e skip locked
 ),created as (
 insert into notifications(event_key,entity_type,entity_id,channel,title,body,status,dedupe_key)
 select 'workflow.operator_notice','applications',aggregate_id::text,'IN_APP',
 case event_type when 'PARTNER_OFFER_ACCEPTED' then 'Клиент выбрал предложение'
 when 'PARTNER_FINAL_CONFIRMED' then 'Партнёр подтвердил условия'
 when 'PARTNER_FINAL_DECLINED' then 'Партнёр отказался: нужна альтернатива'
 when 'CLIENT_BOOKING_CONFIRMED' then 'Сделка подтверждена: подготовить оплату' end,
 'Заявка '||coalesce(public_id,'PCS')||'. '||case event_type
 when 'PARTNER_OFFER_ACCEPTED' then 'Проверьте подтверждение выбранных условий партнёром.'
 when 'PARTNER_FINAL_CONFIRMED' then 'Проверьте финальное подтверждение клиента.'
 when 'PARTNER_FINAL_DECLINED' then 'Подберите и согласуйте альтернативное предложение.'
 when 'CLIENT_BOOKING_CONFIRMED' then 'Откройте «Кабинеты и сделка», проверьте получателя и сохраните реквизиты.' end,
 'PENDING',dedupe_key from due on conflict(dedupe_key) do nothing returning id,dedupe_key
 ),receipts as (
 select id,dedupe_key from created union all
 select n.id,n.dedupe_key from notifications n join due d on d.dedupe_key=n.dedupe_key
 ),marked as (
 update pcs_workflow_outbox e set payload=e.payload||jsonb_build_object('operator_notification_id',r.id,'operator_notified_at',clock_timestamp())
 from due d join receipts r on r.dedupe_key=d.dedupe_key where e.id=d.id returning e.id
 ),audited as (
 insert into audit_events(actor_role,action,entity_type,entity_id,patch,reason,result)
 select 'SYSTEM','workflow_operator_notice_created','notifications',n.id::text,
 jsonb_build_object('outbox_id',d.id,'application_id',d.aggregate_id,'event_type',d.event_type),
 'Existing PCS workflow event projected to operator inbox','SUCCESS'
 from created n join due d on d.dedupe_key=n.dedupe_key returning entity_id
 ) select (select count(*)::int from created where exists(select 1 from audited a where a.entity_id=created.id::text)) created,
 (select count(*)::int from marked) marked`;
export const workflowNoticeEvents=['PARTNER_OFFER_ACCEPTED','PARTNER_FINAL_CONFIRMED','PARTNER_FINAL_DECLINED','CLIENT_BOOKING_CONFIRMED'];
export async function createWorkflowNotices(biz){
 const r=(await biz.query(workflowNoticeQuery,[workflowNoticeEvents]))[0];
 if(!Number.isInteger(r?.created)||!Number.isInteger(r?.marked)||r.created<0||r.marked<r.created||r.marked>50)throw Error('workflow_notice_receipt_invalid');
 return {created:r.created,marked:r.marked,channel:'IN_APP',client_messages_sent:0};
}
