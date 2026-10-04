import {CrmError} from './crm-policy.mjs';
export const financeQueries={
 settlements:`select s.id,s.public_id,s.application_id,s.partner_id,s.model,s.status,s.client_paid_amount::text,s.expected_pcs_amount::text,s.currency,s.due_at,s.invoice_status,s.paid_at,s.partner_confirmed_at,s.updated_at,a.public_id application_public_id,a.client_name,p.public_name partner_name from settlements s join applications a on a.id=s.application_id left join partners p on p.id=s.partner_id where ($1='all' or s.status=$1) order by s.updated_at desc,s.id desc limit 101 offset $2`,
 quotes:`select q.id,q.application_id,q.version,q.currency,q.client_total::text,q.deposit::text,q.payment_recipient,q.immutable_at,a.public_id application_public_id,a.client_name from quote_snapshots q join applications a on a.id=q.application_id order by q.immutable_at desc,q.id desc limit 101 offset $1`
};
export const ledgerFields='id,reservation_id,deal_id,entry_type,amount::text,currency,status,due_at,paid_at,counterparty,note,payment_kind,payment_method,receipt_name,created_at,updated_at';
export async function readFinance(biz,base,key,source='ledger',status='all',rawPage='0',transport=fetch){
 if(!['ledger','settlements','quotes'].includes(source)||!(status==='all'||/^[A-Za-z_]{1,40}$/.test(status))||!/^\d{1,5}$/.test(rawPage)||Number(rawPage)>5000||(source==='quotes'&&status!=='all'))throw new CrmError('Некорректный фильтр финансов',400);
 const page=Number(rawPage),offset=page*100;let rows;
 if(source==='ledger'){
  const u=new URL(base+'/rest/v1/pcs_finance_entries');u.searchParams.set('select',ledgerFields);u.searchParams.set('order','created_at.desc,id.desc');u.searchParams.set('offset',String(offset));u.searchParams.set('limit','101');if(status!=='all')u.searchParams.set('status','eq.'+status);
  const r=await transport(u.toString(),{headers:{apikey:key,authorization:'Bearer '+key},signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new CrmError('Не удалось прочитать журнал финансов PCS',503);
  const data=await r.json();if(!Array.isArray(data))throw new CrmError('Некорректный ответ журнала финансов',503);
  const fields=ledgerFields.split(',').map(k=>k.split('::')[0]);rows=data.map(x=>Object.fromEntries(fields.filter(k=>Object.hasOwn(x,k)).map(k=>[k,x[k]])));
 }else rows=await biz.query(financeQueries[source],source==='quotes'?[offset]:[status,offset]);
 return{source,status,page,limit:100,truncated:rows.length>100,rows:rows.slice(0,100)};
}
