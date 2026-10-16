// Contract totals use the same currency/refund/deposit rules as the operator ledger.
export async function contractFinance(db,reservation,entries=[]) {
 const {data:balance,error}=await db.rpc('pcs_reservation_finance_balance',{p_reservation_id:reservation.id});
 if(error)throw new Error('reservation_finance_unavailable');
 if(!balance||balance.reservation_id!==reservation.id||balance.currency!==reservation.currency||balance.total_confirmed!==true||Number(balance.invalid_refunds)!==0)
  throw new Error('reservation_finance_requires_review');
 const decimal=value=>typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value)&&Number.isFinite(Number(value));
 if(!['total_amount','net_paid','remaining'].every(k=>decimal(balance[k]))||!['unpaid','partial','paid','refunded'].includes(balance.payment_status))throw new Error('reservation_finance_requires_review');
 // These fields explain individual price components; they never determine paid/balance.
 const same=entries.filter(x=>x.currency===balance.currency);
 const booked=same.filter(x=>x.status==='paid'&&x.entry_type==='income'&&x.payment_kind==='booking_deposit');
 const originals=new Set(booked.map(x=>String(x.id)));
 const number=x=>{const n=Number(x);if(!Number.isFinite(n)||n<0)throw new Error('reservation_finance_requires_review');return n;};
 const booking=booked.reduce((n,x)=>n+number(x.amount),0)-same.filter(x=>x.status==='paid'&&x.entry_type==='refund'&&originals.has(String(x.metadata?.original_finance_entry_id))).reduce((n,x)=>n+number(x.amount),0);
 const transfer=same.filter(x=>x.entry_type==='transfer_fee'&&!['cancelled','refunded'].includes(x.status)).reduce((n,x)=>n+number(x.amount),0);
 return{currency:balance.currency,total:balance.total_amount,paid:balance.net_paid,balance:balance.remaining,booking,transfer};
}
