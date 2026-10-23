import test from 'node:test';import assert from 'node:assert/strict';
import {extractSourceQualification,qualifyApplicationFromSource,sourceQualificationQuery,qualifyRuntimeIntakeResult} from '../server/supabase/pcs-manager-live2/source-qualification.mjs';
import {readQualification,qualificationTypes} from '../server/supabase/pcs-manager-live2/request-qualification.mjs';
const id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',version='a'.repeat(32),hash='b'.repeat(32);
const source='🙂 аренда авто; city: Pattaya; budget: 800 THB/day; start date: 2026-11-01; end date: 2026-11-03';
const row=()=>({id,edit_version:version,source_hash:hash,operational_status:'NEW',client_visible_notes:source});
test('local extraction preserves exact Unicode source spans and leaves missing questions unverified',()=>{
 const q=extractSourceQualification(source);assert.equal(q.type,'car_rental');assert.equal(q.status,'EXTRACTED_UNVERIFIED');assert.equal(q.review_required,true);assert.deepEqual(q.answers,{city:'Pattaya',budget:'800 THB/day',start_date:'2026-11-01',end_date:'2026-11-03'});
 for(const [key,p]of Object.entries(q.evidence.answers))assert.equal([...source].slice(p.start,p.end).join(''),q.answers[key]);assert.equal([...source].slice(q.evidence.type.start,q.evidence.type.end).join(''),q.evidence.type.quote);assert.equal(q.verified_availability,false);assert.equal(q.next_question,qualificationTypes.car_rental.fields.requirements);
});
test('ambiguous types, unlabeled prices, conflicting fields and impossible/relative dates remain unknown',()=>{
 assert.equal(extractSourceQualification('аренда авто и airport transfer; city: Pattaya').type,null);
 assert.equal(extractSourceQualification('Нужно что-нибудь').status,'NEEDS_TYPE');
 const q=extractSourceQualification('аренда авто; city: Pattaya; city: Phuket; start date: tomorrow; end date: 2026-02-30; 5000 cheap');assert.deepEqual(q.answers,{});assert.deepEqual(q.conflicts,['city','start_date','end_date']);
 assert.deepEqual(extractSourceQualification('аренда авто; start date: 2026-11-04; end date: 2026-11-03').answers,{});
});
test('service dictionaries permit only explicit labels and valid transfer time',()=>{
 for(const [request,type,field,value]of [['купить квартиру','property_buy','purchase goal','Home'],['аренда квартиры','property_rent','guests','2'],['нужна виза','visa','nationality','TH'],['airport transfer','transfer','pickup','BKK'],['request type: service','service','service need','Repair']]){const q=extractSourceQualification(`${request}; ${field}: ${value}; total_amount: 1; availability: yes`);assert.equal(q.type,type);assert.equal(Object.values(q.answers)[0],value);assert.equal(q.answers.total_amount,undefined);assert.equal(q.answers.availability,undefined);}assert.equal(extractSourceQualification('airport transfer; transfer time: 24:00').answers.transfer_time,undefined);
});
test('intake qualification uses canonical snapshot and atomic source saver without model or send',async()=>{
 const calls=[];const out=await qualifyApplicationFromSource({query:async(q,p)=>{calls.push([q,p]);return calls.length===1?[row()]:[{result:{application_id:id,edit_version:'c'.repeat(32)}}];}},id,null,id);
 assert.equal(out.updated,true);assert.equal(calls.length,2);assert.equal(calls[0][0],sourceQualificationQuery);assert.match(calls[1][0],/save_source_qualification/);assert.equal(calls[1][1][6],hash);assert.equal(calls[1][1][1],version);assert.equal(JSON.parse(calls[1][1][4]).city,'Pattaya');
});
test('replays, operator answers and fixed applications cannot be overwritten by extraction',async()=>{
 for(const change of [{operator_qualification:{type:'service'}},{selected_partner_offer_id:id},{operational_status:'CONFIRMED'},{source_qualification:{method:'deterministic_exact_source_spans_v1',source_hash:hash}},{client_visible_notes:'x'.repeat(4001)}]){let calls=0;const out=await qualifyApplicationFromSource({query:async()=>{calls++;return[{...row(),...change}];}},id,null,id);assert.equal(calls,1);assert.equal(out.updated,false);}
});
test('failed persistence never claims successful qualification; created intake remains durable',async()=>{
 let calls=0;await assert.rejects(()=>qualifyApplicationFromSource({query:async()=>++calls===1?[row()]:[{result:{application_id:id}}]},id,null,id),e=>e.status===502);
 const created={ok:true,application:{id}};const result=await qualifyRuntimeIntakeResult({query:async()=>{throw Error('private database');}},created);assert.equal(result.application,created.application);assert.equal(result.ok,true);assert.equal(result.source_qualification.status,'EXTRACTION_UNAVAILABLE');assert.equal(JSON.stringify(result).includes('private database'),false);
});
test('automatic evidence is separate from operator assessment and invalidated by changed source',async()=>{
 const automatic={type:'car_rental',answers:{city:'Pattaya'},method:'deterministic_exact_source_spans_v1',source_hash:hash};
 const fresh=await readQualification({query:async()=>[{operational_status:'NEW',source_hash:hash,source_qualification:automatic}]},id);assert.equal(fresh.automatic.status,'EXTRACTED_UNVERIFIED');assert.equal(fresh.assessment.recorded,false);assert.equal(fresh.automatic.assessment.missing_questions.some(q=>q.key==='city'),false);
 const stale=await readQualification({query:async()=>[{operational_status:'NEW',source_hash:version,source_qualification:automatic}]},id);assert.equal(stale.automatic.status,'STALE');assert.equal(stale.automatic.assessment,undefined);
});
