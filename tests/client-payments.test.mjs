import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readFinance} from '../server/supabase/pcs-manager-live2/finance-read.mjs';
import {clientPaymentsQuery} from '../server/supabase/pcs-manager-live2/client-payments.mjs';
test('cabinet payments use bound statuses/pages, exact decimal texts and application-level verified balance',async()=>{
 let call;const result=await readFinance({query:async(q,p)=>{call={q,p};return Array.from({length:101},(_,i)=>({id:i,amount:'400.10',verified_amount:'500.15',pending_amount:'500.10',remaining:'500.10',deposit:'2000',balance_status:'PARTIAL'}))}},'','','client-payments','PENDING','3');
 assert.equal(call.q,clientPaymentsQuery);assert.deepEqual(call.p,['PENDING',300]);assert.equal(result.rows.length,100);assert.equal(result.truncated,true);assert.equal(result.rows[0].remaining,'500.10');
 assert.match(call.q,/pcs.application_service_balance\(a.id\)/);const balance=readFileSync(new URL('../server/sql/pcs_application_service_balance.sql',import.meta.url),'utf8');assert.match(balance,/FILTER\(WHERE status='VERIFIED'\)/);assert.match(balance,/FILTER\(WHERE status='PENDING'\)/);assert.doesNotMatch(call.q,/select \*|internal_notes|instructions|snapshot\s*,/);
 for(const status of ['paid','VERIFIED OR 1=1',''])await assert.rejects(()=>readFinance({query:()=>assert.fail('invalid read')},'','','client-payments',status,'0'),e=>e.status===400);
});
