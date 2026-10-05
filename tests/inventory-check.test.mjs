import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryParams,assessInventory,checkInventory,inventoryQuery} from '../server/supabase/pcs-manager-live2/inventory-check.mjs';
const id='11111111-1111-4111-8111-111111111111';
const params=inventoryParams(id,'2026-10-10','2026-10-20');
const data=()=>({checked_at:'2026-10-05T00:00:00Z',item:{id,title:'Car',entity_type:'VEHICLE',publication_status:'PUBLISHED',moderation_status:'APPROVED',availability_status:'AVAILABLE'},periods:[{starts_at:'2026-10-10T00:00:00+07:00',ends_at:'2026-10-20T00:00:00+07:00',status:'AVAILABLE',confirmed_at:'2026-10-04T00:00:00Z',quantity:1}],bookings:[]});
test('inventory validates real calendar dates, exact identity and exclusive end',()=>{
 assert.equal(params.start_at,'2026-10-10T00:00:00+07:00');
 for(const args of [['bad','2026-10-10','2026-10-20'],[id,'2026-02-30','2026-03-01'],[id,'2026-10-20','2026-10-10'],[id,'2026-10-10','2026-10-10']])assert.throws(()=>inventoryParams(...args),e=>e.status===400);
});
test('full confirmed period is available, adjacent bookings do not overlap, cancelled bookings do not block',()=>{
 const d=data();d.bookings=[{operational_status:'CONFIRMED',start_date:'2026-10-01',end_date:'2026-10-10'},{operational_status:'CANCELLED_BY_CLIENT',start_date:'2026-10-10',end_date:'2026-10-20'}];assert.equal(assessInventory(d,params).status,'available');
});
test('overlap, hold and blocked periods defeat a free period',()=>{
 for(const bookingStatus of ['CONFIRMED','SERVICE_IN_PROGRESS','AWAITING_PARTNER_CONFIRMATION']){const d=data();d.bookings=[{operational_status:bookingStatus,start_date:'2026-10-19',end_date:'2026-10-21'}];assert.equal(assessInventory(d,params).status,'conflict');}
 for(const status of ['UNAVAILABLE','BOOKED','BLOCKED','HOLD','HELD']){const d=data();d.periods.push({...d.periods[0],status});assert.equal(assessInventory(d,params).status,'conflict');}
});
test('missing dates, unconfirmed periods, gaps, quantities and shared service capacity require confirmation',()=>{
 const mutations=[d=>d.periods=[],d=>d.periods[0].confirmed_at=null,d=>d.periods[0].starts_at='2026-10-11T00:00:00+07:00',d=>d.periods[0].quantity=0,d=>d.periods[0].quantity=10,d=>d.item.entity_type='SERVICE',d=>d.item.availability_status='REQUIRES_CONFIRMATION',d=>d.bookings=[{operational_status:'CONFIRMED',start_date:'2026-02-30',end_date:'2026-03-01'}],d=>d.periods=Array(201).fill(d.periods[0])];
 for(const mutate of mutations){const d=data();mutate(d);assert.equal(assessInventory(d,params).status,'confirmation_required');}
});
test('contiguous free intervals cover dates, expired holds are ignored, an actual gap remains uncertain',()=>{
 const d=data(),p=d.periods[0];d.periods=[{...p,ends_at:'2026-10-15T00:00:00+07:00'},{...p,starts_at:'2026-10-15T00:00:00+07:00'},{...p,status:'HELD',hold_until:'2026-10-04T00:00:00Z'}];assert.equal(assessInventory(d,params).status,'available');d.periods[1].starts_at='2026-10-16T00:00:00+07:00';assert.equal(assessInventory(d,params).status,'confirmation_required');
});
test('hidden or unapproved items cannot be offered even if periods are free',()=>{
 for(const [k,v] of [['publication_status','ARCHIVED'],['moderation_status','PENDING'],['availability_status','UNAVAILABLE'],['publication_ends_at','2026-10-04T00:00:00Z']]){const d=data();d.item[k]=v;assert.equal(assessInventory(d,params).status,'unavailable');}
});
test('canonical read parameterizes date boundaries, hides client details and propagates source failure',async()=>{
 let call;const result=await checkInventory({query:async(q,p)=>{call={q,p};return[{data:data()}]}},id,params.start,params.end);assert.equal(result.status,'available');assert.equal(call.p[0],id);assert.equal(call.p[1],params.start_at);assert.match(inventoryQuery,/category='booking'.*operational_status<>all/);assert.doesNotMatch(inventoryQuery,/client_contact|client_name|internal_notes|update |insert /i);
 await assert.rejects(()=>checkInventory({query:async()=>[]},id,params.start,params.end),e=>e.status===404);
 await assert.rejects(()=>checkInventory({query:async()=>{throw Error('Unavailable')}},id,params.start,params.end),/Unavailable/);
});
