// Canonical Neon applications own state; existing Supabase reservations are projections.
import {calendarDate} from './inventory-check.mjs';
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const phases={NEW:'requested',AWAITING_PARTNER_CONFIRMATION:'hold',CONFIRMED:'confirmed',SERVICE_IN_PROGRESS:'active',COMPLETED:'completed',CANCELLED:'cancelled',CANCELLED_BY_CLIENT:'cancelled',CANCELLED_BY_PARTNER:'cancelled',REJECTED:'cancelled',EXPIRED:'cancelled',FAILED:'cancelled'};
export function projectionDecision(row,application){
 if(!uuid(row?.id)||row.source!=='neon_contract_projection'||!uuid(row.catalog_item_id)||!calendarDate(row.start_date)||!calendarDate(row.end_date)||row.end_date<row.start_date||typeof row.updated_at!=='string'||!Number.isFinite(Date.parse(row.updated_at))||!['requested','hold','confirmed','active','completed','cancelled'].includes(row.status))return {review:'projection_identity_invalid'};
 if(!application)return {review:'canonical_booking_missing'};
 if(application.id!==row.id||application.category!=='booking'||application.item_id!==row.catalog_item_id||application.start_date!==row.start_date||application.end_date!==row.end_date)return {review:'booking_terms_diverged'};
 const status=Object.hasOwn(phases,application.operational_status)?phases[application.operational_status]:null;if(!status)return {review:'canonical_status_unknown'};
 return {status,changed:status!==row.status};
}
export const projectionLeaseQuery=`insert into system_settings(key,value,updated_at) values('reservation_projection_sync',jsonb_build_object('lease',$1::text,'lease_until',clock_timestamp()+interval '180 seconds','cursor',null),clock_timestamp())
 on conflict(key) do update set value=system_settings.value||jsonb_build_object('lease',$1::text,'lease_until',clock_timestamp()+interval '180 seconds'),updated_at=clock_timestamp()
 where system_settings.value->>'lease_until' is null or (system_settings.value->>'lease_until')::timestamptz<=clock_timestamp()
 returning value->>'cursor' cursor`;
export const projectionFinishQuery=`update system_settings set value=value||jsonb_build_object('cursor',$2::text,'lease',null,'lease_until',null,'last_result',$3::jsonb),updated_at=clock_timestamp() where key='reservation_projection_sync' and value->>'lease'=$1 returning key`;
export const projectionApplicationsQuery=`select id,item_id,category,operational_status,qualification_data->>'start_date' start_date,qualification_data->>'end_date' end_date,updated_at::text edit_version from applications where id=any($1::uuid[])`;
export const projectionReviewQuery=`with created as (
 insert into notifications(event_key,entity_type,entity_id,channel,title,body,status,dedupe_key)
 values('reservation.projection_review','applications',$1,'IN_APP','Проверить статус копии брони',case $2 when 'booking_terms_diverged' then 'Не совпадают автомобиль или даты.' when 'canonical_booking_missing' then 'Основная заявка не найдена.' when 'canonical_status_unknown' then 'Статус основной заявки требует проверки.' else 'В копии брони неполные данные.' end||' Сверьте основную заявку и копию брони.','PENDING','reservation-projection-review:'||$1||':'||$2||':'||md5($3))
 on conflict(dedupe_key) do nothing returning id
 ) insert into audit_events(actor_role,action,entity_type,entity_id,patch,reason,result)
 select 'SYSTEM','reservation_projection_review','notifications',id::text,jsonb_build_object('application_id',$1,'reason',$2),'Canonical reservation projection requires operator review','SUCCESS' from created`;
export async function syncReservationProjections(biz,base,key,transport=fetch){
 const lease=crypto.randomUUID();let claimed=false;
 const counts={ok:true,scanned:0,updated:0,unchanged:0,conflicts:0,review_required:0};
 try{
  const receipt=await biz.query(projectionLeaseQuery,[lease]);if(!receipt.length)return {...counts,skipped:'lease_busy'};claimed=true;
  const cursor=receipt[0].cursor;if(cursor!=null&&!uuid(cursor))throw Error('projection_cursor_invalid');
  const headers={apikey:key,authorization:'Bearer '+key};
  const u=new URL(base+'/rest/v1/pcs_reservations');u.searchParams.set('select','id,source,catalog_item_id,start_date,end_date,status,updated_at');u.searchParams.set('source','eq.neon_contract_projection');u.searchParams.set('order','id.asc');u.searchParams.set('limit','51');if(cursor)u.searchParams.set('id','gt.'+cursor);
  const response=await transport(u.toString(),{headers,signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('projection_read_failed');
  const rows=await response.json();if(!Array.isArray(rows)||rows.length>51||rows.some(r=>!uuid(r.id)))throw Error('projection_rows_invalid');
  const batch=rows.slice(0,50),ids=batch.map(r=>r.id),apps=ids.length?await biz.query(projectionApplicationsQuery,[ids]):[];
  for(let i=0;i<batch.length;i+=5)await Promise.all(batch.slice(i,i+5).map(async row=>{
   const application=apps.find(a=>a.id===row.id),decision=projectionDecision(row,application);counts.scanned++;
   if(decision.review){await biz.query(projectionReviewQuery,[row.id,decision.review,application?.edit_version||'missing']);counts.review_required++;return;}
   if(!decision.changed){counts.unchanged++;return;}
   const patch=new URL(base+'/rest/v1/pcs_reservations');patch.searchParams.set('id','eq.'+row.id);patch.searchParams.set('source','eq.neon_contract_projection');patch.searchParams.set('status','eq.'+row.status);patch.searchParams.set('updated_at','eq.'+row.updated_at);patch.searchParams.set('catalog_item_id','eq.'+row.catalog_item_id);patch.searchParams.set('start_date','eq.'+row.start_date);patch.searchParams.set('end_date','eq.'+row.end_date);patch.searchParams.set('select','id');
   const result=await transport(patch.toString(),{method:'PATCH',headers:{...headers,'content-type':'application/json',prefer:'return=representation'},body:JSON.stringify({status:decision.status,updated_at:new Date().toISOString()}),signal:AbortSignal.timeout(10000)});
   if(!result.ok)throw Error('projection_write_failed');const saved=await result.json();if(!Array.isArray(saved)||saved.length>1||saved.length===1&&saved[0].id!==row.id)throw Error('projection_receipt_invalid');
   if(saved.length)counts.updated++;else counts.conflicts++;
  }));
  const next=rows.length>50?batch.at(-1).id:null;
  const finished=await biz.query(projectionFinishQuery,[lease,next,JSON.stringify(counts)]);if(finished.length!==1)throw Error('projection_lease_lost');
  return counts;
 }catch{return {...counts,ok:false,error:'projection_unavailable',lease_pending:claimed};}
}
