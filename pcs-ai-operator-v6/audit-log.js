(()=>{
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const time=x=>x?new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(x)?x:String(x).replace(' ','T')+'Z').toLocaleString('ru-RU'):'—';
 const labels={contact_updated:'Клиент изменён',task_created:'Задача создана',task_updated:'Задача изменена',task_completed:'Задача завершена',notification_read:'Уведомление прочитано',prospect_source_scanned:'Источник Telegram проверен',prospect_review_classified:'Запросы Telegram проверены','applications.update':'Заявка изменена','applications.insert':'Заявка создана','catalog_items.update':'Карточка каталога изменена','catalog_items.insert':'Карточка каталога создана',SUCCESS:'Успешно',FAILED:'Ошибка',ADMIN:'Оператор',contacts:'Клиенты',tasks:'Задачи',applications:'Заявки',catalog_items:'Каталог',notifications:'Уведомления',prospect_source:'Источник Telegram',prospect_run:'Проверка запросов',read_at:'Прочтение',updated_at:'Время изменения',operational_status:'Статус заявки',qualification_data:'Данные запроса',next_action:'Следующий шаг',next_action_at:'Срок действия',status:'Статус',name:'Имя',title:'Название',due_at:'Срок задачи',priority:'Приоритет'};
 const label=x=>labels[x]||x;
 let state=null;
 const active=s=>state===s&&document.getElementById('pcsAuditList')===s.root;
 async function load(s){
  if(!active(s))return;const seq=++s.sequence,source=s.source,page=s.page;s.root.textContent='Загружаю журнал…';
  document.getElementById('pcsAuditPrev').disabled=true;document.getElementById('pcsAuditNext').disabled=true;
  try{const d=await window.call('/audit?'+new URLSearchParams({source,page}));if(!active(s)||seq!==s.sequence)return;
   if(d.source!==source||d.page!==page||!Array.isArray(d.rows))throw Error('Некорректный ответ журнала');
   s.root.innerHTML=d.rows.map(x=>`<article class="item" style="overflow-wrap:anywhere"><b>${esc(label(x.action)||'Действие PCS')}</b><p>${esc(time(x.created_at))} · ${esc(label(x.actor)||'Исполнитель не указан')}${x.result?' · '+esc(label(x.result)):''}</p><p>${esc(label(x.entity_type))} · ${esc(x.entity_id)}</p>${Array.isArray(x.changed_fields)&&x.changed_fields.length?`<p class="muted">Поля: ${esc(x.changed_fields.map(label).join(', '))}</p>`:''}</article>`).join('')||'<p class="muted">В этом источнике записей нет.</p>';
   document.getElementById('pcsAuditPrev').disabled=page===0;document.getElementById('pcsAuditNext').disabled=!d.truncated||page>=5000;
  }catch(e){if(active(s)&&seq===s.sequence)s.root.textContent=e.message||'Журнал временно недоступен. Повторите загрузку.';}
 }
 async function open(){
  window.openSheet('Журнал действий',`<p class="muted">История сохранённых действий. Выберите источник; показаны названия изменённых полей.</p><div class="toolbar"><select aria-label="Источник журнала" id="pcsAuditSource" style="min-height:44px;max-width:100%"><option value="crm">CRM и коммуникации</option><option value="business">Каталог и операции</option></select><button class="btn soft" id="pcsAuditRefresh">Обновить</button></div><div id="pcsAuditList" class="list" aria-live="polite"></div><div class="toolbar"><button class="btn soft" id="pcsAuditPrev" disabled>Назад</button><button class="btn soft" id="pcsAuditNext" disabled>Далее</button></div>`);
  const s=state={root:document.getElementById('pcsAuditList'),source:'crm',page:0,sequence:0};
  document.getElementById('pcsAuditSource').onchange=e=>{s.source=e.target.value;s.page=0;load(s)};
  document.getElementById('pcsAuditRefresh').onclick=()=>load(s);
  document.getElementById('pcsAuditPrev').onclick=()=>{s.page=Math.max(0,s.page-1);load(s)};
  document.getElementById('pcsAuditNext').onclick=()=>{s.page++;load(s)};await load(s);
 }
 window.pcsAudit={open};
 for(const name of ['moreMenu','pcs25Menu']){const previous=window[name];if(typeof previous!=='function')continue;window[name]=function(...args){const result=previous.apply(this,args),grid=document.querySelector('.sheetbox .v26-more,.sheetbox .more-grid,.sheetbox .action-grid');if(grid){const button=document.createElement('button');button.className='btn soft';button.textContent='Журнал действий';button.onclick=open;grid.appendChild(button);}return result;};}
})();
