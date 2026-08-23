(()=>{
const rStatus=v=>window.pcsStatusRu?pcsStatusRu(v):({requested:'Запрос',hold:'Предварительная бронь',confirmed:'Подтверждено',active:'В аренде',completed:'Завершено',cancelled:'Отменено'}[v]||v||'—');
const rIntent=v=>window.pcsIntentRu?pcsIntentRu(v):v||'—';
const rMoney=(v,c='THB')=>v==null?'—':new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(Number(v))+' '+(c||'THB');
const iso=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
const prettyDate=v=>{try{return new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric'}).format(new Date(v+'T00:00:00'))}catch{return v}};

window.moreMenu=function(){openSheet('Ещё',`<div class="more-grid"><button class="btn soft" onclick="closeSheet();go('crm')">Клиенты</button><button class="btn blue" onclick="closeSheet();go('approvals')">Требуют ответа</button><button class="btn sage" onclick="closeSheet();go('kb')">База знаний</button><button class="btn soft" onclick="closeSheet();go('finance')">Финансы</button><button class="btn ghost" onclick="closeSheet();go('status')">Состояние системы</button><button class="btn danger" onclick="logout()">Выйти</button></div>`)};

window.calendarPage=async function(){
  if(typeof opsNav==='function')opsNav();
  const m=document.querySelector('#main'); if(!m)return;
  const first=new Date(OPS.calendarMonth.getFullYear(),OPS.calendarMonth.getMonth(),1);
  const last=new Date(OPS.calendarMonth.getFullYear(),OPS.calendarMonth.getMonth()+1,0);
  m.innerHTML=(typeof opsHeader==='function'?opsHeader('Доступность','Календарь','Выдачи, возвраты и занятость объектов по датам.'):'<h1>Календарь</h1>')+`<div class="calendar-toolbar"><button class="btn soft" onclick="moveCalendar(-1)" aria-label="Предыдущий месяц">←</button><div><small>Месяц</small><h2>${new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'}).format(first)}</h2></div><button class="btn soft" onclick="moveCalendar(1)" aria-label="Следующий месяц">→</button></div><div id="cal">Загрузка…</div>`;
  try{
    const rows=await opsCall(`/calendar?from=${iso(first)}&to=${iso(last)}`); OPS.calendarRows=rows||[];
    const today=iso(new Date());
    const days=[];
    for(let day=1;day<=last.getDate();day++){
      const ds=iso(new Date(first.getFullYear(),first.getMonth(),day));
      const ev=(rows||[]).filter(r=>r.start_date<=ds&&r.end_date>=ds);
      days.push({ds,day,ev});
    }
    const dow=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
    let cells=dow.map(x=>`<div class="calendar-dow">${x}</div>`).join('');
    const offset=(first.getDay()+6)%7; for(let i=0;i<offset;i++)cells+='<div class="calendar-day out"></div>';
    for(const d of days){
      cells+=`<button class="calendar-day ${d.ds===today?'today':''} ${d.ev.length?'busy':''}" onclick="calendarDay('${d.ds}')"><span class="calendar-num">${d.day}</span><span class="calendar-dots">${d.ev.slice(0,3).map(x=>`<i class="dot ${x.status}"></i>`).join('')}</span>${d.ev.length?`<small>${d.ev.length} ${d.ev.length===1?'бронь':'брони'}</small>`:'<small>свободно</small>'}</button>`;
    }
    const agenda=days.filter(d=>d.ev.length).map(d=>`<section class="agenda-day"><div class="agenda-date"><b>${d.day}</b><span>${new Intl.DateTimeFormat('ru-RU',{weekday:'short',month:'short'}).format(new Date(d.ds+'T00:00:00'))}</span></div><div class="agenda-events">${d.ev.map(r=>`<button class="agenda-event" onclick="calendarDay('${d.ds}')"><span class="agenda-status ${r.status}"></span><div><b>${esc(r.pcs_catalog_items?.title||'Бронь')}</b><small>${esc(r.pcs_contacts?.name||r.pcs_contacts?.username||'Клиент')} · ${rStatus(r.status)}</small></div></button>`).join('')}</div></section>`).join('');
    document.querySelector('#cal').innerHTML=`<div class="calendar-desktop"><div class="calendar-grid">${cells}</div></div><div class="calendar-mobile"><div class="calendar-mobile-summary"><b>${(rows||[]).length}</b><span>броней в этом месяце</span></div>${agenda||'<div class="empty premium-empty"><b>Месяц свободен</b><span>Подтверждённых броней пока нет.</span></div>'}</div>`;
  }catch(e){document.querySelector('#cal').innerHTML=`<div class="empty premium-empty"><b>Не удалось загрузить календарь</b><span>${esc(e.message)}</span></div>`}
};
window.calendarDay=function(ds){const ev=(OPS.calendarRows||[]).filter(r=>r.start_date<=ds&&r.end_date>=ds);openSheet(prettyDate(ds),`<div class="list">${ev.map(r=>typeof reservationCard==='function'?reservationCard(r):`<div class="item"><b>${esc(r.pcs_catalog_items?.title||'Бронь')}</b><p>${rStatus(r.status)}</p></div>`).join('')||'<div class="empty">На эту дату броней нет</div>'}</div>`)};

window.financePage=async function(){
  if(typeof opsNav==='function')opsNav(); const m=document.querySelector('#main'); if(!m)return;
  m.innerHTML=(typeof opsHeader==='function'?opsHeader('Деньги','Финансы','Доходы, расходы, депозиты и выплаты партнёрам.'):'<h1>Финансы</h1>')+'<div id="fin">Загрузка…</div>';
  try{
    const a=await opsCall('/finance'); const paid=(a||[]).filter(x=>x.status==='paid'); const sum=t=>paid.filter(x=>x.entry_type===t).reduce((s,x)=>s+Number(x.amount||0),0);
    const typeRu={income:'Доход',expense:'Расход',deposit:'Депозит',refund:'Возврат',partner_payout:'Выплата партнёру'};
    document.querySelector('#fin').innerHTML=`<div class="finance-summary"><div class="item"><span>Доход</span><b>${rMoney(sum('income'))}</b></div><div class="item"><span>Расход</span><b>${rMoney(sum('expense'))}</b></div><div class="item"><span>Партнёрам</span><b>${rMoney(sum('partner_payout'))}</b></div></div><div class="list finance-list">${(a||[]).map(x=>`<div class="item finance-row"><div><b>${esc(typeRu[x.entry_type]||x.entry_type||'Операция')}</b><p>${esc(x.counterparty||'')} ${esc(x.note||'')}</p></div><div><strong>${rMoney(x.amount,x.currency)}</strong><span class="pill">${rStatus(x.status)}</span></div></div>`).join('')||'<div class="empty premium-empty"><b>Операций пока нет</b><span>После первой оплаты здесь появится финансовая история.</span></div>'}</div>`;
  }catch(e){document.querySelector('#fin').innerHTML=`<div class="empty premium-empty"><b>Не удалось загрузить финансы</b><span>${esc(e.message)}</span></div>`}
};

function polish(){
 document.querySelectorAll('.brand').forEach(x=>x.textContent='PCS');
 document.querySelectorAll('.pill').forEach(x=>{const t=x.textContent.trim(); const ru=rStatus(t); if(ru!==t)x.textContent=ru; else {const i=rIntent(t); if(i!==t)x.textContent=i}});
 document.querySelectorAll('button').forEach(b=>{if(b.textContent.trim()==='CRM')b.textContent='Клиенты';});
}
let q=false;const mo=new MutationObserver(()=>{if(q)return;q=true;requestAnimationFrame(()=>{q=false;polish()})});mo.observe(document.documentElement,{childList:true,subtree:true});setTimeout(polish,0);
})();