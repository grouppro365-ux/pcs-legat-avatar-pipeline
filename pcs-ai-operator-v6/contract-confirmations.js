(()=>{
 'use strict';
 const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const time=s=>{const d=new Date(s);return Number.isFinite(d.getTime())?d.toLocaleString('ru-RU'):'—'};
 const messages={confirmation_required:'Поставьте отметку подтверждения.',invalid_confirmation_date:'Укажите фактические дату и время в прошлом.',operator_name_required:'Укажите имя менеджера (2–120 символов).',confirmation_note_required:'Опишите основание подтверждения (5–1000 символов).',contract_not_ready_to_sign:'Сначала проверьте поля и подтвердите финальную версию.',contract_not_current:'Это предыдущая версия. Откройте актуальный договор.',fact_already_confirmed:'Это действие уже подтверждено. Обновите договор.',booking_not_confirmed:'Сначала подтвердите бронь.',handover_required:'Сначала подтвердите выдачу автомобиля.',return_required:'Сначала подтвердите возврат автомобиля.',return_before_handover:'Возврат не может быть раньше выдачи.',invalid_rental_transition:'Статус брони изменился. Обновите договор.',rental_status_changed:'Статус брони изменился. Обновите договор и повторите действие.',unauthorized:'Нужно повторно войти в PCS.'};
 let submitting=false;
 function fact(title,value){return `<section class="contract-fact"><b>${E(title)}</b><span>${E(time(value.occurred_at))}</span><small>Подтвердил(а): ${E(value.operator_name)} · ${E(time(value.confirmed_at))}</small><p>${E(value.note)}</p></section>`}
 function render(c){
  const h=c.handover_data||{},signature=h.signature_confirmation,handover=h.handover_confirmation,returned=h.return_confirmation;
  const ready=['ready_to_sign','signed'].includes(c.status);
  return `<div class="contract-facts">${signature?fact('Подпись подтверждена менеджером',signature):c.signed_copy_path?'<section class="contract-fact"><b>Подписанный экземпляр прикреплён</b></section>':''}${handover?fact('Выдача автомобиля подтверждена',handover):''}${returned?fact('Возврат автомобиля подтверждён',returned):''}<p class="muted">Статус аренды: ${E(({confirmed:'Подтверждена',active:'В аренде',completed:'Завершена'})[c.rental_status]||'—')}</p></div>${ready?`<div class="contract-fact-actions">${c.status==='ready_to_sign'?`<button class="btn soft" onclick="pcsContractConfirmations.form('${c.id}','signature')">Подписан ранее</button>`:''}${!handover?`<button class="btn soft" onclick="pcsContractConfirmations.form('${c.id}','handover')">Машина уже выдана</button>`:''}${handover&&!returned?`<button class="btn soft" onclick="pcsContractConfirmations.form('${c.id}','return')">Машина возвращена</button>`:''}${handover&&(returned||c.rental_status!=='completed')&&(c.rental_status!==(returned?'completed':'active')||c.rental_status_recorded!==(returned?'completed':'active'))?`<button class="btn" onclick="pcsContractConfirmations.sync('${c.id}','${returned?'completed':'active'}')">${returned?'Завершить аренду':'Перевести в аренду'}</button>`:''}</div>`:''}`;
 }
 async function form(id,kind){
  if(!['signature','handover','return'].includes(kind))return;
  try{
   const c=await window.contractCall(`/contracts/${id}`),signature=kind==='signature',returned=kind==='return';
   if(!['ready_to_sign','signed'].includes(c.status)||(signature&&c.status!=='ready_to_sign'))throw Error('contract_not_ready_to_sign');
   if(returned&&!c.handover_data?.handover_confirmation)throw Error('handover_required');
   window.openSheet(returned?'Подтвердить возврат машины':signature?'Подтвердить прежнюю подпись':'Подтвердить выдачу машины',`<form id="ctFactForm" data-contract="${E(id)}" data-kind="${kind}" onsubmit="event.preventDefault();pcsContractConfirmations.submit()"><p class="muted">${returned?'Отметьте фактический возврат автомобиля и ключей. Укажите состояние машины, топливо и замечания. После сохранения бронь перейдёт в «Завершено».':signature?'Отметьте, что клиент уже подписал договор с этими условиями. Эта запись фиксирует ваше подтверждение; скан можно прикрепить позже.':'Отметьте фактическую передачу автомобиля клиенту. Подпись договора подтверждается отдельно.'}</p><div class="field"><label for="ctFactAt">${returned?'Когда возвращён автомобиль':signature?'Когда подписан договор':'Когда выдан автомобиль'} *</label><input id="ctFactAt" type="datetime-local" required></div><div class="field"><label for="ctFactOperator">Имя менеджера *</label><input id="ctFactOperator" required minlength="2" maxlength="120" autocomplete="name"></div><div class="field"><label for="ctFactNote">Основание подтверждения *</label><textarea id="ctFactNote" required minlength="5" maxlength="1000" rows="3" placeholder="${returned?'Например: приняла автомобиль и ключи, топливо полное, новых повреждений нет':signature?'Например: лично присутствовала при подписании бумажного договора':'Например: лично передала ключи клиенту'}"></textarea></div><label class="contract-fact-check"><input id="ctFactConfirmed" type="checkbox" required><span>${returned?'Подтверждаю, что автомобиль и ключи фактически возвращены.':signature?'Подтверждаю, что клиент подписал договор с условиями этой версии.':'Подтверждаю, что этот автомобиль уже передан клиенту.'}</span></label><p id="ctFactError" role="alert" class="contract-fact-error"></p><div class="contract-fact-actions"><button id="ctFactSave" class="btn" type="submit">Сохранить подтверждение</button><button class="btn ghost" type="button" onclick="contractCenter('${E(c.reservation_id)}')">Назад</button></div></form>`);
  }catch(e){window.toast(messages[e.message]||e.message)}
 }
 async function submit(){
  const node=document.getElementById('ctFactForm');if(!node||submitting)return;
  const error=document.getElementById('ctFactError'),button=document.getElementById('ctFactSave');
  try{
   const occurred=new Date(document.getElementById('ctFactAt').value),confirmed=document.getElementById('ctFactConfirmed').checked;
   if(!confirmed)throw Error('confirmation_required');
   if(!Number.isFinite(occurred.getTime())||occurred.getTime()>Date.now()||occurred.getTime()<Date.UTC(2000,0,1))throw Error('invalid_confirmation_date');
   const operator_name=document.getElementById('ctFactOperator').value.trim(),note=document.getElementById('ctFactNote').value.trim();
   if(operator_name.length<2||operator_name.length>120)throw Error('operator_name_required');
   if(note.length<5||note.length>1000)throw Error('confirmation_note_required');
   submitting=true;button.disabled=true;button.textContent='Сохраняю…';error.textContent='';
   const result=await window.contractCall(`/contracts/${node.dataset.contract}/confirm-fact`,{method:'POST',body:JSON.stringify({kind:node.dataset.kind,occurred_at:occurred.toISOString(),operator_name,note,confirmed})});
   window.toast(node.dataset.kind==='signature'?'Прежняя подпись подтверждена':node.dataset.kind==='return'?'Возврат автомобиля подтверждён':'Выдача автомобиля подтверждена');
   if(node.dataset.kind!=='signature')await sync(node.dataset.contract,node.dataset.kind==='return'?'completed':'active',false);
   if(document.getElementById('ctFactForm')===node)await window.contractCenter(result.reservation_id);
  }catch(e){if(document.getElementById('ctFactForm')===node)error.textContent=messages[e.message]||'Не удалось сохранить подтверждение. Попробуйте ещё раз.'}
  finally{submitting=false;if(document.getElementById('ctFactForm')===node){button.disabled=false;button.textContent='Сохранить подтверждение'}}
 }
 async function sync(id,status,refresh=true){
  if(refresh&&submitting)return;
  if(refresh)submitting=true;
  try{
   const result=await window.contractCall(`/contracts/${id}/rental-status`,{method:'POST',body:JSON.stringify({status,confirmed:true})});
   window.toast(status==='completed'?'Аренда завершена':'Бронь переведена в аренду');
   if(refresh)await window.contractCenter(result.reservation_id);
  }catch(e){window.toast('Отметка сохранена. Статус аренды не обновлён: '+(messages[e.message]||'повторите смену статуса в договоре.'))}
  finally{if(refresh)submitting=false}
 }
 window.pcsContractConfirmations={render,form,submit,sync};
})();
