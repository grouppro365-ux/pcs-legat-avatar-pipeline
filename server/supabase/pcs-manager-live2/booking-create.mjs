import {CrmError} from './crm-policy.mjs';
import {calendarDate} from './inventory-check.mjs';
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
export function bookingDatabaseError(error){
 if(error?.code==='23P01'&&error.constraint==='vehicle_booking_no_overlap')return new CrmError('На эти даты уже есть бронь или холд. Обновите календарь и выберите другой период.',409);
 if(error?.code==='22023'&&error.message==='booking_dates_invalid')return new CrmError('Проверьте даты аренды: начало и окончание должны быть корректными датами.',400);
 return null;
}
export async function createBooking(biz,b,uploadPhoto){
 if(!uuid(b.request_id)||b.id||b.category!=='booking')throw new CrmError('Некорректный номер запроса создания брони',400);
 const dates=b.qualification_data||{};if(!uuid(b.item_id)||!calendarDate(dates.start_date)||!calendarDate(dates.end_date)||dates.end_date<=dates.start_date)throw new CrmError('Укажите автомобиль и корректные даты: окончание позже начала.',400);
 const q={...dates};delete q.booking_idempotency_key;delete q.booking_request_hash;
 const input={item_id:b.item_id||null,client_name:b.client_name||null,client_contact:b.client_contact||null,category:'booking',city:b.city||null,operational_status:b.operational_status||'NEW',priority:b.priority||'NORMAL',client_visible_notes:b.client_visible_notes||null,internal_notes:b.internal_notes||null,qualification_data:q,photo:b.photo||null};
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(stable(input))))),x=>x.toString(16).padStart(2,'0')).join('');
 const receipt=async()=>{const rows=await biz.query("select id,public_id,qualification_data->>'booking_request_hash' request_hash from applications where category='booking' and qualification_data->>'booking_idempotency_key'=$1 limit 1",[b.request_id]);if(!rows.length)return null;if(rows[0].request_hash!==hash)throw new CrmError('Этот запрос уже использован для другой брони. Обновите форму перед сохранением.',409);return{ok:true,id:rows[0].id,public_id:rows[0].public_id,replayed:true};};
 const previous=await receipt();if(previous)return previous;
 if(b.photo?.content_base64){const up=await uploadPhoto(b.photo);q.photo_url=up.url;q.photo_name=b.photo.filename||null;q.photo_content_type=b.photo.content_type||null;}
 q.booking_idempotency_key=b.request_id;q.booking_request_hash=hash;
 const id=crypto.randomUUID(),publicId='APP-'+Date.now().toString(36).toUpperCase()+'-'+id.slice(0,8).toUpperCase();
 const rows=await biz.query(`insert into applications(id,public_id,client_name,client_contact,category,city,item_id,operational_status,priority,client_visible_notes,internal_notes,qualification_data,created_at,updated_at)
 values($1::uuid,$2,$3,$4,'booking',$5,$6::uuid,$7,$8,$9,$10,$11::jsonb,now(),now())
 on conflict ((qualification_data->>'booking_idempotency_key')) where category='booking' and qualification_data->>'booking_idempotency_key' is not null do nothing returning id,public_id`,[id,publicId,input.client_name,input.client_contact,input.city,input.item_id,input.operational_status,input.priority,input.client_visible_notes,input.internal_notes,JSON.stringify(q)]);
 if(rows.length)return{ok:true,id:rows[0].id,public_id:rows[0].public_id,replayed:false};
 const saved=await receipt();if(saved)return saved;throw new CrmError('Результат сохранения пока не подтверждён. Повторите с той же формой.',409);
}
