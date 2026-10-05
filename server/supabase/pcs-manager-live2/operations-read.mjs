import {CrmError} from './crm-policy.mjs';
export const terminalApplicationStatuses=['COMPLETED','CANCELLED','CANCELLED_BY_CLIENT','CANCELLED_BY_PARTNER','REJECTED','EXPIRED','FAILED'];
export const overviewQueries={
 crm:`with clock as (select now() at time zone 'UTC' instant), task_counts as (
 select count(*) filter(where completed_at is null)::int open,
 count(*) filter(where completed_at is null and due_at<(select instant from clock))::int overdue,
 count(*) filter(where completed_at is null and due_at is null)::int undated from tasks)
 select jsonb_build_object(
 'contacts',(select count(*)::int from contacts),
 'approvals',(select count(*)::int from ai_generations where status='APPROVAL_REQUIRED'),
 'tasks',(select to_jsonb(task_counts) from task_counts),
 'due_actions',(select count(*)::int from contacts where next_action_at<=(select instant from clock)),
 'attention_contacts',coalesce((select jsonb_agg(c) from (select id,name,username,next_action,next_action_at from contacts where next_action_at<=(select instant from clock) order by next_action_at,id limit 5)c),'[]'::jsonb),
 'clients',coalesce((select jsonb_agg(c) from (select id,name,username,need,priority from contacts order by updated_at desc,id limit 2)c),'[]'::jsonb),
 'attention_tasks',coalesce((select jsonb_agg(t) from (select t.id,t.contact_id,t.title,t.priority,t.assignee,t.due_at,c.name contact_name from tasks t join contacts c on c.id=t.contact_id where t.completed_at is null and t.due_at<(select instant from clock) order by t.due_at,t.id limit 5)t),'[]'::jsonb),
 'delivery_unknown',(select count(*)::int from messages where status='PROCESSING'::"MessageStatus" and (raw->'manual_send'->>'stage'='sending' or raw->'approval_send'->>'stage'='sending'))
 ) data`,
 business:`with active as (select a.id,a.public_id,a.client_name,a.category,a.operational_status,a.sla_due_at,a.human_review_required,a.execution_issue_status,a.item_id,a.created_at from applications a where a.operational_status<>all($1::text[]))
 select jsonb_build_object(
 'active_applications',(select count(*)::int from active),
 'active_bookings',(select count(*)::int from active where category='booking'),
 'sla_overdue',(select count(*)::int from active where sla_due_at<now()),
 'human_review',(select count(*)::int from active where human_review_required),
 'execution_issues',(select count(*)::int from active where execution_issue_status not in ('NONE','RESOLVED','CLOSED') and execution_issue_status is not null),
 'catalog',(select count(*)::int from catalog_items where publication_status<>'ARCHIVED'),
 'available',(select count(*)::int from catalog_items where publication_status='PUBLISHED' and moderation_status='APPROVED' and availability_status='AVAILABLE' and (publication_starts_at is null or publication_starts_at<=now()) and (publication_ends_at is null or publication_ends_at>now())),
 'catalog_review',(select count(*)::int from catalog_items where publication_status<>'ARCHIVED' and (moderation_status<>'APPROVED' or availability_status='REQUIRES_CONFIRMATION')),
 'unread_notifications',(select count(*)::int from notifications where read_at is null and recipient_partner_id is null),
 'attention_applications',coalesce((select jsonb_agg(a) from (select a.id,a.public_id,a.client_name,a.category,a.operational_status,a.sla_due_at,a.human_review_required,a.execution_issue_status from active a where a.sla_due_at<now() or a.human_review_required or (a.execution_issue_status not in ('NONE','RESOLVED','CLOSED') and a.execution_issue_status is not null) order by a.sla_due_at nulls last,a.id limit 5)a),'[]'::jsonb),
 'bookings',coalesce((select jsonb_agg(a) from (select a.id,a.public_id,a.operational_status,c.title from active a left join catalog_items c on c.id=a.item_id where a.category='booking' order by a.created_at desc,a.id limit 2)a),'[]'::jsonb)
 ) data`
};
export async function readOperationalOverview(op,biz,base,key,transport=fetch){
 const results=await Promise.allSettled([
  op.query(overviewQueries.crm),biz.query(overviewQueries.business,[terminalApplicationStatuses]),
  (async()=>{const url=new URL(base+'/rest/v1/pcs_failed_jobs');url.searchParams.set('select','id');url.searchParams.set('resolved_at','is.null');url.searchParams.set('limit','1');
   const r=await transport(url.toString(),{headers:{apikey:key,authorization:'Bearer '+key,prefer:'count=exact'},signal:AbortSignal.timeout(10000)});
   if(!r.ok)throw Error('runtime_unavailable');const range=r.headers.get('content-range'),count=range?.match(/\/(\d+)$/)?.[1];if(count===undefined)throw Error('runtime_count_missing');return{unresolved_jobs:Number(count)};})()
 ]);
 const sections={};for(const [i,name] of ['crm','business','runtime'].entries()){
  const r=results[i];if(r.status==='fulfilled'){
   const data=i<2?r.value?.[0]?.data:r.value;
   if(data&&typeof data==='object'&&!Array.isArray(data))sections[name]={data};else sections[name]={error:'Некорректный ответ источника. Обновите страницу.'};
  }else sections[name]={error:'Источник временно недоступен. Обновите страницу.'};
 }
 return{generated_at:new Date().toISOString(),sections};
}
export async function readNotifications(biz,view='unread',rawPage='0'){
 if(!['unread','all'].includes(view)||!/^\d{1,5}$/.test(rawPage)||Number(rawPage)>5000)throw new CrmError('Некорректный фильтр уведомлений',400);
 const page=Number(rawPage),rows=await biz.query(`select id,event_key,entity_type,entity_id,title,body,status,read_at,created_at from notifications where recipient_partner_id is null and ($1='all' or read_at is null) order by created_at desc,id desc limit 51 offset $2`,[view,page*50]);
 return{view,page,rows:rows.slice(0,50),truncated:rows.length>50};
}
export async function readOperationalApplication(biz,id){
 if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new CrmError('Некорректный номер заявки',400);
 const rows=await biz.query('select id,public_id,client_name,category,operational_status,sla_due_at,human_review_required,human_review_reason,execution_issue_status,execution_issue_summary,next_action_code,next_action_at from applications where id=$1 limit 1',[id]);
 if(!rows.length)throw new CrmError('Заявка не найдена',404);return{application:rows[0]};
}

export async function readDueActions(op,rawPage='0'){
 if(typeof rawPage!=='string'||!/^\d{1,5}$/.test(rawPage)||Number(rawPage)>5000)throw new CrmError('Некорректная страница действий',400);
 const page=Number(rawPage),rows=await op.query(`select id,name,username,next_action,next_action_at from contacts where next_action_at<=now() at time zone 'UTC' order by next_action_at,id limit 51 offset $1`,[page*50]);
 return {page,rows:rows.slice(0,50),truncated:rows.length>50};
}
