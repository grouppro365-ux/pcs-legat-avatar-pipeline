(()=>{
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const valid=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id);
const priorities={LOW:'Низкий',NORMAL:'Обычный',HIGH:'Высокий',URGENT:'Срочный'};
let state=null,ticket=0;
const date=v=>{if(!v)return'';const raw=String(v),d=new Date(/[Zz]$|[+-]\d{2}:?\d{2}$/.test(raw)?raw:raw.replace(' ','T')+'Z');if(!Number.isFinite(d.valueOf()))return'';return new Date(d.valueOf()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)};
async function open(cid,tid,origin='queue'){
 if(!valid(cid)||!valid(tid))return;const request=++ticket,page=window.PCS?.page,box=document.getElementById('sheetbox'),previous=box?.innerHTML,sheet=document.getElementById('sheet'),wasOpen=sheet?.classList.contains('on');
 try{
  const data=await window.call('/crm/'+cid+'/tasks/'+tid);if(request!==ticket||page!==window.PCS?.page||(box&&box.innerHTML!==previous)||(wasOpen&&!sheet.classList.contains('on')))return;
  const t=data.task;if(!t||t.id!==tid||t.contact_id!==cid||typeof t.edit_version!=='string')throw Error('Сервер не подтвердил задачу');if(t.completed_at){window.toast('Задача уже завершена');return}
  const due=date(t.due_at);
  window.openSheet('Изменить задачу',`<form id="pcsTaskEditForm"><div class="field"><label>Задача<input id="pcsTaskTitle" required maxlength="300" value="${esc(t.title)}"></label></div><div class="field"><label>Комментарий<textarea id="pcsTaskComment" maxlength="4000">${esc(t.comment)}</textarea></label></div><div class="field"><label>Приоритет<select id="pcsTaskPriority">${Object.entries(priorities).map(([k,v])=>`<option value="${k}" ${t.priority===k?'selected':''}>${v}</option>`).join('')}</select></label></div><div class="field"><label>Срок по вашему местному времени<input id="pcsTaskDue" type="datetime-local" value="${due}"></label><p class="muted">Оставьте пустым, если срока нет.</p></div><div class="field"><label>Ответственный<input id="pcsTaskAssignee" maxlength="200" value="${esc(t.assignee)}"></label></div><p id="pcsTaskEditError" role="alert"></p><button class="btn" id="pcsTaskEditSave" type="submit">Сохранить изменения</button></form>`);
  const form=document.getElementById('pcsTaskEditForm');state={form,cid,tid,origin:origin==='client'?'client':'queue',version:t.edit_version,busy:false,original:{title:t.title,comment:t.comment||'',priority:t.priority,due_at:due,assignee:t.assignee||''}};
  form.addEventListener('submit',e=>{e.preventDefault();submit()});
 }catch(e){if(request===ticket&&page===window.PCS?.page&&(!box||box.innerHTML===previous))window.toast(e.message||'Не удалось открыть задачу')}
}
async function submit(){
 const s=state;if(!s||s.busy||document.getElementById('pcsTaskEditForm')!==s.form)return;
 const nodes={title:document.getElementById('pcsTaskTitle'),comment:document.getElementById('pcsTaskComment'),priority:document.getElementById('pcsTaskPriority'),due_at:document.getElementById('pcsTaskDue'),assignee:document.getElementById('pcsTaskAssignee')},error=document.getElementById('pcsTaskEditError'),button=document.getElementById('pcsTaskEditSave');
 const patch={expected_version:s.version};
 for(const [key,node] of Object.entries(nodes)){const value=node.value.trim();if(value===String(s.original[key]))continue;if(key==='due_at'){if(value&&!Number.isFinite(new Date(value).valueOf())){error.textContent='Проверьте срок задачи';return}patch[key]=value?new Date(value).toISOString():null}else patch[key]=key==='comment'||key==='assignee'?value||null:value}
 if(!Object.hasOwn(patch,'title')&&!s.original.title||patch.title===''){error.textContent='Укажите название задачи';return}
 if(Object.keys(patch).length===1){error.textContent='Нет изменений для сохранения';return}
 s.busy=true;button.disabled=true;button.textContent='Сохраняю…';Object.values(nodes).forEach(n=>n.disabled=true);error.textContent='';
 try{
  const response=await window.call('/crm/'+s.cid+'/tasks/'+s.tid,{method:'PATCH',body:JSON.stringify(patch)});if(!response?.ok||response.task?.id!==s.tid||response.task?.contact_id!==s.cid)throw Error('Сохранение задачи не подтверждено');
  window.toast('Задача обновлена');if(state===s&&document.getElementById('pcsTaskEditForm')===s.form){window.closeSheet();try{if(s.origin==='client')await window.openClient(s.cid,false);else await window.pcsTaskQueue.open()}catch{window.toast('Задача сохранена. Обновите список задач.')}}
 }catch(e){if(state===s&&document.getElementById('pcsTaskEditForm')===s.form)error.textContent=e.message||'Сохранение не подтверждено. Обновите задачу перед повтором.'}
 finally{s.busy=false;if(state===s&&document.getElementById('pcsTaskEditForm')===s.form){button.disabled=false;button.textContent='Сохранить изменения';Object.values(nodes).forEach(n=>n.disabled=false)}}
}
window.pcsTaskEdit={open,submit,localDate:date};
})();
