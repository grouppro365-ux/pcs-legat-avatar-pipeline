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
