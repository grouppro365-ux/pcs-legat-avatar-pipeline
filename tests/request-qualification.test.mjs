import test from 'node:test';import assert from 'node:assert/strict';
import {qualificationInput,qualificationTypes,readQualification,saveQualification} from '../server/supabase/pcs-manager-live2/request-qualification.mjs';
const id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';const payload=()=>({id,request_id:id,expected_version:'a'.repeat(32),type:'car_rental',answers:{city:' Pattaya ',start_date:'2026-11-01',end_date:'2026-11-03'},source_note:'Client chat 16 Oct'});
test('type-specific fields reject booking/payment/identity injection',()=>{for(const key of ['total_amount','currency','item_id','client_profile_id','service_execution','availability'])assert.throws(()=>qualificationInput({...payload(),answers:{[key]:'123'}}));assert.throws(()=>qualificationInput({...payload(),answers:{purchase_goal:'investment'}}));assert.equal(qualificationInput(payload()).answers.city,'Pattaya');assert.equal(Object.keys(qualificationTypes).length,6);});
test('dates validate real calendar values and chronological range',()=>{for(const start of ['2026-02-30','2026-13-01','tomorrow','2026-11-03'])assert.throws(()=>qualificationInput({...payload(),answers:{start_date:start,end_date:'2026-11-03'}}));});
test('incomplete qualification allowed without invented answers',()=>{assert.deepEqual(qualificationInput({...payload(),answers:{}}).answers,{});assert.throws(()=>qualificationInput({...payload(),source_note:' '}));});
test('selected offers and advanced states are read only',async()=>{for(const state of ['CONFIRMED','SERVICE_IN_PROGRESS','COMPLETED'])assert.equal((await readQualification({query:async()=>[{operational_status:state}]},id)).editable,false);assert.equal((await readQualification({query:async()=>[{operational_status:'NEW',selected_partner_offer_id:id}]},id)).editable,false);assert.equal((await readQualification({query:async()=>[{operational_status:'NEW'}]},id)).editable,true);});
test('writes use authenticated actor and canonical atomic function',async()=>{let args;await saveQualification({query:async(q,p)=>{args=[q,p];return [{result:{application_id:id,edit_version:"b".repeat(32)}}];}},payload(),id);assert.match(args[0],/pcs.save_request_qualification/);assert.equal(args[1][6],id);assert.deepEqual(JSON.parse(args[1][4]),qualificationInput(payload()).answers);});

test('visa asks nationality, current status and location, target visa and timeline without guessing eligibility',async()=>{
 const answers={nationality:'Client supplied nationality',current_status:'Visa exemption until 30 November',current_location:'Pattaya',target_visa:'Study',timeline:'Before November',applicants:'1'};
 assert.deepEqual(qualificationInput({...payload(),type:'visa',answers}).answers,answers);
 assert.throws(()=>qualificationInput({...payload(),type:'visa',answers:{vehicle_class:'Sedan'}}));
 const result=await readQualification({query:async()=>[{operational_status:'NEW',qualification:{type:'visa',answers}}]},id);
 assert.deepEqual(result.assessment.missing_questions,[{key:'requirements',question:qualificationTypes.visa.fields.requirements}]);
 assert.equal(result.assessment.all_answers_recorded,false);assert.equal(result.assessment.verified_availability,false);
});
test('transfer collects route, local date and time, passengers and luggage with calendar validation',()=>{
 const answers={pickup:'BKK',dropoff:'Pattaya',transfer_date:'2026-11-01',transfer_time:'23:45',passengers:'3',luggage:'2 large bags',child_seats:'No',flight_number:'Not required'};
 assert.deepEqual(qualificationInput({...payload(),type:'transfer',answers}).answers,answers);
 for(const transfer_date of ['2026-02-30','2026-13-01','tomorrow'])assert.throws(()=>qualificationInput({...payload(),type:'transfer',answers:{transfer_date}}));
 for(const transfer_time of ['24:00','12:60','9:30','noon'])assert.throws(()=>qualificationInput({...payload(),type:'transfer',answers:{transfer_time}}));
 assert.throws(()=>qualificationInput({...payload(),type:'visa',answers:{transfer_date:'2026-11-01'}}));
});
