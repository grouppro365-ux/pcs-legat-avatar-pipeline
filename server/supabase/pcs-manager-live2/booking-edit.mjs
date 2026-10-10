import {bookableVehicle,requireBookableVehicle} from './booking-catalog.mjs';
import {CrmError} from './crm-policy.mjs';
import {validateBookingMoney} from './booking-create.mjs';
import {inventoryParams} from './inventory-check.mjs';
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const editable=['NEW','AWAITING_PARTNER_CONFIRMATION','CONFIRMED'];
const targets=[...editable,'CANCELLED_BY_CLIENT','CANCELLED_BY_PARTNER'];
const cancellations=['CANCELLED_BY_CLIENT','CANCELLED_BY_PARTNER'];
export async function validateBookingEditCatalog(biz,b,current){
 const q=b.qualification_data||{},old=current.qualification_data||{};
 if(cancellations.includes(b.operational_status)||(String(current.item_id||'').toLowerCase()===String(b.item_id||'').toLowerCase()&&old.start_date===q.start_date&&old.end_date===q.end_date))return;
 await requireBookableVehicle(biz,b.item_id);
}
export function validateBookingEditInput(b){
 const q=b.qualification_data||{};
 validateBookingMoney(q);
 inventoryParams(b.item_id,q.start_date,q.end_date);
}
export function bookingEditQuery(b,kind='edit'){
 if(!['edit','status'].includes(kind)||!b||!uuid(b.id)||typeof b.expected_version!=='string'||!b.expected_version||b.expected_version.length>100)throw new CrmError('Обновите карточку брони перед сохранением.',400);
 const status=kind==='status'?b.status:(b.operational_status||'NEW');
 if(!targets.includes(status))throw new CrmError('Некорректный статус брони',400);
 if(kind==='edit')validateBookingEditInput(b);
 const patch=kind==='status'?{}:{client_name:b.client_name||null,client_contact:b.client_contact||null,city:b.city||null,item_id:b.item_id||null,priority:b.priority||'NORMAL',client_visible_notes:b.client_visible_notes||null,internal_notes:b.internal_notes||null,qualification_data:b.qualification_data||{}};
 const columns=kind==='status'?'':`,client_name=$4::jsonb->>'client_name',client_contact=$4::jsonb->>'client_contact',city=$4::jsonb->>'city',item_id=($4::jsonb->>'item_id')::uuid,priority=$4::jsonb->>'priority',client_visible_notes=$4::jsonb->>'client_visible_notes',internal_notes=$4::jsonb->>'internal_notes',qualification_data=$4::jsonb->'qualification_data'`;
 // The locked original row supplies the before snapshot. Both writes commit or roll back together.
 const changedTerms=`(c.item_id is distinct from ($4::jsonb->>'item_id')::uuid or c.qualification_data->>'start_date' is distinct from $4::jsonb->'qualification_data'->>'start_date' or c.qualification_data->>'end_date' is distinct from $4::jsonb->'qualification_data'->>'end_date')`;
 const savedStatus=kind==='status'?'$3':`case when $3 in ('NEW','AWAITING_PARTNER_CONFIRMATION','CONFIRMED') and ${changedTerms} then 'AWAITING_PARTNER_CONFIRMATION' else $3 end`;
 const eligible=kind==='status'?'':`,eligible_item as materialized (
 select id from catalog_items where id=($4::jsonb->>'item_id')::uuid and ${bookableVehicle} and exists(select 1 from candidate c where ${changedTerms}) for update
 )`;
 const catalogGuard=kind==='status'?'':` and (not ${changedTerms} or $3 in ('CANCELLED_BY_CLIENT','CANCELLED_BY_PARTNER') or exists(select 1 from eligible_item))`;
 return {query:`with candidate as materialized (
 select id,item_id,operational_status,qualification_data,updated_at from applications where id=$1::uuid and category='booking' and updated_at::text=$2 and operational_status=any($6::text[]) for update
 )${eligible},saved as (
 update applications a set operational_status=${savedStatus},updated_at=clock_timestamp()${columns} from candidate c where a.id=c.id${catalogGuard} returning a.id,a.item_id,a.operational_status,a.qualification_data,a.updated_at
 ),audited as (
 insert into audit_events(actor_role,action,entity_type,entity_id,patch,reason,result)
 select 'ADMIN',$5,'applications',s.id::text,jsonb_build_object(
 'before',jsonb_build_object('item_id',c.item_id,'operational_status',c.operational_status,'start_date',c.qualification_data->>'start_date','end_date',c.qualification_data->>'end_date','updated_at',c.updated_at),
 'after',jsonb_build_object('item_id',s.item_id,'operational_status',s.operational_status,'start_date',s.qualification_data->>'start_date','end_date',s.qualification_data->>'end_date','updated_at',s.updated_at)),
 'Explicit PCS booking change','SUCCESS' from saved s join candidate c on c.id=s.id returning entity_id
 ) select s.id,s.operational_status,s.updated_at::text edit_version from saved s where exists(select 1 from audited a where a.entity_id=s.id::text)`,params:[b.id,b.expected_version,status,JSON.stringify(patch),kind==='status'?'booking_status_updated':'booking_updated',editable]};
}
export async function updateBooking(biz,b,kind='edit'){
 const q=bookingEditQuery(b,kind),rows=await biz.query(q.query,q.params);
 if(!rows.length)throw new CrmError('Бронь или доступность автомобиля уже изменились. Обновите карточку; введённые данные сохранены в форме.',409);
 return {ok:true,...rows[0]};
}
