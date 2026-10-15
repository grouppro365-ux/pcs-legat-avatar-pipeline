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

test('issue lifecycle controls preserve operator permissions and show recorded resolution safely',async()=>{
 async function render(permissions,issue,status='SERVICE_IN_PROGRESS'){const root={innerHTML:''};const window={openSheet(){},pcsManagerRequest:async()=>({permissions,application:{id:'qa',public_id:'QA',operational_status:status,execution_issue_status:issue,execution_issue_summary:'<script>bad</script>',execution_issue_resolution:'Verified correction'},access:[],partners:[],offers:[],payments:[]})};vm.runInNewContext(source,{window,document:{getElementById:()=>root},Date});await window.pcsWorkflow.open('qa');return root.innerHTML;}
 assert.match(await render(['applications.execute'],'NONE'),/value="OPEN"/);
 const open=await render(['applications.execute'],'OPEN');assert.match(open,/value="ESCALATE"/);assert.match(open,/value="RESOLVE"/);assert.doesNotMatch(open,/value="OPEN"/);
 assert.doesNotMatch(await render(['applications.execute'],'ESCALATED'),/value="ESCALATE"/);
 const reader=await render(['applications.view'],'RESOLVED');assert.doesNotMatch(reader,/data-workflow="execution-issue"/);assert.match(reader,/Verified correction/);assert.match(reader,/&lt;script&gt;/);
});

test('operator pages keep older offer and payment actions bound to displayed versions',async()=>{
 const calls=[],root={innerHTML:'',querySelectorAll:()=>[]},message={textContent:''};
 const window={openSheet(){},pcsManagerRequest:async(op,args)=>{calls.push([op,args]);if(op==='workflow-action')return {ok:true};const p=args.params;return {permissions:['*'],application:{id:'qa',public_id:'QA',edit_version:'app-version'},partners:[],access:[],offers:p.offers_page===1?[{id:'old-offer',status:'SUBMITTED',edit_version:'offer-version'}]:[],payments:p.payments_page===1?[{id:'old-claim',status:'PENDING',edit_version:'claim-version'}]:[],pagination:{offers:{page:p.offers_page,has_more:p.offers_page===0},payments:{page:p.payments_page,has_more:p.payments_page===0}}};}};
 class Fields{constructor(f){this.fields=f.fields;}[Symbol.iterator](){return this.fields[Symbol.iterator]();}}
 vm.runInNewContext(source,{window,document:{getElementById:id=>id==='pcsWorkflowRoot'?root:message},Date,FormData:Fields});await window.pcsWorkflow.open('qa');
 root.onclick({target:{closest:()=>({dataset:{workflowPage:'offers',page:'1'}})}});await new Promise(setImmediate);assert.match(root.innerHTML,/data-offer="old-offer"/);
 root.onclick({target:{closest:()=>({dataset:{offer:'old-offer',decision:'APPROVED'},hasAttribute:()=>false})}});await new Promise(setImmediate);
 assert.deepEqual(JSON.parse(JSON.stringify(calls.find(([op])=>op==='workflow-action')[1].body)),{action:'review-offer',offer_id:'old-offer',offer_version:'offer-version',decision:'APPROVED',application_id:'qa',expected_version:'app-version'});
 root.onclick({target:{closest:()=>({dataset:{workflowPage:'payments',page:'1'}})}});await new Promise(setImmediate);assert.match(root.innerHTML,/data-claim="old-claim"/);
 root.onsubmit({preventDefault(){},target:{dataset:{workflow:'review-payment',claim:'old-claim'},fields:[['decision','REJECTED'],['note','Checked older reference']]}});await new Promise(setImmediate);
 const payment=calls.filter(([op])=>op==='workflow-action').at(-1)[1].body;assert.equal(payment.claim_id,'old-claim');assert.equal(payment.claim_version,'claim-version');assert.equal(payment.expected_version,'app-version');
});
test('operator failed page does not replace the current deal',async()=>{
 const root={innerHTML:'',querySelectorAll:()=>[]},message={textContent:''};let fail=false;
 const window={openSheet(){},pcsManagerRequest:async(op,args)=>{if(fail)throw Error('Page temporarily unavailable');return {application:{public_id:'QA'},partners:[],access:[],offers:[],payments:[],pagination:{offers:{page:0,has_more:true}}};}};
 vm.runInNewContext(source,{window,document:{getElementById:id=>id==='pcsWorkflowRoot'?root:message},Date});await window.pcsWorkflow.open('qa');const previous=root.innerHTML;fail=true;root.onclick({target:{closest:()=>({dataset:{workflowPage:'offers',page:'1'}})}});await new Promise(setImmediate);assert.equal(root.innerHTML,previous);assert.match(message.textContent,/temporarily unavailable/);
});
test('an earlier page response cannot restore old review controls after a successful action',async()=>{
 const root={innerHTML:'',querySelectorAll:()=>[]},message={textContent:''};let finish,reviewed=false;
 const data=()=>({application:{public_id:'QA',edit_version:reviewed?'v2':'v1'},partners:[],access:[],payments:[],offers:reviewed?[]:[{id:'offer',status:'SUBMITTED',edit_version:'offer-v1'}],pagination:{offers:{page:0,has_more:true}}});
 const window={openSheet(){},pcsManagerRequest:async(op,args)=>{if(op==='workflow-action'){reviewed=true;return {ok:true};}if(args.params.offers_page===1)return new Promise(resolve=>{const stale=data();finish=()=>resolve(stale);});return data();}};
 vm.runInNewContext(source,{window,document:{getElementById:id=>id==='pcsWorkflowRoot'?root:message},Date});await window.pcsWorkflow.open('qa');
 root.onclick({target:{closest:()=>({dataset:{workflowPage:'offers',page:'1'}})}});
 root.onclick({target:{closest:()=>({dataset:{offer:'offer',decision:'APPROVED'},hasAttribute:()=>false})}});await new Promise(setImmediate);assert.doesNotMatch(root.innerHTML,/data-offer="offer"/);
 finish();await new Promise(setImmediate);assert.doesNotMatch(root.innerHTML,/data-offer="offer"/);
});
