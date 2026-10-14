import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../pcs-ai-operator-v6/workflow-console.js',import.meta.url),'utf8');
async function fixture(permissions){const root={innerHTML:'',querySelectorAll:()=>[]};const data={permissions,application:{id:'qa',public_id:'QA',client_profile_id:'client',assigned_partner_id:'partner',operational_status:'CONFIRMED',client_payment_status:'INSTRUCTIONS_SENT'},access:[],partners:[],offers:[{id:'offer',status:'SUBMITTED',client_price_thb:'1000',deposit_thb:'200',terms:'QA'}],payments:[{id:'claim',status:'PENDING',amount_thb:'400',reference:'QA'}],instructions:null};const window={openSheet(){},pcsManagerRequest:async()=>data};vm.runInNewContext(source,{window,document:{getElementById:()=>root},Date});await window.pcsWorkflow.open('qa');return root.innerHTML;}
test('finance role sees payment controls but not offer approval or cabinet access controls',async()=>{
 const html=await fixture(['settlements.view','settlements.edit']);assert.match(html,/data-workflow="review-payment"/);assert.match(html,/data-workflow="payment-instructions"/);assert.doesNotMatch(html,/data-link=|data-offer=|data-workflow="assign-partner"/);assert.doesNotMatch(html,/Клиентский профиль пока не связан/);
});
test('concierge role cannot write payment data; legacy administrator keeps existing controls',async()=>{
 const html=await fixture(['applications.view','applications.quote','applications.assign']);assert.match(html,/data-offer=/);assert.match(html,/data-link=/);assert.doesNotMatch(html,/data-workflow="review-payment"|data-workflow="payment-instructions"/);
 assert.match(await fixture(undefined),/data-workflow="review-payment"/);
});
test('execution controls are restricted to execution permission and never offered for vehicles',async()=>{
 async function render(permissions,type,status='CONFIRMED',started=null){const root={innerHTML:''};const window={openSheet(){},pcsManagerRequest:async()=>({permissions,application:{id:'qa',public_id:'QA',item_type:type,selected_partner_offer_id:'offer',operational_status:status,service_started_at:started},access:[],partners:[],offers:[],payments:[]})};vm.runInNewContext(source,{window,document:{getElementById:()=>root},Date});await window.pcsWorkflow.open('qa');return root.innerHTML;}
 assert.match(await render(['applications.execute'],'SERVICE'),/name="phase" value="STARTED"/);
 assert.match(await render(['applications.execute'],'PROPERTY','SERVICE_IN_PROGRESS','date'),/name="phase" value="COMPLETED"/);
 assert.doesNotMatch(await render(['applications.execute'],'VEHICLE'),/data-workflow="service-phase"/);
 assert.doesNotMatch(await render(['applications.view'],'SERVICE'),/data-workflow="service-phase"/);
});
