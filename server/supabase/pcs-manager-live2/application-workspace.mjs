import {CrmError} from './crm-policy.mjs';
import {terminalApplicationStatuses} from './operations-read.mjs';
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
export function applicationQueueQuery(view='active',rawPage='0',search=''){
 if(!['active','attention','followup','all'].includes(view)||typeof rawPage!=='string'||!/^\d{1,5}$/.test(rawPage)||Number(rawPage)>5000||typeof search!=='string'||search.length>120)throw new CrmError('Некорректные параметры очереди заявок',400);
 const page=Number(rawPage),q=search.trim();
 return {view,page,q,query:`select a.id,a.public_id,a.client_name,a.category,a.city,a.operational_status,a.partner_response_status,a.client_payment_status,a.priority,a.sla_due_at,a.human_review_required,a.execution_issue_status,a.follow_up_at,a.next_action_code,a.next_action_at,c.title item_title from applications a left join catalog_items c on c.id=a.item_id where
 ($1='all' or a.operational_status<>all($2::text[])) and
 ($1 not in ('attention','followup') or ($1='followup' and a.follow_up_at<=now()) or ($1='attention' and (a.sla_due_at<now() or a.human_review_required or (a.execution_issue_status is not null and a.execution_issue_status not in ('NONE','RESOLVED','CLOSED'))))) and
 ($3='' or strpos(lower(coalesce(a.public_id,'')||' '||coalesce(a.client_name,'')||' '||coalesce(a.city,'')||' '||coalesce(c.title,'')),lower($3))>0)
 order by a.updated_at desc,a.id desc limit 51 offset $4`,params:[view,terminalApplicationStatuses,q,page*50]};
}
export async function readApplicationQueue(biz,view,rawPage,search){const x=applicationQueueQuery(view,rawPage,search),rows=await biz.query(x.query,x.params);return {view:x.view,page:x.page,q:x.q,rows:rows.slice(0,50),truncated:rows.length>50};}
export async function readApplicationWorkspace(biz,id){
 if(!uuid(id))throw new CrmError('Некорректный номер заявки',400);
 const rows=await biz.query(`select a.id,a.public_id,a.client_name,a.category,a.city,a.operational_status,a.partner_response_status,a.client_payment_status,a.settlement_status,a.priority,a.sla_due_at,a.human_review_required,a.human_review_reason,a.execution_issue_status,a.execution_issue_summary,a.follow_up_at,a.follow_up_note,a.next_action_code,a.next_action_at,a.source_code,a.service_code,a.intent_code,a.language_code,a.qualification_status,a.qualification_data->>'start_date' requested_start,a.qualification_data->>'end_date' requested_end,a.qualification_data->>'total_amount' requested_total,a.qualification_data->>'currency' requested_currency,a.partner_proposal_type,a.partner_proposed_client_price_thb::text,a.partner_proposed_deposit_thb::text,a.partner_proposed_terms,a.partner_proposal_at,a.selected_partner_offer_id,a.client_selected_offer_at,c.title item_title,md5(to_jsonb(a)::text) edit_version from applications a left join catalog_items c on c.id=a.item_id where a.id=$1 limit 1`,[id]);
 if(!rows.length)throw new CrmError('Заявка не найдена',404);return {application:rows[0]};
}
export function applicationFollowupQuery(b){
 if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['id','expected_version','follow_up_at','follow_up_note'].includes(k))||!uuid(b.id)||typeof b.expected_version!=='string'||!/^[0-9a-f]{32}$/.test(b.expected_version)||!Object.hasOwn(b,'follow_up_at')||!Object.hasOwn(b,'follow_up_note'))throw new CrmError('Обновите заявку перед сохранением',400);
 const at=b.follow_up_at,note=b.follow_up_note;
 if(at!==null&&(typeof at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(at)||!Number.isFinite(Date.parse(at))||new Date(at).toISOString()!==at))throw new CrmError('Укажите корректный срок повторного контакта',400);
 if(typeof note!=='string'||note.length>4000)throw new CrmError('Комментарий не должен превышать 4000 символов',400);
 const clean=note.trim()||null;
 return {query:`with candidate as materialized (
 select a.id,a.follow_up_at,a.follow_up_note from applications a where a.id=$1::uuid and md5(to_jsonb(a)::text)=$2 and a.operational_status<>all($5::text[]) for update
 ),changed as (
 update applications a set follow_up_at=$3::timestamptz,follow_up_note=$4,updated_at=clock_timestamp() from candidate c where a.id=c.id and (c.follow_up_at is distinct from $3::timestamptz or c.follow_up_note is distinct from $4::text) returning a.*
 ),audited as (
 insert into audit_events(actor_role,action,entity_type,entity_id,patch,reason,result)
 select 'ADMIN','application_follow_up_updated','applications',a.id::text,jsonb_build_object('before',jsonb_build_object('follow_up_at',c.follow_up_at,'follow_up_note',c.follow_up_note),'after',jsonb_build_object('follow_up_at',a.follow_up_at,'follow_up_note',a.follow_up_note)),'Explicit operator follow-up schedule','SUCCESS' from changed a join candidate c on c.id=a.id returning entity_id
 ) select a.id,a.follow_up_at,a.follow_up_note,md5(to_jsonb(a)::text) edit_version from changed a where exists(select 1 from audited x where x.entity_id=a.id::text)
 union all select a.id,a.follow_up_at,a.follow_up_note,md5(to_jsonb(a)::text) edit_version from applications a join candidate c on c.id=a.id where not exists(select 1 from changed)`,params:[b.id,b.expected_version,at,clean,terminalApplicationStatuses]};
}
export async function saveApplicationFollowup(biz,b){const x=applicationFollowupQuery(b),rows=await biz.query(x.query,x.params);if(!rows.length)throw new CrmError('Заявка изменилась или завершена. Обновите карточку; ваш черновик сохранён в форме.',409);return {ok:true,application:rows[0]};}
