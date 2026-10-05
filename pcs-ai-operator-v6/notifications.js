(()=>{
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=x=>x?new Date(x).toLocaleString('ru-RU'):'—';
 const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
 let state=null,applicationSequence=0;
 const active=s=>state===s&&document.getElementById('pcsNotificationList')===s.root;
 async function load(s){
  if(!active(s))return;const seq=++s.sequence,view=s.view,page=s.page;document.getElementById('pcsNotificationMessage').textContent='';s.root.textContent='Загружаю события…';
  document.getElementById('pcsNotificationPrev').disabled=true;document.getElementById('pcsNotificationNext').disabled=true;
  try{const d=await window.call('/notifications?'+new URLSearchParams({view,page}));if(!active(s)||seq!==s.sequence)return;
   if(d.view!==view||!Array.isArray(d.rows))throw Error('Некорректный ответ уведомлений');s.rows=d.rows;
   s.root.innerHTML=d.rows.map((x,i)=>`<article class="item"><b>${esc(x.title||'Событие PCS')}</b><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(x.body)}</p><p class="muted">${esc(fmt(x.created_at))} · ${esc(x.status)} · ${x.read_at?'Прочитано':'Не прочитано'}</p>${!x.read_at&&uuid(x.id)&&/^[0-9a-f]{32}$/.test(x.read_version||'')?`<button class="btn soft" data-notification-read="${i}">Отметить прочитанным</button>`:''}${['application','applications'].includes(x.entity_type)&&uuid(x.entity_id)?`<button class="btn soft" data-notification-application="${i}">Открыть заявку</button>`:''}</article>`).join('')||'<p class="muted">В этом списке событий нет.</p>';
   s.root.onclick=e=>{const read=e.target.closest?.('[data-notification-read]');if(read){acknowledge(s,Number(read.dataset.notificationRead),read);return}const b=e.target.closest?.('[data-notification-application]');if(b){const x=s.rows[Number(b.dataset.notificationApplication)];if(x&&uuid(x.entity_id))openApplication(x.entity_id);}};
   document.getElementById('pcsNotificationPrev').disabled=page===0;document.getElementById('pcsNotificationNext').disabled=!d.truncated||page>=5000;
  }catch(e){if(active(s)&&seq===s.sequence)s.root.textContent=e.message||'Не удалось загрузить события';}
 }
 async function acknowledge(s,index,button){
  const x=s.rows[index];if(!active(s)||s.reading||!x||x.read_at||!uuid(x.id))return;
  s.reading=true;button.disabled=true;const seq=s.sequence;
  try{const d=await window.call('/notification-read',{method:'POST',body:JSON.stringify({id:x.id,expected_version:x.read_version})});
   if(!active(s)||seq!==s.sequence)return;
   if(!d.ok||d.id!==x.id||!d.read_at||!Number.isFinite(Date.parse(d.read_at)))throw Error('Не удалось подтвердить прочтение');
   await load(s);
  }catch(e){if(active(s)&&seq===s.sequence){document.getElementById('pcsNotificationMessage').textContent=e.message||'Не удалось отметить прочтение. Обновите список и повторите.';button.disabled=false;}}
  finally{s.reading=false;}
 }
 async function open(){
  window.openSheet('События PCS',`<div class="toolbar"><select aria-label="Список событий" id="pcsNotificationView" style="min-height:44px;max-width:100%"><option value="unread">Непрочитанные</option><option value="all">Все</option></select><button class="btn soft" id="pcsNotificationRefresh">Обновить</button><button class="btn soft" onclick="closeSheet();go('errors')">Ошибки и доставка</button></div><p id="pcsNotificationMessage" role="status" class="muted"></p><div id="pcsNotificationList" class="list" aria-live="polite"></div><div class="toolbar"><button class="btn soft" id="pcsNotificationPrev" disabled>Назад</button><button class="btn soft" id="pcsNotificationNext" disabled>Далее</button></div>`);
  const s=state={root:document.getElementById('pcsNotificationList'),view:'unread',page:0,sequence:0,rows:[]};
  document.getElementById('pcsNotificationView').onchange=e=>{s.view=e.target.value;s.page=0;load(s)};
  document.getElementById('pcsNotificationRefresh').onclick=()=>load(s);
  document.getElementById('pcsNotificationPrev').onclick=()=>{s.page=Math.max(0,s.page-1);load(s)};
  document.getElementById('pcsNotificationNext').onclick=()=>{s.page++;load(s)};
  await load(s);
 }
 async function openApplication(id){
  if(!uuid(id))return;const seq=++applicationSequence;
  window.openSheet('Заявка PCS','<div id="pcsOperationalApplication" aria-live="polite">Загружаю заявку…</div>');const box=document.getElementById('pcsOperationalApplication');
  try{const d=await window.opsCall('/applications/'+id);if(seq!==applicationSequence||document.getElementById('pcsOperationalApplication')!==box)return;if(d.application?.id!==id)throw Error('Некорректная заявка');
   const a=d.application,labels={public_id:'Номер',client_name:'Клиент',category:'Направление',operational_status:'Статус',human_review_reason:'Причина проверки',execution_issue_status:'Проблема исполнения',execution_issue_summary:'Описание проблемы',next_action_code:'Следующее действие'};
   box.innerHTML=Object.entries(labels).filter(([k])=>a[k]!=null).map(([k,label])=>`<p><b>${label}:</b> ${esc(a[k])}</p>`).join('')+`<p><b>Срок SLA:</b> ${esc(fmt(a.sla_due_at))}</p><p><b>Следующее действие:</b> ${esc(fmt(a.next_action_at))}</p>`;
  }catch(e){if(seq===applicationSequence&&document.getElementById('pcsOperationalApplication')===box)box.textContent=e.message||'Не удалось загрузить заявку';}
 }
 window.pcsNotifications={open};window.pcsOpenOperationalApplication=openApplication;
})();
