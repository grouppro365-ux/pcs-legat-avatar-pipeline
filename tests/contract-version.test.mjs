import test from 'node:test';
import assert from 'node:assert/strict';
import {carryVersionFields} from '../server/supabase/pcs-contract-api/version-policy.mjs';

function fixture(){
 const context={catalog_item_id:'car-1',contact_id:'person-1',client_name:'Test Person',client_contact:'+66 123 4567'};
 return {
  fresh:{renter:{name:'Test Person',phone:'+66 123 4567',id_or_passport:'',license_no:''},vehicle:{model:'Car',registration_no:'',color:''},rental:{start_date:'2026-10-01',end_date:'2026-10-05',start_time:'',end_time:'',remark:''},pricing:{total:9000,deposit:5000},handover:{fuel_level:'',condition_note:'',equipment:'',generation_context:{...context}}},
  previous:{status:'signed',renter_data:{name:'Test Person',phone:'+661234567',id_or_passport:'TEST-PASSPORT',license_no:'TEST-LICENSE'},vehicle_data:{model:'Old title',registration_no:'TEST-PLATE',color:'Blue'},rental_data:{start_date:'2026-10-01',end_date:'2026-10-05',start_time:'10:00',end_time:'15:00',remark:'Reviewed note'},pricing_snapshot:{total:1},handover_data:{generation_context:{...context},fuel_level:'Full',signature_confirmation:{method:'operator_attestation'},handover_confirmation:{method:'operator_attestation'}},signed_copy_path:'old-scan',signed_at:'2026-10-01'}
 };
}
test('same client and vehicle retain missing reviewed fields with fresh financial data',()=>{
 const {fresh,previous}=fixture();const result=carryVersionFields(fresh,previous);
 assert.equal(result.renter.id_or_passport,'TEST-PASSPORT');assert.equal(result.renter.license_no,'TEST-LICENSE');
 assert.equal(result.vehicle.registration_no,'TEST-PLATE');assert.equal(result.vehicle.model,'Car');
 assert.equal(result.rental.start_time,'10:00');assert.equal(result.handover.fuel_level,'Full');
 assert.equal(result.pricing.total,9000);assert.equal(result.pricing.deposit,5000);
 assert.equal(result.handover.signature_confirmation,undefined);assert.equal(result.handover.handover_confirmation,undefined);
 assert.equal(result.signed_at,undefined);assert.equal(result.signed_copy_path,undefined);
});
test('changed client never receives prior identity documents or handover text',()=>{
 const {fresh,previous}=fixture();fresh.handover.generation_context.client_contact='@different';
 carryVersionFields(fresh,previous);assert.equal(fresh.renter.id_or_passport,'');assert.equal(fresh.handover.fuel_level,'');
});
test('changed contact ID or name prevents identity inheritance',()=>{
 for(const [key,value] of [['contact_id','person-2'],['client_name','Different Person']]){
  const {fresh,previous}=fixture();fresh.handover.generation_context[key]=value;
  carryVersionFields(fresh,previous);assert.equal(fresh.renter.license_no,'');
 }
});
test('changed vehicle keeps client documents but clears car fields and handover text',()=>{
 const {fresh,previous}=fixture();fresh.handover.generation_context.catalog_item_id='car-2';
 carryVersionFields(fresh,previous);assert.equal(fresh.renter.license_no,'TEST-LICENSE');assert.equal(fresh.vehicle.registration_no,'');assert.equal(fresh.handover.fuel_level,'');
});
test('changed rental dates retain only the matching endpoint time',()=>{
 const {fresh,previous}=fixture();fresh.rental.end_date='2026-10-06';carryVersionFields(fresh,previous);
 assert.equal(fresh.rental.start_time,'10:00');assert.equal(fresh.rental.end_time,'');assert.equal(fresh.rental.remark,'');assert.equal(fresh.handover.fuel_level,'');
});
test('explicit clearing and fresh values take precedence over earlier fields',()=>{
 const {fresh,previous}=fixture();fresh.renter.license_no='NEW-LICENSE';
 carryVersionFields(fresh,previous,{renter:{id_or_passport:''},vehicle:{registration_no:''}});
 assert.equal(fresh.renter.id_or_passport,'');assert.equal(fresh.renter.license_no,'NEW-LICENSE');assert.equal(fresh.vehicle.registration_no,'');
});
test('legacy contracts require matching contact and vehicle plate',()=>{
 const {fresh,previous}=fixture();delete previous.handover_data.generation_context;
 carryVersionFields(fresh,previous);assert.equal(fresh.renter.id_or_passport,'TEST-PASSPORT');assert.equal(fresh.vehicle.color,'');
 fresh.vehicle.registration_no='TEST-PLATE';carryVersionFields(fresh,previous);assert.equal(fresh.vehicle.color,'Blue');
});
test('missing contact and cancelled contracts do not inherit private data',()=>{
 for(const mode of ['missing','cancelled']){const {fresh,previous}=fixture();
  if(mode==='missing')fresh.handover.generation_context.client_contact='';else previous.status='cancelled';
  carryVersionFields(fresh,previous);assert.equal(fresh.renter.id_or_passport,'');
 }
});
