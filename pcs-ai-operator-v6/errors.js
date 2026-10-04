(()=>{
const ERR_API='https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-errors-api';
async function errCall(path='',opt={}){const h={'content-type':'application/json',...(opt.headers||{})};const t=localStorage.pcsToken||'';if(t)h.authorization='Bearer '+t;const r=await fetch(ERR_API+path,{...opt,headers:h});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);return d}
const statusRu=s=>({failed:'Ошибка',retrying:'Повторяется',dlq:'Исчерпаны попытки',resolved:'Исправлено',review_required:'Требует проверки'})[s]||s||'—';
const operationRu=s=>({telegram_send:'Отправка сообщения в Telegram',telegram_update:'Обработка сообщения Telegram',ai_generation:'Генерация ответа ИИ'}[s]||s||'Операция');
const prevGo=window.go;window.go=function(p){if(p==='errors'){PCS.page='errors';document.querySelector('#root').innerHTML=shell();if(typeof opsNav==='function')opsNav();return errorsPage()}return prevGo(p)};
window.moreMenu=function(){openSheet('Ещё',`<div class="more-grid"><button class="btn soft" onclick="closeSheet();go('crm')">Клиенты</button><button class="btn blue" onclick="closeSheet();go('approvals')">Требуют ответа</button><button class="btn sage" onclick="closeSheet();go('kb')">База знаний</button><button class="btn soft" onclick="closeSheet();go('finance')">Финансы</button><button class="btn ghost" onclick="closeSheet();go('errors')">Ошибки и повторы</button><button class="btn ghost" onclick="closeSheet();go('status')">Состояние системы</button><button class="btn danger" onclick="logout()">Выйти</button></div>`)};
function fmt(v){if(!v)return'—';try{return new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(v))}catch{return String(v)}}
let errorSource='runtime',errorPage=0,loading=false;
const validContact=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id);
async function errorsPage(source=errorSource,page=errorPage){
 if(loading||!['runtime','delivery'].includes(source)||!Number.isInteger(page)||page<0||page>5000)return;
 errorSource=source;errorPage=page;loading=true;
 const m=document.querySelector('#main');if(!m){loading=false;return}
 m.innerHTML=`<div class="eyebrow">Надёжность</div><h1 class="title">Ошибки и проверка доставки</h1><p class="sub">Очередь обработки событий и ручные отправки с неизвестным результатом.</p><div class="toolbar"><button class="btn ${source==='runtime'?'':'soft'}" onclick="errorsPage('runtime',0)">Обработка событий</button><button class="btn ${source==='delivery'?'':'soft'}" onclick="errorsPage('delivery',0)">Проверить доставку</button></div><p class="sub">${source==='runtime'?'Действующая очередь обработчика. Ручной повтор требует проверки операции.':'Проверьте фактический диалог клиента. Эти сообщения автоматически не пересылаются.'}</p><div id="errList" class="list">Загрузка…</div>`;
 const target=document.querySelector('#errList');
 try{
  const data=await errCall('?source='+source+'&page='+page);if(document.querySelector('#errList')!==target)return;
  if(!data||data.source!==source||!Array.isArray(data.rows))throw Error('Некорректный ответ очереди');
  window.pcsDeliveryReview?.setRows(source==='delivery'?data.rows:[]);
  target.innerHTML=data.rows.map((x,index)=>`<div class="item booking-row"><div><div class="pills"><span class="pill warn">${esc(source==='delivery'?'Доставка не подтверждена':statusRu(x.status))}</span><span class="pill">${esc(source==='delivery'?(x.operation==='ai_approval'?'AI-согласование':'Сообщение CRM'):operationRu(x.operation))}</span>${source==='runtime'?`<span class="pill">попыток ${Number(x.attempts||0)}</span>`:''}</div><h3>${esc(source==='delivery'?(x.contact_name||'Клиент'):(x.error||'Без текста ошибки'))}</h3><p>Создано: ${esc(fmt(x.created_at))}${x.next_retry_at?` · следующая попытка: ${esc(fmt(x.next_retry_at))}`:''}</p>${source==='delivery'?`<p class="muted">Попытка: ${esc(x.id)}</p>`:''}</div>${source==='delivery'&&validContact(x.contact_id)?`<button class="btn soft" onclick="openClient('${x.contact_id}',false)">Диалог клиента</button>${x.operation==='crm_manual'&&typeof x.edit_version==='string'?`<button class="btn soft" onclick="pcsDeliveryReview.open(${index})">Подтвердить доставку</button>`:''}`:''}</div>`).join('')||'<div class="empty">Записей в этой очереди нет</div>';
  target.innerHTML+=`<div class="toolbar"><button class="btn soft" ${page===0?'disabled':''} onclick="errorsPage('${source}',${page-1})">Назад</button><span>Страница ${page+1}</span><button class="btn soft" ${!data.truncated||page===5000?'disabled':''} onclick="errorsPage('${source}',${page+1})">Далее</button></div>`;
 }catch(e){if(document.querySelector('#errList')===target)target.textContent=e.message||'Не удалось получить очередь'}finally{loading=false}
}
window.retryFailedJob=()=>toast('Повтор требует проверки обработчика. Проверьте операцию и фактическую доставку.');window.errorsPage=errorsPage;
})();
