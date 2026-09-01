(()=>{
'use strict';
const labels={income:'Доход',expense:'Расход',partner_payout:'Партнёрам'};
const statuses={paid:'Оплачено',pending:'Ожидает',cancelled:'Отменено',canceled:'Отменено',draft:'Черновик'};
const safe=v=>typeof window.esc==='function'?window.esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cash=(value,currency='THB')=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:String(currency||'THB').toUpperCase(),maximumFractionDigits:0}).format(Number(value||0));
const total=(rows,type)=>rows.filter(x=>x.entry_type===type&&x.status==='paid').reduce((sum,x)=>sum+Number(x.amount||0),0);
function header(){return typeof window.opsHeader==='function'?window.opsHeader('Деньги','Финансы','Доходы, расходы и выплаты партнёрам — на основе актуальных данных PCS.'):'<div class="ops-head"><div><div class="eyebrow">Деньги</div><h1 class="title">Финансы</h1><p class="sub">Доходы, расходы и выплаты партнёрам — на основе актуальных данных PCS.</p></div></div>'}
function row(item){
 const type=item.entry_type||'expense',sign=type==='income'?'+':'−',title=item.counterparty||labels[type]||'Операция';
 return `<article class="finance-row"><div><div class="finance-row-title">${safe(title)}</div><div class="finance-row-meta"><span>${safe(labels[type]||type)}</span>${item.note?`<span>· ${safe(item.note)}</span>`:''}<span class="finance-status">${safe(statuses[item.status]||item.status||'Без статуса')}</span></div></div><div class="finance-amount ${safe(type)}">${sign} ${safe(cash(item.amount,item.currency))}</div></article>`
}
async function render(){
 if(typeof window.opsNav==='function')window.opsNav();
 const main=document.querySelector('#main');if(!main)return;
 main.innerHTML=header()+'<section class="finance-v26"><div class="finance-ledger"><div class="finance-empty">Загружаю финансовые данные…</div></div></section>';
 try{
  const data=await window.opsCall('/finance'),rows=Array.isArray(data)?data:[];
  main.innerHTML=header()+`<section class="finance-v26"><div class="finance-summary"><div class="item"><span class="muted">Доход</span><b>${safe(cash(total(rows,'income')))}</b></div><div class="item"><span class="muted">Расход</span><b>${safe(cash(total(rows,'expense')))}</b></div><div class="item"><span class="muted">Партнёрам</span><b>${safe(cash(total(rows,'partner_payout')))}</b></div></div><div class="finance-ledger"><div class="finance-ledger-head"><div><h2>Операции</h2><p>${rows.length?`Всего записей: ${rows.length}`:'Новых финансовых записей пока нет'}</p></div></div>${rows.map(row).join('')||'<div class="finance-empty">Финансовых операций пока нет</div>'}</div></section>`;
 }catch(error){main.innerHTML=header()+`<section class="finance-v26"><div class="finance-ledger"><div class="finance-empty">${safe(error?.message||error)}</div></div></section>`}
 if(typeof window.pcsInstallNav25==='function')window.pcsInstallNav25();if(typeof window.pcsBrand26==='function')window.pcsBrand26();
}
window.pcsFinance26=render;
})();
