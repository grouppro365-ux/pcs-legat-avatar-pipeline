(()=>{
 'use strict';
 const valid=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id);
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const priority={LOW:'Низкий',NORMAL:'Обычный',HIGH:'Высокий',URGENT:'Срочный'};
 const busy=new Set();let state=null;
 function active(s){return state===s&&document.getElementById('crmTaskQueue')===s.root}
 function paging(s){
  if(!active(s))return;
  document.getElementById('crmTaskQueuePrevious').disabled=s.loading||s.page===0;
  document.getElementById('crmTaskQueueNext').disabled=s.loading||!s.loaded||!s.truncated;
 }
 function draw(s){
  if(!active(s))return;
  const list=document.getElementById('crmTaskQueueList');
  list.innerHTML=s.rows.map((t,i)=>{
   const safe=valid(t.id)&&valid(t.contact_id),working=busy.has(t.id);
   return `<article class="item"><b>${esc(t.title)}</b><p>${esc(t.contact_name||t.contact_username||'Клиент')}</p>${t.comment?`<p>${esc(t.comment)}</p>`:''}<div class="pills"><span class="pill">${esc(priority[t.priority]||t.priority||'Обычный')}</span>${t.is_overdue?'<span class="pill warn">Просрочена</span>':''}<span class="pill">${t.due_at?esc(window.fmtDateTime(t.due_at)):'Без срока'}</span></div><div class="actions"><button class="btn ghost compact" type="button" ${safe?'':'disabled'} onclick="pcsTaskQueue.client(${i})">Клиент</button><button class="btn soft compact" type="button" ${safe&&!working?'':'disabled'} onclick="pcsTaskQueue.complete(${i})">${working?'Сохраняем…':'Завершить'}</button></div></article>`;
  }).join('')||'<p class="muted">В этом списке нет открытых задач.</p>';
  document.getElementById('crmTaskQueueLimit').textContent=s.truncated?'Есть ещё задачи. Откройте следующую страницу.':'';
  paging(s);
 }
 async function load(s){
  if(!active(s))return;const seq=++s.sequence,view=s.view,page=s.page;s.loading=true;s.loaded=false;paging(s);
  document.getElementById('crmTaskQueueError').textContent='';
  document.getElementById('crmTaskQueueList').textContent='Загрузка задач…';
  document.getElementById('crmTaskQueueLimit').textContent='';
  s.rows=[];
  try{
   const data=await window.call('/crm-tasks?view='+view+'&page='+page);
   if(!active(s)||seq!==s.sequence)return;
   if(!Array.isArray(data.tasks))throw new Error('Список задач не получен. Повторите загрузку.');
   s.rows=data.tasks;s.truncated=data.truncated===true;s.loading=false;s.loaded=true;draw(s);
  }catch(e){
   if(!active(s)||seq!==s.sequence)return;
   s.loading=false;s.loaded=false;paging(s);
   document.getElementById('crmTaskQueueList').textContent='';
   document.getElementById('crmTaskQueueError').textContent=e.message||'Не удалось загрузить задачи.';
  }
 }
 async function open(){
  window.openSheet('Задачи CRM',`<section id="crmTaskQueue"><div class="field"><label for="crmTaskQueueView">Показать</label><select id="crmTaskQueueView" onchange="pcsTaskQueue.filter(this.value)"><option value="open">Все открытые</option><option value="overdue">Просроченные</option><option value="undated">Без срока</option></select></div><button class="btn ghost compact" type="button" onclick="pcsTaskQueue.reload()">Обновить</button><p id="crmTaskQueueError" role="alert"></p><p id="crmTaskQueueLimit" class="muted"></p><div id="crmTaskQueueList" class="list" aria-live="polite"></div><div class="actions"><button id="crmTaskQueuePrevious" class="btn ghost compact" type="button" onclick="pcsTaskQueue.page(-1)" disabled>Назад</button><button id="crmTaskQueueNext" class="btn ghost compact" type="button" onclick="pcsTaskQueue.page(1)" disabled>Далее</button></div></section>`);
  state={root:document.getElementById('crmTaskQueue'),view:'open',page:0,rows:[],sequence:0,truncated:false,loading:false,loaded:false};await load(state);
 }
 async function filter(view){if(!['open','overdue','undated'].includes(view)||!state)return;state.view=view;state.page=0;await load(state)}
 async function page(direction){const s=state;if(!s||!active(s)||s.loading||![1,-1].includes(direction)||(direction===-1&&s.page===0)||(direction===1&&(!s.loaded||!s.truncated)))return;s.page+=direction;await load(s)}
 async function complete(i){
  const s=state,t=s?.rows[i];if(!s||!active(s)||!t||!valid(t.id)||!valid(t.contact_id)||busy.has(t.id))return;
  busy.add(t.id);draw(s);
  try{
   await window.call('/crm/'+t.contact_id+'/complete-task/'+t.id,{method:'POST',body:'{}'});
   window.toast('Задача завершена');
   if(active(s)){s.rows=s.rows.filter(row=>row.id!==t.id);draw(s);await load(s)}
  }catch(e){if(active(s))document.getElementById('crmTaskQueueError').textContent=e.message||'Не удалось завершить задачу.'}
  finally{busy.delete(t.id);if(active(s)&&s.rows.length)draw(s)}
 }
 async function client(i){const t=state?.rows[i];if(!t||!valid(t.contact_id))return;window.closeSheet();try{await window.go('crm');await window.openClient(t.contact_id,false)}catch(e){window.toast(e.message||'Не удалось открыть клиента.')}}
 window.pcsTaskQueue={open,filter,page,complete,client,reload:()=>state&&load(state)};
})();
