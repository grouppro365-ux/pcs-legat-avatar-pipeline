import test from 'node:test';
import assert from 'node:assert/strict';
import {contractFinance} from '../server/supabase/pcs-contract-api/contract-finance.mjs';
const reservation={id:'11111111-1111-4111-8111-111111111111',currency:'THB'};
const balance={reservation_id:reservation.id,currency:'THB',total_confirmed:true,total_amount:'1000.125',net_paid:'400.125',remaining:'600',invalid_refunds:0,payment_status:'partial'};
test('contract snapshot uses canonical refunded net rental payments and excludes deposits and foreign currencies',async()=>{
 let call;
 const db={rpc:async(name,args)=>{call={name,args};return{data:balance,error:null}}};
 const result=await contractFinance(db,reservation,[
  {id:'booking',currency:'THB',status:'paid',entry_type:'income',payment_kind:'booking_deposit',amount:'600.125'},
  {currency:'THB',status:'paid',entry_type:'refund',amount:'200',metadata:{original_finance_entry_id:'booking'}},
  {currency:'THB',status:'paid',entry_type:'income',payment_kind:'security_deposit',amount:'10000'},
  {currency:'USD',status:'paid',entry_type:'income',payment_kind:'booking_deposit',amount:'99999'},
  {currency:'USD',status:'planned',entry_type:'transfer_fee',amount:'99999'},
  {currency:'THB',status:'planned',entry_type:'transfer_fee',amount:'50'},
  {currency:'THB',status:'cancelled',entry_type:'transfer_fee',amount:'70'}
 ]);
 assert.deepEqual(call,{name:'pcs_reservation_finance_balance',args:{p_reservation_id:reservation.id}});
 assert.deepEqual(result,{currency:'THB',total:'1000.125',paid:'400.125',balance:'600',booking:400.125,transfer:50});
});
test('unavailable or inconsistent canonical finance blocks contract generation rather than inventing zero balances',async()=>{
 await assert.rejects(()=>contractFinance({rpc:async()=>({error:Error('private')})},reservation),/reservation_finance_unavailable/);
 for(const data of [null,{...balance,reservation_id:'other'},{...balance,currency:'USD'},{...balance,total_confirmed:false},{...balance,invalid_refunds:1},{...balance,net_paid:'NaN'},{...balance,remaining:null},{...balance,payment_status:'unknown'}])await assert.rejects(()=>contractFinance({rpc:async()=>({data})},reservation),/reservation_finance_requires_review/);
});
