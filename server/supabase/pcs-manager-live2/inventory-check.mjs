import {CrmError} from './crm-policy.mjs';
import {terminalApplicationStatuses} from './operations-read.mjs';
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
export function calendarDate(value){
 return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
}
export function inventoryParams(id,start,end){
 if(!uuid(id)||!calendarDate(start)||!calendarDate(end)||end<=start)throw new CrmError('Укажите карточку и корректные даты: окончание позже начала',400);
 return {id,start,end,start_at:start+'T00:00:00+07:00',end_at:end+'T00:00:00+07:00'};
}
export const inventoryQuery=`select jsonb_build_object('item',jsonb_build_object('id',c.id,'title',c.title,'entity_type',c.entity_type,'availability_status',c.availability_status,'publication_status',c.publication_status,'moderation_status',c.moderation_status,'publication_starts_at',c.publication_starts_at,'publication_ends_at',c.publication_ends_at), 'checked_at',now(),
 'periods',coalesce((select jsonb_agg(p) from (select starts_at,ends_at,status,quantity,confirmed_at,hold_until from availability_periods where item_id=c.id and (starts_at is null or ends_at is null or (starts_at<$3::timestamptz and ends_at>$2::timestamptz)) order by starts_at,id limit 201)p),'[]'::jsonb),
 'bookings',coalesce((select jsonb_agg(b) from (select operational_status,qualification_data->>'start_date' start_date,qualification_data->>'end_date' end_date from applications where item_id=c.id and category='booking' and operational_status<>all($4::text[]) order by created_at,id limit 201)b),'[]'::jsonb)) data from catalog_items c where c.id=$1 limit 1`;
export function assessInventory(data,params){
 const item=data.item,now=Date.parse(data.checked_at),start=Date.parse(params.start_at),end=Date.parse(params.end_at);
 const result=(status,reason)=>({status,reason,item:{id:item.id,title:item.title},start:params.start,end:params.end,timezone:'Asia/Bangkok',checked_at:data.checked_at});
 if(item.publication_status!=='PUBLISHED'||item.moderation_status!=='APPROVED'||item.availability_status==='UNAVAILABLE'||(item.publication_starts_at&&Date.parse(item.publication_starts_at)>now)||(item.publication_ends_at&&Date.parse(item.publication_ends_at)<=now))return result('unavailable','Карточка недоступна для предложения клиенту.');
 let uncertain=!Number.isFinite(now)||data.periods.length>200||data.bookings.length>200;
 for(const b of data.bookings){
  if(terminalApplicationStatuses.includes(b.operational_status))continue;
  if(!calendarDate(b.start_date)||!calendarDate(b.end_date)||b.end_date<=b.start_date){uncertain=true;continue;}
  if(b.start_date<params.end&&b.end_date>params.start)return result('conflict','На выбранные даты есть активная бронь. Требуется другой вариант или проверка оператором.');
 }
 const intervals=[];
 for(const p of data.periods){
  const a=Date.parse(p.starts_at),b=Date.parse(p.ends_at);
  if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a){uncertain=true;continue;}
  if(a>=end||b<=start)continue;
  if(['HOLD','HELD'].includes(p.status)&&p.hold_until&&Date.parse(p.hold_until)<=now)continue;
  if(['UNAVAILABLE','BOOKED','BLOCKED','HOLD','HELD'].includes(p.status))return result('conflict','Период занят, заблокирован или находится на удержании.');
  if(p.status!=='AVAILABLE'||!Number.isFinite(Date.parse(p.confirmed_at))||p.quantity===0){uncertain=true;continue;}
  if(p.quantity!==null&&p.quantity!==undefined&&p.quantity!==1){uncertain=true;continue;}
  intervals.push([Math.max(a,start),Math.min(b,end)]);
 }
 let covered=start;for(const [a,b] of intervals.sort((x,y)=>x[0]-y[0])){if(a>covered)break;covered=Math.max(covered,b);}
 // Periods do not establish shared service capacity, quantities or partner confirmation.
 if(!['CAR','VEHICLE','PROPERTY','REAL_ESTATE'].includes(item.entity_type)||item.availability_status!=='AVAILABLE'||uncertain||covered<end)return result('confirmation_required','Наличие на весь период не подтверждено. Уточните даты и доступность у ответственного или партнёра.');
 return result('available','В сохранённых данных весь период отмечен свободным. Перед оформлением брони повторите проверку: она не резервирует объект.');
}
export async function checkInventory(biz,id,start,end){
 const params=inventoryParams(id,start,end),rows=await biz.query(inventoryQuery,[id,params.start_at,params.end_at,terminalApplicationStatuses]);
 if(!rows.length)throw new CrmError('Карточка не найдена',404);
 const data=rows[0].data;if(!data?.item||!Array.isArray(data.periods)||!Array.isArray(data.bookings))throw new CrmError('Не удалось получить данные наличия',503);
 return assessInventory(data,params);
}
