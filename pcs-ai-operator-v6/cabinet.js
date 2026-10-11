(()=>{
 'use strict';
 const API='https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-manager-live2?op=portal';
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const states={NEW:'Новая заявка',TRIAGE:'Уточняем запрос',MATCHING:'Подбираем предложение',QUOTE_READY:'Предложения готовы',QUOTE_SENT:'Предложения отправлены',AWAITING_CLIENT_DECISION:'Ожидаем выбора',AWAITING_PARTNER_CONFIRMATION:'Подтверждение условий',CONFIRMED:'Сделка подтверждена',SERVICE_IN_PROGRESS:'Услуга выполняется',COMPLETED:'Услуга завершена',CANCELLED_BY_CLIENT:'Отменена клиентом',CANCELLED_BY_PARTNER:'Отменена партнёром',PAID_TO_PARTNER:'Оплата подтверждена',PARTIALLY_PAID:'Частичная оплата',AWAITING_PAYMENT:'Ожидаем оплату',INSTRUCTIONS_SENT:'Реквизиты доступны',NOT_REQUIRED_YET:'Оплата пока не требуется',PENDING:'На проверке',VERIFIED:'Подтверждено',REJECTED:'Отклонено',SUBMITTED:'Проверка оператором',APPROVED:'Можно выбрать',ACCEPTED:'Выбрано'};
 const label=x=>states[x]||x||'—';
 let token=location.hash.slice(1),data,busy=false,sequence=0;
 if(/^[a-f0-9]{64}$/.test(token)){sessionStorage.setItem('pcsCabinetToken',token);history.replaceState(null,'',location.pathname);}else token=sessionStorage.getItem('pcsCabinetToken')||'';
 const notice=document.getElementById('notice');
 async function api(body){const r=await fetch(API,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error||'Не удалось выполнить действие');return d;}
 async function refresh(){const seq=++sequence,current=token,result=await api();if(current!==token||seq!==sequence)return;data=result;render();notice.className='';notice.textContent='Доступ до '+new Date(data.expires_at).toLocaleString('ru-RU');}
 const controls=(a)=>{
  if(data.role==='PARTNER'){
   if(a.operational_status==='AWAITING_PARTNER_CONFIRMATION'&&a.partner_response_status==='NOT_SENT')return `<button data-action="confirm" data-app="${a.id}">Подтвердить выбранные условия</button><button data-action="decline" data-app="${a.id}">Отказаться</button>`;
   if(!a.selected_partner_offer_id&&['NEW','TRIAGE','MATCHING','QUOTE_READY','QUOTE_SENT','AWAITING_CLIENT_DECISION'].includes(a.operational_status))return `<form data-action="submit-offer" data-app="${a.id}"><h3>Предложить условия</h3><label>Стоимость услуги, THB<input name="price" type="number" min="0.01" max="9999999999" step="0.01" required></label><label>Возвратный депозит, THB<input name="deposit" type="number" min="0" max="9999999999" step="0.01" value="0" required></label><label>Условия<textarea name="terms" maxlength="4000" required></textarea></label><button>Отправить на проверку</button></form>`;
   return '';
  }
  if(a.operational_status==='AWAITING_PARTNER_CONFIRMATION'&&a.partner_response_status==='ACCEPTED')return `<button data-action="confirm" data-app="${a.id}">Подтверждаю условия сделки</button>`;
  if(a.operational_status==='CONFIRMED'&&a.payment_instructions&&['INSTRUCTIONS_SENT','AWAITING_PAYMENT','PARTIALLY_PAID'].includes(a.client_payment_status))return `<form data-action="payment" data-app="${a.id}"><h3>Сообщить об оплате партнёру</h3><p>${esc(a.payment_instructions)}</p><p class="muted">Поступление денег проверит оператор. Возвратный депозит учитывается отдельно от стоимости услуги.</p><label>Сумма оплаты услуги, THB<input name="amount" type="number" min="0.01" max="9999999999" step="0.01" required></label><label>Номер перевода или банковская ссылка на подтверждение<input name="reference" maxlength="500" required></label><button>Передать на проверку</button></form>`;
  return '';
 };
 function render(){
  document.getElementById('role').textContent=data.role==='CLIENT'?'Кабинет клиента':'Кабинет партнёра';
  document.getElementById('request').innerHTML=data.role==='CLIENT'?'<form data-action="request"><h2>Новая заявка</h2><label>Что вам нужно<textarea name="need" maxlength="4000" required></textarea></label><label>Город<input name="city" maxlength="200"></label><button>Отправить заявку</button></form>':'';
  document.getElementById('applications').innerHTML=data.applications.map(a=>`<article><h2>${esc(a.public_id)}</h2><p><span class="pill">${esc(label(a.operational_status))}</span></p><p>${esc(a.notes)}</p><p>Оплата: ${esc(label(a.client_payment_status))}</p>${a.agreed_price_thb?`<p>Согласовано: ${esc(a.agreed_price_thb)} THB · Депозит: ${esc(a.deposit_thb||'0')} THB</p><p>${esc(a.agreed_terms)}</p>`:''}${data.offers.filter(o=>o.application_id===a.id).map(o=>`<div class="offer"><b>${esc(o.item_title||o.partner_name||'Предложение')}</b><p>${esc(o.client_price_thb)} THB · Депозит ${esc(o.deposit_thb)} THB</p><p>${esc(o.terms)}</p><p>${esc(label(o.status))}</p>${data.role==='CLIENT'&&o.status==='APPROVED'&&!a.selected_partner_offer_id?`<button data-action="select-offer" data-app="${a.id}" data-offer="${o.id}">Выбрать предложение</button>`:''}</div>`).join('')}${controls(a)}${data.payments.filter(c=>c.application_id===a.id).map(c=>`<p>Перевод ${esc(c.amount_thb)} THB: ${esc(label(c.status))}${c.review_note?' — '+esc(c.review_note):''}</p>`).join('')}</article>`).join('')||'<p>Пока нет заявок.</p>';
  if(data.applications.length===data.limit)document.getElementById('applications').insertAdjacentHTML('beforeend','<p class="muted">Показаны 100 последних заявок. Более ранние можно запросить у оператора.</p>');
 }
 async function act(element,payload){
  if(busy)return;busy=true;document.querySelectorAll('button').forEach(x=>x.disabled=true);
  const action=element.dataset.action,application=data.applications.find(x=>x.id===element.dataset.app);
  if(application){payload.application_id=application.id;payload.expected_version=application.edit_version;}
  // Keep the exact receipt key and payload after an uncertain transport failure.
  const signature=JSON.stringify({action,payload});let saved;try{saved=JSON.parse(element.dataset.pending||'null')}catch{}
  const command=saved?.signature===signature?saved.command:{action,payload,request_id:crypto.randomUUID()};element.dataset.pending=JSON.stringify({signature,command});
  try{await api(command);notice.textContent='Сохранено';element.dataset.pending='';await refresh();}catch(e){notice.textContent=e.message;notice.className='error';}finally{busy=false;document.querySelectorAll('button').forEach(x=>x.disabled=false);}
 }
 document.addEventListener('submit',e=>{const form=e.target;if(!form.dataset.action)return;e.preventDefault();act(form,Object.fromEntries(new FormData(form)));});
 document.addEventListener('click',e=>{const b=e.target.closest('button[data-action]');if(b)act(b,b.dataset.offer?{offer_id:b.dataset.offer}:{});});
 document.getElementById('refresh').onclick=()=>{if(!busy&&token)refresh().catch(e=>notice.textContent=e.message);};
 document.getElementById('logout').onclick=()=>{sessionStorage.removeItem('pcsCabinetToken');token='';data=null;sequence++;document.getElementById('request').textContent='';document.getElementById('applications').textContent='';notice.textContent='Вы вышли из кабинета. Для входа откройте персональную ссылку.';};
 if(token)refresh().catch(e=>notice.textContent=e.message);else notice.textContent='Откройте персональную ссылку, которую выдал оператор PCS.';
})();
