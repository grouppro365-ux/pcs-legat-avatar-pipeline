(()=>{
'use strict';
const sources={ledger:'Журнал операций',settlements:'Расчёты с партнёрами',quotes:'Снимки цен'};
const types={income:'Доход',expense:'Расход',partner_payout:'Выплата партнёру',refund:'Возврат',deposit:'Депозит'};
const statuses={paid:'Оплачено',PAID:'Оплачено',pending:'Ожидает проверки',planned:'Запланировано',cancelled:'Отменено',canceled:'Отменено',rejected:'Отклонено',draft:'Черновик',PENDING:'Ожидает',DISPUTED:'Спор',OVERDUE:'Просрочено'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function cash(value,currency){
 if(value==null||value==='')return 'Не указано';const text=String(value);if(!/^-?\d+(?:\.\d+)?$/.test(text)||text.length>80)return 'Некорректная сумма';
 const [whole,fraction]=text.split('.');return whole.replace(/\B(?=(\d{3})+(?!\d))/g,'\u00a0')+(fraction?','+fraction:'')+' '+String(currency||'Не указана валюта');
}
const fmt=v=>{if(!v)return'—';try{return new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(v))}catch{return'Некорректная дата'}};
function header(){return typeof window.opsHeader==='function'?window.opsHeader('Деньги','Финансы','Операции PCS, расчёты с партнёрами и сохранённые цены.'):'<h1>Финансы</h1>'}
function row(x,source,index){
 let title,amount,meta;
 if(source==='ledger'){title=x.counterparty||types[x.entry_type]||x.entry_type||'Операция';amount=cash(x.amount,x.currency);meta=[types[x.entry_type]||x.entry_type,statuses[x.status]||x.status,'Создано: '+fmt(x.created_at)];}
 else if(source==='settlements'){title=x.partner_name||x.public_id||'Расчёт';amount=cash(x.expected_pcs_amount,x.currency);meta=[x.application_public_id,x.client_name,statuses[x.status]||x.status,'Клиент оплатил: '+cash(x.client_paid_amount,x.currency),'Ожидается PCS'];}
 else{title=x.application_public_id||'Снимок цены';amount=cash(x.client_total,x.currency);meta=[x.client_name,'Версия '+x.version,'Депозит: '+cash(x.deposit,x.currency),'Сохранено: '+fmt(x.immutable_at)];}
 return `<article class="finance-row"><div><div class="finance-row-title">${esc(title)}</div><div class="finance-row-meta">${meta.filter(Boolean).map(v=>`<span>${esc(v)}</span>`).join('')}</div></div><div class="finance-amount">${esc(amount)}</div><button class="btn soft compact" type="button" data-finance-row="${index}">Подробнее</button></article>`;
}
let state=null;
const active=s=>state===s&&window.PCS?.page==='finance'&&document.querySelector('#pcsFinanceScreen')===s.root;
function detail(x,source){
 const labels={id:'ID операции',public_id:'Номер расчёта',application_public_id:'Заявка',client_name:'Клиент',partner_name:'Партнёр',entry_type:'Тип',status:'Статус',payment_kind:'Назначение',payment_method:'Способ',counterparty:'Контрагент',receipt_name:'Имя чека',reservation_id:'ID брони в журнале PCS',deal_id:'ID сделки в журнале PCS',invoice_status:'Статус счёта',model:'Модель расчёта',payment_recipient:'Получатель',version:'Версия'};
 let html=Object.entries(labels).filter(([k])=>x[k]!=null&&x[k]!=='').map(([k,v])=>`<p><strong>${esc(v)}:</strong> ${esc(k==='status'?(statuses[x[k]]||x[k]):k==='entry_type'?(types[x[k]]||x[k]):x[k])}</p>`).join('');
 for(const [key,label] of Object.entries({amount:'Сумма операции',client_total:'Цена клиенту',deposit:'Депозит',client_paid_amount:'Клиент оплатил',expected_pcs_amount:'Ожидается PCS'}))if(x[key]!=null)html+=`<p><strong>${label}:</strong> ${esc(cash(x[key],x.currency))}</p>`;
 for(const [key,label] of Object.entries({created_at:'Создано',due_at:'Срок',paid_at:'Оплачено',partner_confirmed_at:'Партнёр подтвердил',immutable_at:'Цена сохранена',updated_at:'Обновлено'}))if(x[key])html+=`<p><strong>${label}:</strong> ${esc(fmt(x[key]))}</p>`;
 if(x.note)html+=`<p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(x.note)}</p>`;
 html+='<p class="muted">'+(source==='quotes'?'Снимок цены сохраняет условия расчёта. Он не подтверждает поступление денег.':source==='settlements'?'Расчёт хранит ожидания и статус взаиморасчётов с партнёром.':'Статус взят из действующего финансового журнала PCS.')+'</p>';
 window.openSheet(sources[source],html);
}
async function load(s){
 if(!active(s))return;const sequence=++s.sequence,snapshot={source:s.source,status:s.status,page:s.page};s.loading=true;const box=s.root.querySelector('[data-finance-list]');box.textContent='Загружаю…';
 try{
  const data=await window.opsCall('/finance?'+new URLSearchParams(snapshot));if(!active(s)||s.sequence!==sequence)return;
  if(!data||data.source!==snapshot.source||!Array.isArray(data.rows))throw Error('Некорректный ответ финансового журнала');
  box.innerHTML=data.rows.map((x,i)=>row(x,snapshot.source,i)).join('')||'<div class="finance-empty">Записей по этому фильтру нет</div>';
  box.innerHTML+=`<div class="toolbar"><button class="btn soft" data-finance-page="-1" ${snapshot.page===0?'disabled':''}>Назад</button><span>Страница ${snapshot.page+1}</span><button class="btn soft" data-finance-page="1" ${!data.truncated||snapshot.page>=5000?'disabled':''}>Далее</button></div>${data.truncated?'<p class="muted">Есть ещё записи. Откройте следующую страницу.</p>':''}`;
  box.querySelectorAll('[data-finance-row]').forEach(b=>b.addEventListener('click',()=>{if(active(s))detail(data.rows[Number(b.dataset.financeRow)],snapshot.source)}));
  box.querySelectorAll('[data-finance-page]').forEach(b=>b.addEventListener('click',()=>{if(active(s)&&!s.loading){s.page=snapshot.page+Number(b.dataset.financePage);load(s)}}));
 }catch(e){if(active(s)&&s.sequence===sequence)box.textContent=e.message||'Не удалось получить финансовые данные'}finally{if(active(s)&&s.sequence===sequence)s.loading=false}
}
async function render(){
 const main=document.querySelector('#main');if(!main)return;if(typeof window.opsNav==='function')window.opsNav();
 main.innerHTML=header()+`<section id="pcsFinanceScreen" class="finance-v26"><div class="toolbar"><label>Источник<select data-finance-source>${Object.entries(sources).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><label data-finance-filter>Статус<select data-finance-status><option value="all">Все</option><option value="paid">Оплачено</option><option value="pending">Ожидает проверки</option><option value="planned">Запланировано</option><option value="cancelled">Отменено</option><option value="rejected">Отклонено</option></select></label><button class="btn soft" data-finance-refresh>Обновить</button></div><p data-finance-context class="sub">Действующий журнал PCS. Каждая операция показана в своей валюте.</p><div class="finance-ledger" data-finance-list aria-live="polite"></div></section>`;
 const root=document.querySelector('#pcsFinanceScreen'),s=state={root,source:'ledger',status:'all',page:0,sequence:0,loading:false};
 root.querySelector('[data-finance-source]').addEventListener('change',e=>{s.source=e.target.value;s.page=0;s.status='all';root.querySelector('[data-finance-status]').value='all';root.querySelector('[data-finance-filter]').hidden=s.source!=='ledger';root.querySelector('[data-finance-context]').textContent=s.source==='ledger'?'Действующий журнал PCS. Каждая операция показана в своей валюте.':s.source==='settlements'?'Расчёты с партнёрами: оплачено клиентом и ожидается PCS.':'Сохранённые цены и депозиты. Снимок цены не подтверждает оплату.';load(s)});
 const refresh=()=>{const status=root.querySelector('[data-finance-status]').value.trim()||'all';if(!/^[A-Za-z_]{1,40}$/.test(status)){window.toast('Укажите all или код статуса латиницей');return}s.status=s.source==='ledger'?status:'all';s.page=0;load(s)};
 root.querySelector('[data-finance-refresh]').addEventListener('click',refresh);root.querySelector('[data-finance-status]').addEventListener('keydown',e=>{if(e.key==='Enter')refresh()});
 await load(s);if(active(s)){if(typeof window.pcsInstallNav25==='function')window.pcsInstallNav25();if(typeof window.pcsBrand26==='function')window.pcsBrand26()}
}
window.pcsFinance26=render;window.pcsFinanceFormat=cash;
})();
