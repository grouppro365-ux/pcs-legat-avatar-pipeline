import {terminalApplicationStatuses} from './operations-read.mjs';
export const followupReminderQuery=`with due as materialized (
 select a.id,a.public_id,a.follow_up_at,'application-followup:'||a.id::text||':'||md5(extract(epoch from a.follow_up_at)::text) dedupe_key
 from applications a where a.follow_up_at<=now() and a.operational_status<>all($1::text[]) and not exists(
 select 1 from notifications n where n.dedupe_key='application-followup:'||a.id::text||':'||md5(extract(epoch from a.follow_up_at)::text))
 order by a.follow_up_at,a.id limit 50 for update of a skip locked
 ),created as (
 insert into notifications(event_key,entity_type,entity_id,channel,title,body,status,dedupe_key)
 select 'application.followup_due','applications',id::text,'IN_APP','Повторный контакт: '||coalesce(public_id,'Заявка PCS'),
 'Наступил срок повторного контакта: '||to_char(follow_up_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS')||' UTC. Откройте заявку и проверьте текущие условия.','PENDING',dedupe_key from due
 on conflict(dedupe_key) do nothing returning id,entity_id,dedupe_key
 ),audited as (
 insert into audit_events(actor_role,action,entity_type,entity_id,patch,reason,result)
 select 'SYSTEM','followup_reminder_created','notifications',n.id::text,jsonb_build_object('application_id',n.entity_id,'follow_up_at',d.follow_up_at),'Scheduled in-app operator reminder','SUCCESS'
 from created n join due d on d.dedupe_key=n.dedupe_key returning entity_id
 ) select count(*)::int created from created n where exists(select 1 from audited a where a.entity_id=n.id::text)`;
export async function createFollowupReminders(biz){const rows=await biz.query(followupReminderQuery,[terminalApplicationStatuses]),created=rows[0]?.created;if(!Number.isInteger(created)||created<0||created>50)throw Error('reminder_receipt_invalid');return {ok:true,created,channel:'IN_APP',client_messages_sent:0};}
const equal=(a,b)=>{if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;};
export async function internalFollowupReminders(req,{base,key,biz},transport=fetch){
 if(req.method!=='POST')return {status:405,body:{error:'method_not_allowed'}};
 const supplied=req.headers.get('x-pcs-internal-secret');if(!supplied)return {status:401,body:{error:'unauthorized'}};
 try{const r=await transport(base+'/rest/v1/rpc/pcs_secret_get',{method:'POST',headers:{apikey:key,authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({p_name:'internal_retry_secret'}),signal:AbortSignal.timeout(10000)});
  if(!r.ok)return {status:503,body:{error:'worker_unavailable'}};if(!equal(supplied,await r.json()))return {status:401,body:{error:'unauthorized'}};
  return {status:200,body:await createFollowupReminders(biz)};
 }catch{return {status:503,body:{error:'worker_unavailable'}};}
}
