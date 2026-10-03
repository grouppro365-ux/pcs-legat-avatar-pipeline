import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {confirmationRequest,handoverInput} from '../server/supabase/pcs-contract-api/confirmation-policy.mjs';
const now=Date.UTC(2026,9,3,10),valid={kind:'signature',occurred_at:'2026-10-01T09:30:00.000Z',operator_name:' Test Manager ',note:' Present at signing ',confirmed:true};
test('ordinary draft edits cannot forge signing or handover attestations',()=>{
 assert.deepEqual(handoverInput({fuel_level:'Full',equipment:'2 keys',signature_confirmation:{method:'operator_attestation'},handover_confirmation:{operator_name:'forged'}}),{fuel_level:'Full',equipment:'2 keys'});
});
test('server accepts explicit past facts and strips unrelated supplied state',()=>{
 const signature=confirmationRequest({...valid,status:'signed',actor:'fake',signed_copy_path:'fake'},now);
 assert.equal(signature.operator_name,'Test Manager');assert.equal(signature.note,'Present at signing');assert.equal(signature.status,undefined);assert.equal(signature.actor,undefined);
 assert.equal(confirmationRequest({...valid,kind:'handover'},now).kind,'handover');
});
test('server rejects absent attestation, future or malformed dates, missing manager and basis',()=>{
 for(const [override,message] of [[{confirmed:false},'confirmation_required'],[{confirmed:'true'},'confirmation_required'],[{kind:'sign-for-client'},'invalid_confirmation_kind'],[{occurred_at:'2027-01-01T00:00:00Z'},'invalid_confirmation_date'],[{occurred_at:'2026-02-31T00:00:00Z'},'invalid_confirmation_date'],[{occurred_at:'2026-01-01'},'invalid_confirmation_date'],[{operator_name:' '},'operator_name_required'],[{note:'yes'},'confirmation_note_required']])assert.throws(()=>confirmationRequest({...valid,...override},now),new RegExp(message));
});
function fixture(){
 const nodes={ctFactForm:{dataset:{contract:'contract-test',kind:'signature'}},ctFactAt:{value:'2026-10-01T09:30'},ctFactOperator:{value:'Test Manager'},ctFactNote:{value:'Present at signing'},ctFactConfirmed:{checked:true},ctFactError:{textContent:''},ctFactSave:{disabled:false,textContent:'Сохранить подтверждение'}};
 let failure=false,requests=[],sheets=[],centers=[],resolve;
 const context={window:{toast:()=>{},openSheet:(title,html)=>sheets.push({title,html}),contractCenter:async id=>centers.push(id),contractCall:async(path,opt)=>{if(!opt)return{id:'contract-test',reservation_id:'reservation-test',status:'ready_to_sign'};requests.push({path,body:JSON.parse(opt.body)});if(failure)throw Error('booking_not_confirmed');return await new Promise(r=>{resolve=r})}},document:{getElementById:id=>nodes[id]},Date};
 vm.runInNewContext(readFileSync(new URL('../pcs-ai-operator-v6/contract-confirmations.js',import.meta.url),'utf8'),context);
 return{api:context.window.pcsContractConfirmations,nodes,requests,sheets,centers,fail:()=>{failure=true},finish:()=>resolve({reservation_id:'reservation-test'})};
}
test('render distinguishes manager attestation, uploaded copy and vehicle handover; escapes notes',()=>{
 const f=fixture(),fact={occurred_at:valid.occurred_at,confirmed_at:valid.occurred_at,operator_name:'<admin>',note:'<img onerror=alert(1)>'};
 const ready=f.api.render({id:'test',status:'ready_to_sign',handover_data:{}});assert.match(ready,/Подписан ранее/);assert.match(ready,/Машина уже выдана/);
 const signed=f.api.render({id:'test',status:'signed',handover_data:{signature_confirmation:fact,handover_confirmation:fact}});assert.match(signed,/Подпись подтверждена менеджером/);assert.match(signed,/Выдача автомобиля подтверждена/);assert.doesNotMatch(signed,/<img|Подписан ранее|Машина уже выдана/);assert.match(signed,/&lt;admin&gt;/);
});
test('no request without checkbox; concurrent clicks send once and successful save refreshes center',async()=>{
 const f=fixture();f.nodes.ctFactConfirmed.checked=false;await f.api.submit();assert.equal(f.requests.length,0);assert.match(f.nodes.ctFactError.textContent,/отметку/);
 f.nodes.ctFactConfirmed.checked=true;const pending=f.api.submit();assert.equal(f.nodes.ctFactSave.disabled,true);await f.api.submit();assert.equal(f.requests.length,1);assert.equal(f.requests[0].body.kind,'signature');assert.equal(f.requests[0].body.confirmed,true);f.finish();await pending;assert.deepEqual(f.centers,['reservation-test']);
});
test('server conflict keeps the form and entered values for correction',async()=>{
 const f=fixture();f.fail();await f.api.submit();assert.match(f.nodes.ctFactError.textContent,/подтвердите бронь/);assert.equal(f.nodes.ctFactNote.value,'Present at signing');assert.equal(f.nodes.ctFactSave.disabled,false);assert.equal(f.centers.length,0);
});
