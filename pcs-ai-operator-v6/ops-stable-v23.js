(()=>{
'use strict';
const MANAGER='https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-manager-live2';
const OPS_API='https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-ops-api';
const previousFetch=window.fetch.bind(window);
const currentToken=()=>localStorage.pcsToken||'';
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json;charset=utf-8','cache-control':'no-store'}});
async function manager(op){
  const u=new URL(MANAGER);u.searchParams.set('op',op);
  const h={accept:'application/json'};if(currentToken())h.authorization='Bearer '+currentToken();
  const r=await previousFetch(u.toString(),{headers:h,cache:'no-store'});let d={};try{d=await r.json()}catch{}
  if(!r.ok)throw new Error(d.error||('HTTP '+r.status));return d;
}
const day=v=>{if(!v)return'';const s=String(v);return s.length>=10?s.slice(0,10):s};
function calendarRows(rows,from,to){
  return (Array.isArray(rows)?rows:[]).map(x=>{
    const start=day(x.starts_at||x.start_date),end=day(x.ends_at||x.end_date||x.starts_at||x.start_date);
    return {...x,start_date:start,end_date:end,status:String(x.status||'available').toLowerCase(),pcs_catalog_items:{...(x.pcs_catalog_items||{}),title:x.title||x.item_title||x.pcs_catalog_items?.title||'Объект'}};
  }).filter(x=>x.start_date&&x.end_date&&(!from||x.end_date>=from)&&(!to||x.start_date<=to));
}
function financeRows(data){
  const rows=Array.isArray(data)?data:(Array.isArray(data?.settlements)?data.settlements:[]);
  return rows.map(x=>{
    const raw=String(x.entry_type||x.settlement_type||x.type||x.kind||'income').toLowerCase();
    const entry_type=raw.includes('partner')?'partner_payout':(raw.includes('expense')||raw.includes('cost')||raw.includes('refund'))?'expense':'income';
    const amount=Number(x.amount??x.total_amount??x.gross_amount??x.client_amount??x.net_amount??x.client_price_thb??x.partner_amount??0)||0;
    const status=String(x.status||x.payment_status||(x.paid_at||x.settled_at?'paid':'pending')).toLowerCase();
    return {...x,entry_type,amount,status,currency:x.currency||'THB',counterparty:x.counterparty||x.client_name||x.partner_name||x.application_public_id||'',note:x.note||x.notes||x.description||''};
  });
}
window.fetch=async function(input,init={}){
  const url=typeof input==='string'?input:input?.url||String(input),mark='/pcs-ops-api',i=url.indexOf(mark);
  if(i>=0){
    const path=url.slice(i+mark.length)||'/',method=String(init?.method||'GET').toUpperCase();
    if(path.startsWith('/calendar?')&&method==='GET'){
      try{const q=new URLSearchParams(path.slice(path.indexOf('?')+1)),rows=calendarRows(await manager('availability'),q.get('from')||'',q.get('to')||'');return response(rows)}catch(e){return response({error:e?.message||'Ошибка календаря'},503)}
    }
    if(path==='/finance'&&method==='GET'){
      try{return response(financeRows(await manager('finance')))}catch(e){return response({error:e?.message||'Ошибка финансов'},503)}
    }
  }
  return previousFetch(input,init);
};
window.opsCall=async function(path,opt={}){
  const h={'content-type':'application/json',...(opt.headers||{})};if(currentToken())h.authorization='Bearer '+currentToken();
  const r=await window.fetch(OPS_API+path,{...opt,headers:h});let d={};try{d=await r.json()}catch{}
  if(!r.ok)throw new Error(d.error||('HTTP '+r.status));return d;
};
window.__PCS_OPS_BRIDGE__={version:'2026-09-01.23',calendar:true,finance:true};
})();