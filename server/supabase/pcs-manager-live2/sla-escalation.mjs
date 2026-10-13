import {terminalApplicationStatuses} from './operations-read.mjs';
export const slaEscalationQuery=`with due as materialized (
 select a.id,a.public_id,a.sla_due_at,a.human_review_required,
 'application-sla:'||a.id::text||':'||md5(extract(epoch from a.sla_due_at)::text) dedupe_key
 from applications a where a.sla_due_at<=now() and a.operational_status<>all($1::text[])
 and not exists(select 1 from notifications n where n.dedupe_key='application-sla:'||a.id::text||':'||md5(extract(epoch from a.sla_due_at)::text))
 order by a.sla_due_at,a.id limit 50 for update of a skip locked
 ),created as (
 insert into notifications(event_key,entity_type,entity_id,channel,title,body,status,dedupe_key)
 select 'application.sla_overdue','applications',id::text,'IN_APP','Просрочен срок заявки: '||coalesce(public_id,'PCS'),
 'Заданный срок '||to_char(sla_due_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS')||' UTC истёк. Заявка требует проверки оператором.','PENDING',dedupe_key
 from due on conflict(dedupe_key) do nothing returning id,entity_id,dedupe_key
 ),flagged as (
 update applications a set human_review_required=true,updated_at=clock_timestamp()
 from due d join created n on n.entity_id=d.id::text where a.id=d.id and a.human_review_required is not true returning a.id
 ),audited as (
 insert into audit_events(actor_role,action,entity_type,entity_id,patch,reason,result)
 select 'SYSTEM','application_sla_escalated','applications',d.id::text,
 jsonb_build_object('notification_id',n.id,'sla_due_at',d.sla_due_at,'human_review_required_before',d.human_review_required,'human_review_flag_changed',exists(select 1 from flagged f where f.id=d.id)),
 'Existing application deadline expired; internal escalation only','SUCCESS'
 from created n join due d on d.id::text=n.entity_id returning entity_id
 ) select count(*)::int created from created n where exists(select 1 from audited a where a.entity_id=n.entity_id)`;
export async function createSlaEscalations(biz){
 const created=(await biz.query(slaEscalationQuery,[terminalApplicationStatuses]))[0]?.created;
 if(!Number.isInteger(created)||created<0||created>50)throw Error('sla_escalation_receipt_invalid');
 return {created,channel:'IN_APP',client_messages_sent:0};
}
