import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('./neon-adapter.js',import.meta.url),'utf8');
const writes=[];
let applications=[];
const catalog=[{id:'car-1',title:'Ford Fiesta',status:'available',category:'car_rent',base_price_period:'day'}];
const context={console,URL,URLSearchParams,Response,Headers,Request,JSON,window:null,localStorage:{pcsToken:'test'}};
context.window=context;
context.fetch=async(input,init={})=>{
  const op=new URL(input).searchParams.get('op');
  const body=init.body?JSON.parse(init.body):{};
  if(op==='catalog')return Response.json(catalog);
  if(op==='applications')return Response.json(applications);
  if(op==='application-detail')return Response.json(applications.find(x=>x.id===new URL(input).searchParams.get('id'))||{}, {status:applications.some(x=>x.id===new URL(input).searchParams.get('id'))?200:404});
  if(op==='application-conflict'){const u=new URL(input),item=u.searchParams.get('item'),exclude=u.searchParams.get('exclude'),start=u.searchParams.get('start'),end=u.searchParams.get('end');return Response.json({conflict:applications.some(x=>x.id!==exclude&&x.item_id===item&&!['CANCELLED_BY_CLIENT','COMPLETED'].includes(x.operational_status)&&x.qualification_data?.start_date<end&&x.qualification_data?.end_date>start)});}
  if(op==='clients')return Response.json([{id:'client-1',name:'Тестовый клиент',phone:'+66000000000'}]);
  if(op==='application-save'){writes.push(body);const saved={...body,id:'booking-1'};applications=[saved];return Response.json({ok:true,id:saved.id});}
  if(op==='application-status'){const row=applications.find(x=>x.id===body.id);if(row)row.operational_status=body.status;return Response.json({ok:true});}
  throw new Error('Unexpected manager operation '+op);
};
vm.createContext(context);vm.runInContext(source,context);
const post=body=>context.fetch('https://pcs-stable.local/pcs-ops-api/reservations',{method:'POST',body:JSON.stringify(body)});
const valid={catalog_item_id:'car-1',contact_id:'client-1',status:'hold',start_date:'2026-12-20',end_date:'2026-12-21',total_amount:300,deposit_amount:0,currency:'THB'};
assert.equal((await post(valid)).status,200);
assert.equal(writes[0].operational_status,'AWAITING_PARTNER_CONFIRMATION');
assert.equal(writes[0].client_name,'Тестовый клиент');
assert.equal(writes[0].qualification_data.contact_id,'client-1');
assert.equal((await context.fetch('https://pcs-stable.local/pcs-ops-api/reservations')).status,200);
const patch=await context.fetch('https://pcs-stable.local/pcs-ops-api/reservations/booking-1',{method:'PATCH',body:JSON.stringify({status:'confirmed'})});
assert.equal(patch.status,200);assert.equal(applications[0].operational_status,'CONFIRMED');
applications.push({id:'cancelled-booking',category:'booking',operational_status:'CANCELLED_BY_CLIENT',qualification_data:{start_date:'2026-12-20',end_date:'2026-12-22'}});
const calendar=await context.fetch('https://pcs-stable.local/pcs-ops-api/calendar?from=2026-12-01&to=2026-12-31');
assert.equal(calendar.status,200,'calendar route must be available');
const calendarRows=await calendar.json();
assert.equal(calendarRows.some(x=>x.id==='booking-1'&&x.status==='confirmed'),true,'confirmed reservations must appear in the calendar');
assert.equal(calendarRows.some(x=>x.id==='cancelled-booking'),false,'cancelled reservations must not occupy calendar dates');
const edit=await context.fetch('https://pcs-stable.local/pcs-ops-api/reservations/booking-1',{method:'PATCH',body:JSON.stringify({...valid,start_date:'2026-12-22',end_date:'2026-12-24',total_amount:600,deposit_amount:100,notes:'Новые условия'})});
assert.equal(edit.status,200);
assert.equal(applications[0].operational_status,'AWAITING_PARTNER_CONFIRMATION','changed dates require reconfirmation');
assert.equal(applications[0].qualification_data.total_amount,600);
assert.equal(applications[0].internal_notes,'Новые условия');
assert.equal(applications[0].qualification_data.contact_id,'client-1');
const writeCount=writes.length;
applications.push({id:'blocking',item_id:'car-1',operational_status:'CONFIRMED',qualification_data:{start_date:'2026-12-25',end_date:'2026-12-27'}});
const conflictEdit=await context.fetch('https://pcs-stable.local/pcs-ops-api/reservations/booking-1',{method:'PATCH',body:JSON.stringify({...valid,start_date:'2026-12-26',end_date:'2026-12-28'})});
assert.equal(conflictEdit.status,409);
assert.equal(writes.length,writeCount,'conflicting edit must not be saved');
applications=[{id:'blocking',item_id:'car-1',operational_status:'AWAITING_PARTNER_CONFIRMATION',qualification_data:{start_date:'2026-12-24',end_date:'2026-12-26'}}];
assert.equal((await post({...valid,start_date:'2026-12-25',end_date:'2026-12-27'})).status,409);
assert.equal((await post({...valid,start_date:'2026-12-26',end_date:'2026-12-27'})).status,200,'end-exclusive handover must remain bookable');
catalog[0].status='requires_confirmation';
assert.equal((await post({...valid,start_date:'2027-01-01',end_date:'2027-01-02'})).status,409);
catalog[0].status='available';catalog[0].base_price_period='one_time';
assert.equal((await post({...valid,start_date:'2027-01-01',end_date:'2027-01-02'})).status,409,'sale items must not enter the rental booking flow');

console.log('booking route checks passed');
