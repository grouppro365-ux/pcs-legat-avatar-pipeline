import test from 'node:test';
import assert from 'node:assert/strict';
import {operationallyFree,readOperationalAvailability} from '../supabase/functions/pcs-business-runtime-v8/operational-availability.mjs';
import {assessInventory,inventoryParams} from '../server/supabase/pcs-manager-live2/inventory-check.mjs';
const start='2113-01-10',end='2113-01-12',now=Date.parse('2113-01-01T00:00:00Z');
const params=inventoryParams('11111111-1111-4111-8111-111111111111',start,end);
const item={id:params.id,title:'QA',entity_type:'VEHICLE',availability_status:'AVAILABLE',publication_status:'PUBLISHED',moderation_status:'APPROVED'};
const interval=(status='BLOCKED',extra={})=>({starts_at:start+'T00:00:00+07:00',ends_at:end+'T00:00:00+07:00',status,confirmed_at:'2113-01-01T00:00:00Z',quantity:1,...extra});
const cabinet=(bookings,periods)=>assessInventory({item,bookings,periods,checked_at:new Date(now).toISOString()},params).status;
test('bot and cabinet share Bangkok half-open calendar boundaries without truncating timestamps',()=>{
 for(const p of [interval('BLOCKED',{starts_at:'2113-01-09T17:00:00Z',ends_at:'2113-01-09T18:00:00Z'}),interval('BLOCKED',{starts_at:'2113-01-11T16:00:00Z',ends_at:'2113-01-11T17:00:00Z'})]){
  assert.equal(operationallyFree(start,end,[],[p],now),false);assert.equal(cabinet([],[p]),'conflict');
 }
 for(const p of [interval('BLOCKED',{starts_at:'2113-01-09T00:00:00+07:00',ends_at:'2113-01-10T00:00:00+07:00'}),interval('BLOCKED',{starts_at:'2113-01-12T00:00:00+07:00',ends_at:'2113-01-13T00:00:00+07:00'})]){
  assert.equal(operationallyFree(start,end,[],[p],now),true);assert.equal(cabinet([],[interval('AVAILABLE'),p]),'available');
 }
});
test('zero capacity blocks both paths and expired HOLD/HELD does not block even with zero capacity',()=>{
 const zero=interval('AVAILABLE',{quantity:0});assert.equal(operationallyFree(start,end,[],[zero],now),false);assert.equal(cabinet([],[zero]),'conflict');
 for(const status of ['HOLD','HELD']){
  const expired=interval(status,{quantity:0,hold_until:'2112-12-31T00:00:00Z'});
  assert.equal(operationallyFree(start,end,[],[expired],now),true);assert.equal(cabinet([],[interval('AVAILABLE'),expired]),'available');
  const current={...expired,hold_until:'2113-01-02T00:00:00Z'};
  assert.equal(operationallyFree(start,end,[],[current],now),false);assert.equal(cabinet([],[current]),'conflict');
 }
});
test('drafts do not reserve, active and legacy same-day bookings block, unknown states require review',()=>{
 for(const status of ['NEW','TRIAGE','MATCHING','QUOTE_READY','CANCELLED_BY_CLIENT','CANCELLED']){
  const b={operational_status:status,start_date:start,end_date:end};assert.equal(operationallyFree(start,end,[b],[],now),true);assert.equal(cabinet([b],[interval('AVAILABLE')]),'available');
 }
 for(const status of ['AWAITING_PARTNER_CONFIRMATION','CONFIRMED','SERVICE_IN_PROGRESS']){
  const b={operational_status:status,start_date:start,end_date:start};assert.equal(operationallyFree(start,end,[b],[],now),false);assert.equal(cabinet([b],[]),'conflict');
 }
 const unknown={operational_status:'UNKNOWN',start_date:start,end_date:end};assert.equal(operationallyFree(start,end,[unknown],[],now),false);assert.equal(cabinet([unknown],[interval('AVAILABLE')]),'confirmation_required');
});
test('corrupt periods, unavailable clock and overflow cannot indicate free inventory',()=>{
 for(const p of [interval('AVAILABLE',{quantity:2}),interval('AVAILABLE',{ends_at:'invalid'}),interval('AVAILABLE',{ends_at:start+'T00:00:00+07:00'}),interval('UNKNOWN')])assert.equal(operationallyFree(start,end,[],[p],now),false);
 assert.equal(operationallyFree(start,end,[],[],NaN),false);assert.equal(operationallyFree(start,end,[],Array(201).fill(interval('AVAILABLE')),now),false);
});
test('bot reads bounded parameterized records including quantity without contact data',async()=>{
 const queries=[];const sql=async(strings,...values)=>{queries.push({text:strings.join('?'),values});return[];};
 assert.equal(await readOperationalAvailability(sql,params.id,start,end),true);
 assert.equal(queries.length,2);for(const q of queries){assert.deepEqual(q.values,[params.id]);assert.match(q.text,/limit 201/);assert.doesNotMatch(q.text,/client_name|client_contact|insert |update /i);}assert.match(queries[1].text,/hold_until,quantity/);
});
