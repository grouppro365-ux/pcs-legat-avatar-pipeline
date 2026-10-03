(()=>{
 'use strict';
 const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const valid=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id);
 const statuses=['NEW','QUALIFYING','QUALIFIED','OFFER_SENT','WAITING_CLIENT','IN_PROGRESS','BOOKED','PAID','COMPLETED','LOST','SPAM'];
 const fields=[['name','Имя',200],['phone','Телефон',100],['username','Telegram username',100],['language','Язык',20],['city','Город',200],['country','Страна',200],['budget','Бюджет',500],['need','Запрос',4000],['next_action','Следующий шаг',4000]];
 let editor=null,taskDraft=null;const busy=new Set();
 const options=(values,current)=>values.map(v=>`<option value="${v}" ${v===current?'selected':''}>${v}</option>`).join('');
 const dateInput=v=>{if(!v)return '';const d=new Date(v);return Number.isFinite(d.getTime())?new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16):''};
 const dateValue=v=>{if(!v)return null;const d=new Date(v);if(!Number.isFinite(d.getTime()))throw Error('Укажите корректную дату');return d.toISOString()};
 async function edit(id){
  if(!valid(id))return;
  try{
   const d=await window.call('/crm/'+id),c=d.contact||d;
   editor={id,version:c.edit_version,original:c};
   window.openSheet('Редактировать клиента',`<form id="crmEditorForm" onsubmit="event.preventDefault();pcsCrmEditor.save()"><div class="grid2">${fields.map(([key,label,max])=>`<div class="field"><label for="crmEdit_${key}">${label}</label>${max>500?`<textarea id="crmEdit_${key}" maxlength="${max}">${E(c[key])}</textarea>`:`<input id="crmEdit_${key}" maxlength="${max}" value="${E(c[key])}">`}</div>`).join('')}<div class="field"><label for="crmEdit_status">Статус CRM</label><select id="crmEdit_status">${options(statuses,c.status)}</select></div><div class="field"><label for="crmEdit_priority">Приоритет</label><select id="crmEdit_priority">${options(['LOW','NORMAL','HOT','URGENT'],c.priority)}</select></div><div class="field"><label for="crmEdit_next_action_at">Дата следующего шага</label><input id="crmEdit_next_action_at" type="datetime-local" value="${dateInput(c.next_action_at)}"></div></div><p class="muted">Изменение статуса CRM не подтверждает оплату и не меняет финансовые записи.</p><p id="crmEditorError" role="alert" class="contract-fact-error"></p><button id="crmEditorSave" class="btn" type="submit">Сохранить</button></form>`);
   return true;
  }catch{window.toast('Не удалось загрузить карточку клиента');return false}
 }
 async function refresh(id){try{window.PCS.crm=await window.call('/crm');await window.openClient(id,false)}catch{window.toast('Изменения сохранены. Обновите карточку клиента.')}}
 async function save(){
  const form=document.getElementById('crmEditorForm'),state=editor;if(!form||!state||busy.has('save'))return;
  const button=document.getElementById('crmEditorSave'),error=document.getElementById('crmEditorError');
  error.textContent='';
  try{
   const body={expected_version:state.version};
   for(const [key] of fields){const v=document.getElementById('crmEdit_'+key).value.trim()||null;if(v!==(state.original[key]||null))body[key]=v}
   for(const key of ['status','priority']){const v=document.getElementById('crmEdit_'+key).value;if(v!==state.original[key])body[key]=v}
   const raw=document.getElementById('crmEdit_next_action_at').value;
   // Preserve seconds and the absence of a reminder when the date field was not edited.
   if(raw!==dateInput(state.original.next_action_at))body.next_action_at=dateValue(raw);
   if(Object.keys(body).length===1){error.textContent='Нет изменений для сохранения.';return}
   busy.add('save');button.disabled=true;
   const result=await window.call('/crm/'+state.id,{method:'PATCH',body:JSON.stringify(body)});
   state.version=result.contact.edit_version;state.original=result.contact;
   window.toast('Карточка сохранена');if(document.getElementById('crmEditorForm')===form){window.closeSheet();await refresh(state.id)}
  }catch(e){if(document.getElementById('crmEditorForm')===form)error.textContent=e.message||'Не удалось сохранить. Повторите попытку.'}
  finally{busy.delete('save');if(document.getElementById('crmEditorForm')===form)button.disabled=false}
 }
 function taskForm(id){
  if(!valid(id))return;
  taskDraft={contact:id,id:crypto.randomUUID()};
  window.openSheet('Новая задача',`<form id="crmTaskForm" onsubmit="event.preventDefault();pcsCrmEditor.createTask()"><div class="field"><label for="crmTaskTitle">Задача</label><input id="crmTaskTitle" required maxlength="300"></div><div class="field"><label for="crmTaskComment">Комментарий</label><textarea id="crmTaskComment" maxlength="4000"></textarea></div><div class="field"><label for="crmTaskDue">Срок (необязательно)</label><input id="crmTaskDue" type="datetime-local"></div><p id="crmTaskError" role="alert" class="contract-fact-error"></p><button id="crmTaskSave" class="btn" type="submit">Создать задачу</button></form>`);
 }
 async function createTask(){
  const form=document.getElementById('crmTaskForm'),state=taskDraft;if(!form||!state||busy.has('task'))return;
  const button=document.getElementById('crmTaskSave'),error=document.getElementById('crmTaskError');error.textContent='';
  try{
   const title=document.getElementById('crmTaskTitle').value.trim();if(!title){error.textContent='Укажите задачу.';return}
   const body={id:state.id,title,comment:document.getElementById('crmTaskComment').value.trim()||null,due_at:dateValue(document.getElementById('crmTaskDue').value)};
   busy.add('task');button.disabled=true;await window.call('/crm/'+state.contact+'/tasks',{method:'POST',body:JSON.stringify(body)});
   window.toast('Задача создана');if(document.getElementById('crmTaskForm')===form){window.closeSheet();await refresh(state.contact)}
  }catch(e){if(document.getElementById('crmTaskForm')===form)error.textContent=e.message||'Не удалось создать задачу'}
  finally{busy.delete('task');if(document.getElementById('crmTaskForm')===form)button.disabled=false}
 }
 async function complete(cid,tid){
  if(!valid(cid)||!valid(tid)||busy.has(tid))return;busy.add(tid);
  try{await window.call('/crm/'+cid+'/complete-task/'+tid,{method:'POST',body:'{}'});window.toast('Задача завершена');await refresh(cid)}catch(e){window.toast(e.message||'Не удалось завершить задачу')}finally{busy.delete(tid)}
 }
 async function action(id,kind){
  if(!['hot','waiting','lost','paid','ready_to_pay'].includes(kind))return;
  if(!await edit(id))return;
  if(!document.getElementById('crmEditorForm')||editor?.id!==id)return;
  if(kind==='hot')document.getElementById('crmEdit_priority').value='HOT';
  const target={waiting:'WAITING_CLIENT',lost:'LOST',paid:'PAID'}[kind];
  if(target)document.getElementById('crmEdit_status').value=target;
  if(kind==='ready_to_pay'){
   const field=document.getElementById('crmEdit_next_action');
   const note='Клиент готов к оплате.';
   if(!field.value.includes(note)&&field.value.length+note.length+1<=4000)field.value=note+(field.value?'\n'+field.value:'');
  }
  window.toast('Проверьте изменения и нажмите «Сохранить».');
 }
 window.pcsCrmEditor={edit,save,taskForm,createTask,complete,action};
 window.clientAction=action;
 window.editClient=edit;window.taskForm=taskForm;window.createTask=createTask;window.completeTask=complete;
})();
