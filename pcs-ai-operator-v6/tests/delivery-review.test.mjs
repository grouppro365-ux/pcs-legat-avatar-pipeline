import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const row={id:'11111111-1111-4111-8111-111111111111',contact_id:'contact1',contact_name:'<Client>',operation:'crm_manual',created_at:'date',edit_version:'2026-10-04 12:00:00.123456'};
function fixture(){const nodes={},calls=[],toasts=[],sheets=[];let resolve,reject;
 const window={PCS:{page:'errors'},openSheet:(title,html)=>{sheets.push(html);for(const id of ['pcsDeliveryReviewForm','pcsDeliveryReviewed','pcsDeliveryNote','pcsDeliveryReviewError','pcsDeliveryReviewSave'])nodes[id]={value:'',checked:false,textContent:'',disabled:false,addEventListener(){}}},fetch:(url,opt)=>{calls.push({url,opt});return new Promise((a,b)=>{resolve=a;reject=b})},toast:t=>toasts.push(t),closeSheet:()=>delete nodes.pcsDeliveryReviewForm,errorsPage:async()=>{throw Error('Refresh failed')}};
 vm.runInNewContext(readFileSync(new URL('../delivery-review.js',import.meta.url),'utf8'),{window,localStorage:{pcsToken:'fixture'},document:{getElementById:id=>nodes[id]||null}});window.pcsDeliveryReview.setRows([row]);return{window,nodes,calls,toasts,sheets,resolve:r=>resolve(r),reject:e=>reject(e)};
}
test('review requires actual check and note; duplicate taps cannot write twice',async()=>{
 const h=fixture(),review=h.window.pcsDeliveryReview;review.open(0);assert.match(h.sheets[0],/&lt;Client&gt;/);await review.submit();assert.equal(h.calls.length,0);
 h.nodes.pcsDeliveryReviewed.checked=true;h.nodes.pcsDeliveryNote.value='Checked actual conversation';const saving=review.submit();await review.submit();assert.equal(h.calls.length,1);const body=JSON.parse(h.calls[0].opt.body);assert.equal(body.expected_version,row.edit_version);assert.equal(body.confirmed,true);assert.equal(body.message_id,row.id);
 h.resolve(Response.json({ok:true,operator_confirmed:true,review:{id:row.id,contact_id:row.contact_id}}));await saving;assert.equal(h.toasts[0],'Доставка подтверждена оператором');assert.match(h.toasts[1],/сохранён/);
});
test('review conflict preserves evidence and unlocks the form without claiming success',async()=>{
 const h=fixture();h.window.pcsDeliveryReview.open(0);h.nodes.pcsDeliveryReviewed.checked=true;h.nodes.pcsDeliveryNote.value='Checked actual conversation';const save=h.window.pcsDeliveryReview.submit();h.resolve(Response.json({error:'Attempt changed'},{status:409}));await save;assert.equal(h.nodes.pcsDeliveryNote.value,'Checked actual conversation');assert.equal(h.nodes.pcsDeliveryNote.disabled,false);assert.equal(h.nodes.pcsDeliveryReviewError.textContent,'Attempt changed');assert.equal(h.toasts.length,0);
});
test('AI approvals and malformed identity never open this manual-send review',()=>{
 const h=fixture();for(const bad of [{...row,operation:'ai_approval'},{...row,contact_id:"bad'"},{...row,id:'approval:abc'}]){h.window.pcsDeliveryReview.setRows([bad]);h.window.pcsDeliveryReview.open(0)}assert.equal(h.sheets.length,0);
});
