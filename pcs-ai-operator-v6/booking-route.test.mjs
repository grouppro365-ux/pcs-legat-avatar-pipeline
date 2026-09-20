import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('./neon-adapter.js',import.meta.url),'utf8');
const writes=[];
let applications=[];
const catalog=[{id:'car-1',title:'Ford Fiesta',status:'available'}];
const context={console,URL,URLSearchParams,Response,Headers,Request,JSON,window:null,localStorage:{pcsToken:'test'}};
context.window=context;
context.fetch=async(input,init={})=>{
  const op=new URL(input).searchParams.get('op');
  const body=init.body?JSON.parse(init.body):{};
  if(op==='catalog')return Response.json(catalog);
  if(op==='applications')return Response.json(applications);
  if(op==='clients')return Response.json([]);
  if(op==='application-save'){writes.push(body);const saved={...body,id:'booking-1'};applications=[saved];return Response.json({ok:true,id:saved.id});}
  if(op==='application-status'){const row=applications.find(x=>x.id===body.id);if(row)row.operational_status=body.status;return Response.json({ok:true});}
  throw new Error('Unexpected manager operation '+op);
};
vm.createContext(context);vm.runInContext(source,context);
const post=body=>context.fetch('https://pcs-stable.local/pcs-ops-api/reservations',{method:'POST',body:JSON.stringify(body)});
const valid={catalog_item_id:'car-1',status:'hold',start_date:'2026-12-20',end_date:'2026-12-21',total_amount:300,deposit_amount:0,currency:'THB'};
assert.equal((await post(valid)).status,200);
assert.equal(writes[0].operational_status,'AWAITING_PARTNER_CONFIRMATION');
assert.equal((await context.fetch('https://pcs-stable.local/pcs-ops-api/reservations')).status,200);
const patch=await context.fetch('https://pcs-stable.local/pcs-ops-api/reservations/booking-1',{method:'PATCH',body:JSON.stringify({status:'confirmed'})});
assert.equal(patch.status,200);assert.equal(applications[0].operational_status,'CONFIRMED');
applications=[{id:'blocking',item_id:'car-1',operational_status:'AWAITING_PARTNER_CONFIRMATION',qualification_data:{start_date:'2026-12-24',end_date:'2026-12-26'}}];
assert.equal((await post({...valid,start_date:'2026-12-25',end_date:'2026-12-27'})).status,409);
assert.equal((await post({...valid,start_date:'2026-12-26',end_date:'2026-12-27'})).status,200,'end-exclusive handover must remain bookable');
catalog[0].status='requires_confirmation';
assert.equal((await post({...valid,start_date:'2027-01-01',end_date:'2027-01-02'})).status,409);

console.log('booking route checks passed');
