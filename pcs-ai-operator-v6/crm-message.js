(()=>{
 'use strict';
 const valid=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id);
 // Both CRM entrypoints share unresolved send attempts. Keep the id before
 // transport so closing a form or reloading cannot turn a retry into a send.
 const attempts=window.pcsCrmSendAttempts||(window.pcsCrmSendAttempts=(()=>{
  let epoch=0;const memory=new Map(),busy=new Set(),key=id=>'pcs:crm-send:telegram:'+id;
  function get(id){if(memory.has(id))return memory.get(id);try{const a=JSON.parse(window.sessionStorage?.getItem(key(id))||'null');if(a&&a.contact===id&&a.channel==='telegram'&&typeof a.text==='string'&&a.text.trim()&&a.text.length<=4000&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(a.request_id)){memory.set(id,a);return a}}catch{}return null}
  function set(id,a){if(a)memory.set(id,a);else memory.delete(id);try{if(a)window.sessionStorage?.setItem(key(id),JSON.stringify(a));else window.sessionStorage?.removeItem(key(id))}catch{}}
  function clear(){epoch++;for(const id of memory.keys())try{window.sessionStorage?.removeItem(key(id))}catch{}memory.clear();busy.clear();try{const storage=window.sessionStorage;for(let i=(storage?.length||0)-1;i>=0;i--){const k=storage.key(i);if(k?.startsWith('pcs:crm-send:telegram:'))storage.removeItem(k)}}catch{}}
  return{get,set,busy,clear,get epoch(){return epoch}};
 })());

 function open(id){
  if(!valid(id))return;
  let attempt=attempts.get(id);if(attempt?.confirmed){attempts.set(id,null);attempt=null}
  window.openSheet('Написать клиенту',`<form id="crmMessageForm" data-contact="${id}" data-request-id="${crypto.randomUUID()}" onsubmit="event.preventDefault();pcsCrmMessage.submit(this)"><div class="field"><label for="crmMessageText">Сообщение</label><textarea id="crmMessageText" required maxlength="4000" rows="5"></textarea></div><p id="crmMessageError" class="contract-fact-error" role="alert"></p><button id="crmMessageSend" class="btn" type="submit">Отправить клиенту</button></form>`);
   const openedForm=document.getElementById('crmMessageForm');if(openedForm){openedForm.pcsSheetScope=window.pcsSheetLifecycle?.capture();openedForm.onsubmit=e=>{e.preventDefault();return submit(openedForm)}}
   if(attempt){const form=document.getElementById('crmMessageForm'),field=document.getElementById('crmMessageText');form.dataset.requestId=attempt.request_id;form.pcsAttemptedText=attempt.text;field.value=attempt.text;field.readOnly=true;document.getElementById('crmMessageError').textContent='Доставка предыдущего сообщения не подтверждена. Повтор проверит ту же отправку.';document.getElementById('crmMessageSend').textContent='Проверить отправку'}
 }
 async function submit(expectedForm){
  const form=document.getElementById('crmMessageForm');if(!form||(expectedForm&&expectedForm!==form)||attempts.busy.has(form.dataset.contact))return;
  if(form.pcsSheetScope&&!window.pcsSheetLifecycle.current(form.pcsSheetScope))return;
  const scope=form.pcsSheetScope||window.pcsSheetLifecycle?.capture(),epoch=attempts.epoch,current=()=>epoch===attempts.epoch&&(!scope||window.pcsSheetLifecycle.current(scope))&&document.getElementById('crmMessageForm')===form;
  const field=document.getElementById('crmMessageText'),error=document.getElementById('crmMessageError'),button=document.getElementById('crmMessageSend'),id=form.dataset.contact;
  const previous=attempts.get(id);if(previous&&!previous.confirmed){form.dataset.requestId=previous.request_id;form.pcsAttemptedText=previous.text;field.value=previous.text}
  const text=form.pcsAttemptedText??field.value.trim();
  if(!valid(id)||!text||text.length>4000){error.textContent='Введите сообщение до 4000 символов.';return}
  if(!form.dataset.requestId)form.dataset.requestId=crypto.randomUUID();
  attempts.set(id,{contact:id,channel:'telegram',text,request_id:form.dataset.requestId});attempts.busy.add(id);button.disabled=true;field.readOnly=true;form.pcsAttemptedText=text;error.textContent='';button.textContent='Отправляю…';
  try{
   const result=await window.call('/crm/'+id+'/send',{method:'POST',body:JSON.stringify({text,request_id:form.dataset.requestId})});
   if(epoch!==attempts.epoch)return;
   attempts.set(id,{contact:id,channel:'telegram',text,request_id:form.dataset.requestId,confirmed:true});
   window.toast(result?.operator_confirmed?'Доставка подтверждена оператором':'Сообщение отправлено');
   if(current()){window.closeSheet();try{await window.openClient(id,false)}catch{window.toast('Сообщение отправлено. Обновите карточку клиента.')}}
  }catch(e){
   const knownUnsent=['send_rejected','send_route_unavailable','invalid_send'].includes(e.code);
   if(epoch!==attempts.epoch)return;if(knownUnsent)attempts.set(id,null);
   if(!current())return;
   if(knownUnsent){field.readOnly=false;delete form.pcsAttemptedText;if(e.code==='send_rejected')form.dataset.requestId=crypto.randomUUID();error.textContent=e.message||'Не удалось отправить сообщение.'}
   else error.textContent=e.code?e.message:'Доставка не подтверждена. Повторите попытку: система проверит предыдущую отправку.';
   form.pcsUncertain=!knownUnsent;form.pcsPending=e.code==='delivery_uncertain';
  }finally{if(epoch===attempts.epoch)attempts.busy.delete(id);if(current()){button.disabled=false;button.textContent=form.pcsPending?'Проверить отправку':form.pcsUncertain?'Повторить попытку':'Отправить клиенту'}}
 }
 window.pcsCrmMessage={open,submit};window.messageClient=open;window.sendClientMessage=submit;
})();
