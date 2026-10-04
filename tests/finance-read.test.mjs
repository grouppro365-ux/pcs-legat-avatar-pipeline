import test from 'node:test';
import assert from 'node:assert/strict';
import {readFinance,readReservationBalance,financeQueries,ledgerFields} from '../server/supabase/pcs-manager-live2/finance-read.mjs';
test('finance reads the actual ledger with bound filters, paging, and text decimals, omitting private payload',async()=>{
 const calls=[],transport=async(url,init)=>{calls.push({url:new URL(url),init});return Response.json(Array.from({length:101},(_,i)=>({id:String(i),amount:'123456789012345678.125',currency:'THB',status:'paid',receipt_path:'private',metadata:{secret:'private'}})))};
 const data=await readFinance({},'https://test.invalid','server-only','ledger','paid','2',transport);assert.equal(data.rows.length,100);assert.equal(data.truncated,true);assert.equal(data.rows[0].amount,'123456789012345678.125');assert.ok(!JSON.stringify(data).includes('private'));
 assert.equal(calls[0].url.searchParams.get('select'),ledgerFields);assert.match(ledgerFields,/amount::text/);assert.equal(calls[0].url.searchParams.get('offset'),'200');assert.equal(calls[0].url.searchParams.get('status'),'eq.paid');assert.equal(calls[0].init.headers.authorization,'Bearer server-only');
});
test('settlements and quotes remain distinct sources and never expose full snapshots or invoice keys',async()=>{
 const calls=[],biz={query:async(q,p)=>{calls.push({q,p});return[]}};
 await readFinance(biz,'','','settlements','PAID','3');await readFinance(biz,'','','quotes','all','4');assert.deepEqual(calls.map(x=>x.p),[['PAID',300],[400]]);
 assert.match(calls[1].q,/offset \$1/);for(const q of Object.values(financeQueries)){assert.doesNotMatch(q,/select \*|snapshot\b|storage_key|breakdown/)}
});
test('finance rejects invalid filters before calls and reports transport errors without private details',async()=>{
 const db={query:()=>assert.fail('database called')},transport=()=>assert.fail('transport called');for(const [source,status,page] of [['ledger','bad or 1=1','0'],['fake','all','0'],['quotes','paid','0'],['ledger','all','-1'],['ledger','all','5001']])await assert.rejects(()=>readFinance(db,'','',source,status,page,transport),e=>e.status===400);
 for(const response of [new Response('private upstream',{status:500}),Response.json({error:'private'})])await assert.rejects(()=>readFinance({},'https://test.invalid','key','ledger','all','0',async()=>response),e=>e.status===503&&!e.message.includes('private'));
});

const rid='11111111-1111-4111-8111-111111111111';
test('canonical booking balance binds UUID and strips unknown/private fields',async()=>{
 let call;const result=await readReservationBalance('https://test.invalid','key',rid,async(url,init)=>{call={url,init};return Response.json({reservation_id:rid,payment_status:'partial',total_amount:'1000.125',gross_paid:'600.125',remaining:'400',other_currencies:[{currency:'USD',entry_type:'income',amount:'10.5',metadata:'private'}],metadata:'private',receipt_path:'private'})});
 assert.equal(call.url,'https://test.invalid/rest/v1/rpc/pcs_reservation_finance_balance');assert.equal(call.init.method,'POST');assert.deepEqual(JSON.parse(call.init.body),{p_reservation_id:rid});assert.equal(call.init.headers.authorization,'Bearer key');assert.equal(result.remaining,'400');assert.equal(result.total_amount,'1000.125');assert.ok(!JSON.stringify(result).includes('private'));
});
test('booking balance rejects unsafe identities, missing booking and upstream failures',async()=>{
 for(const id of ['',"id' or 1=1",null])await assert.rejects(()=>readReservationBalance('','',id,()=>assert.fail('transport called')),e=>e.status===400);
 for(const [response,status] of [[Response.json(null),404],[Response.json({reservation_id:'other',payment_status:'paid',other_currencies:[]}),503],[new Response('secret',{status:403}),503]])await assert.rejects(()=>readReservationBalance('https://test.invalid','key',rid,async()=>response),e=>e.status===status&&!e.message.includes('secret'));
});
test('PCS ledger supports due and rejects nonexistent pending/rejected statuses',async()=>{
 let url;await readFinance({},'https://test.invalid','key','ledger','due','0',async(u)=>{url=new URL(u);return Response.json([])});assert.equal(url.searchParams.get('status'),'eq.due');
 for(const status of ['pending','rejected'])await assert.rejects(()=>readFinance({},'','', 'ledger',status,'0',()=>assert.fail('transport called')),e=>e.status===400);
});
