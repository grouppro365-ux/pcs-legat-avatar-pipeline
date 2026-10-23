import {CrmError} from './crm-policy.mjs';
import {uuid} from './portal-workflow.mjs';
export const deliveryEventTypes=['PAYMENT_INSTRUCTIONS_READY','CLIENT_WORKFLOW_NOTICE_READY','CLIENT_FOLLOWUP_READY'];
export const workflowDeliveryList=`select e.id,e.aggregate_id application_id,a.public_id,e.event_type,
 e.payload->>'kind' kind,e.payload->>'channel' channel,e.payload->>'contact_id' contact_id,
 e.status,e.attempts,e.next_attempt_at,e.last_error,e.created_at,e.sent_at,
 e.payload#>>'{operator_delivery_review,decision}' operator_decision,
 e.payload#>>'{operator_delivery_review,reviewed_at}' operator_reviewed_at,
 case when $4::boolean then e.payload->>'delivery_text' end delivery_text,
 (coalesce(length(e.payload->>'delivery_text'),0)>0 and e.payload->>'channel' in ('telegram','line','whatsapp','instagram','facebook')) prepared,
 md5(to_jsonb(e)::text) edit_version
 from pcs_workflow_outbox e join applications a on a.id=e.aggregate_id
 where e.aggregate_type='APPLICATION' and e.event_type=any($1::text[])
 and ($2='all' or (e.status='CANCELLED' and e.last_error='delivery_review_required' and not(e.payload ? 'operator_delivery_review'))
 or e.status='FAILED' or (e.status='PROCESSING' and e.next_attempt_at<now()) or (e.status='PENDING' and e.next_attempt_at<now()-interval '15 minutes'))
 order by e.created_at desc,e.id desc limit 51 offset $3`;
export async function readWorkflowDeliveries(biz,view='review',page='0',canReview=false){
 if(!['review','all'].includes(view)||typeof page!=='string'||!/^\d{1,5}$/.test(page)||Number(page)>5000)throw new CrmError('Некорректный фильтр доставки',400);
 const rows=await biz.query(workflowDeliveryList,[deliveryEventTypes,view,Number(page)*50,canReview]);
 return {view,page:Number(page),limit:50,rows:rows.slice(0,50),truncated:rows.length>50,can_review:canReview};
}
export function reviewWorkflowInput(b){
 if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['id','expected_version','request_id','decision','note','confirmed'].includes(k))||!uuid(b.id)||!uuid(b.request_id)||typeof b.expected_version!=='string'||!/^[a-f0-9]{32}$/.test(b.expected_version)||!['DELIVERED','NOT_DELIVERED'].includes(b.decision)||b.confirmed!==true||typeof b.note!=='string'||b.note.trim().length<10||b.note.length>1000)throw new CrmError('Подтвердите проверку диалога и добавьте комментарий от 10 до 1000 символов',400);
 return {...b,note:b.note.trim()};
}
export const reviewWorkflowDeliveryQuery=`with permission as materialized (
 select $6::uuid is null or coalesce((pcs.staff_context($6::uuid)->'permissions') ? 'notifications.manage',false)
 or coalesce((pcs.staff_context($6::uuid)->'permissions') ? '*',false) allowed
 ),candidate as materialized (
 select e.*,md5(to_jsonb(e)::text) current_version,
 md5(jsonb_build_object('decision',$3::text,'note',$4::text,'expected_version',$2::text)::text) fingerprint
 from pcs_workflow_outbox e where e.id=$1::uuid and e.aggregate_type='APPLICATION'
 and e.event_type in ('PAYMENT_INSTRUCTIONS_READY','CLIENT_WORKFLOW_NOTICE_READY','CLIENT_FOLLOWUP_READY') and (select allowed from permission)
 for update
 ),written as (
 update pcs_workflow_outbox e set status=case when $3='DELIVERED' then 'SENT' else 'CANCELLED' end,
 sent_at=case when $3='DELIVERED' then clock_timestamp() else e.sent_at end,
 last_error=case when $3='NOT_DELIVERED' then 'operator_not_delivered' else null end,
 payload=e.payload||jsonb_build_object('operator_delivery_review',jsonb_build_object('method','operator_attestation','request_id',$5::uuid,'fingerprint',c.fingerprint,'decision',$3::text,'note',$4::text,'reviewed_at',clock_timestamp(),'auth_user_id',$6::uuid,
 'result',jsonb_build_object('ok',true,'id',e.id,'operator_reviewed',true,'request_id',$5::uuid,'decision',$3::text)))
 from candidate c where e.id=c.id and c.current_version=$2 and c.status='CANCELLED' and c.last_error='delivery_review_required'
 and not(c.payload ? 'operator_delivery_review') and ($3<>'DELIVERED' or (coalesce(length(c.payload->>'delivery_text'),0)>0 and c.payload->>'channel' in ('telegram','line','whatsapp','instagram','facebook'))) returning e.id,e.aggregate_id,e.payload
 ),acknowledged as (
 update notifications n set read_at=clock_timestamp() from written w where n.dedupe_key in ('payment-send-review:'||w.id::text,'workflow-send-review:'||w.id::text,'client-followup-review:'||w.id::text) and n.read_at is null returning n.id
 ),audited as (
 insert into audit_events(actor_role,action,entity_type,entity_id,patch,reason,result)
 select case when $6::uuid is null then 'ADMIN' else 'STAFF' end,'workflow_delivery_reviewed','applications',aggregate_id::text,
 jsonb_build_object('outbox_id',id,'request_id',$5::uuid,'decision',$3::text,'method','operator_attestation','auth_user_id',$6::uuid,'acknowledged_notices',(select count(*) from acknowledged)),
 'Explicit operator review of an uncertain delivery; no resend','SUCCESS' from written returning entity_id
 ) select w.payload#>'{operator_delivery_review,result}' result from written w where exists(select 1 from audited a where a.entity_id=w.aggregate_id::text)
 union all select c.payload#>'{operator_delivery_review,result}' result from candidate c
 where c.payload#>>'{operator_delivery_review,request_id}'=$5::text and c.payload#>>'{operator_delivery_review,fingerprint}'=c.fingerprint`;
export async function reviewWorkflowDelivery(biz,input,authUser=null){
 const b=reviewWorkflowInput(input);if(authUser!==null&&!uuid(authUser))throw new CrmError('Недействительная личность сотрудника',403);
 const r=(await biz.query(reviewWorkflowDeliveryQuery,[b.id,b.expected_version,b.decision,b.note,b.request_id,authUser]))[0]?.result;
 if(!r?.ok||r.id!==b.id||r.request_id!==b.request_id||r.decision!==b.decision)throw new CrmError('Попытка изменилась или проверка уже записана. Обновите очередь.',409);
 return r;
}
