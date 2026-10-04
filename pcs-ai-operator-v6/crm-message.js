(()=>{
 'use strict';
 const valid=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id);
 let sending=false;
 function open(id){
  if(!valid(id))return;
  window.openSheet('Написать клиенту',`<form id="crmMessageForm" data-contact="${id}" data-request-id="${crypto.randomUUID()}" onsubmit="event.preventDefault();pcsCrmMessage.submit()"><div class="field"><label for="crmMessageText">Сообщение</label><textarea id="crmMessageText" required maxlength="4000" rows="5"></textarea></div><p id="crmMessageError" class="contract-fact-error" role="alert"></p><button id="crmMessageSend" class="btn" type="submit">Отправить клиенту</button></form>`);
 }
 async function submit(){
  const form=document.getElementById('crmMessageForm');if(!form||sending)return;
  const field=document.getElementById('crmMessageText'),error=document.getElementById('crmMessageError'),button=document.getElementById('crmMessageSend'),id=form.dataset.contact;
  const text=form.pcsAttemptedText??field.value.trim();
  if(!valid(id)||!text||text.length>4000){error.textContent='Введите сообщение до 4000 символов.';return}
  if(!form.dataset.requestId)form.dataset.requestId=crypto.randomUUID();
  sending=true;button.disabled=true;field.readOnly=true;form.pcsAttemptedText=text;error.textContent='';button.textContent='Отправляю…';
  try{
   const result=await window.call('/crm/'+id+'/send',{method:'POST',body:JSON.stringify({text,request_id:form.dataset.requestId})});
   window.toast(result?.operator_confirmed?'Доставка подтверждена оператором':'Сообщение отправлено');
   if(document.getElementById('crmMessageForm')===form){window.closeSheet();try{await window.openClient(id,false)}catch{window.toast('Сообщение отправлено. Обновите карточку клиента.')}}
  }catch(e){
   if(document.getElementById('crmMessageForm')!==form)return;
   const knownUnsent=['send_rejected','send_route_unavailable','invalid_send'].includes(e.code)||e.status===401||e.status===400||e.status===413;
   if(knownUnsent){field.readOnly=false;delete form.pcsAttemptedText;if(e.code==='send_rejected')form.dataset.requestId=crypto.randomUUID();error.textContent=e.message||'Не удалось отправить сообщение.'}
   else error.textContent=e.code?e.message:'Доставка не подтверждена. Повторите попытку: система проверит предыдущую отправку.';
   form.pcsUncertain=!knownUnsent;form.pcsPending=e.code==='delivery_uncertain';
  }finally{sending=false;if(document.getElementById('crmMessageForm')===form){button.disabled=false;button.textContent=form.pcsPending?'Проверить отправку':form.pcsUncertain?'Повторить попытку':'Отправить клиенту'}}
 }
 window.pcsCrmMessage={open,submit};window.messageClient=open;window.sendClientMessage=submit;
})();
