(()=>{
 'use strict';
 const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const validId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(String(id));
 // Both CRM entrypoints share unresolved send attempts. Keep the id before
 // transport so closing a form or reloading cannot turn a retry into a send.
 const attempts=window.pcsCrmSendAttempts||(window.pcsCrmSendAttempts=(()=>{
  let epoch=0;const memory=new Map(),busy=new Set(),key=id=>'pcs:crm-send:telegram:'+id;
  function get(id){if(memory.has(id))return memory.get(id);try{const a=JSON.parse(window.sessionStorage?.getItem(key(id))||'null');if(a&&a.contact===id&&a.channel==='telegram'&&typeof a.text==='string'&&a.text.trim()&&a.text.length<=4000&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(a.request_id)){memory.set(id,a);return a}}catch{}return null}
  function set(id,a){if(a)memory.set(id,a);else memory.delete(id);try{if(a)window.sessionStorage?.setItem(key(id),JSON.stringify(a));else window.sessionStorage?.removeItem(key(id))}catch{}}
  function clear(){epoch++;for(const id of memory.keys())try{window.sessionStorage?.removeItem(key(id))}catch{}memory.clear();busy.clear();try{const storage=window.sessionStorage;for(let i=(storage?.length||0)-1;i>=0;i--){const k=storage.key(i);if(k?.startsWith('pcs:crm-send:telegram:'))storage.removeItem(k)}}catch{}}
  return{get,set,busy,clear,get epoch(){return epoch}};
 })());

 let openSequence=0;
 function draft(contact){
  const language=String(contact.detected_language||contact.language||'ru').toLowerCase().slice(0,2);
  const text={ru:'Здравствуйте! Ваш запрос ещё актуален? Если изменились даты или пожелания, напишите — помогу с подбором.',en:'Hello! Are you still looking for help with your request? If your dates or preferences have changed, let me know.',th:'สวัสดีค่ะ ยังต้องการความช่วยเหลือเกี่ยวกับคำขอของคุณอยู่ไหมคะ หากวันที่หรือความต้องการเปลี่ยนไป แจ้งได้เลยค่ะ'};
  return {text:text[language]||text.en,fallback:!Object.hasOwn(text,language)};
 }
 async function open(id){
  if(!validId(id))return;
  const request=++openSequence,intent=window.pcsSheetLifecycle?.begin(),page=window.PCS?.page,main=document.getElementById('main'),epoch=attempts.epoch;
  const current=()=>request===openSequence&&epoch===attempts.epoch&&page===window.PCS?.page&&main===document.getElementById('main')&&(!intent||window.pcsSheetLifecycle.current(intent));
  try{
   const detail=await window.call(`/crm/${id}`),contact=detail.contact||detail,message=draft(contact);
   if(!current())return;
   let attempt=attempts.get(id);if(attempt?.confirmed){attempts.set(id,null);attempt=null}
   window.openSheet('Уточнить запрос клиента',`<form id="crmFollowupForm" data-contact="${id}" data-request-id="${crypto.randomUUID()}" onsubmit="event.preventDefault();pcsCrmFollowup.submit(this)"><p class="muted">Клиент: ${E(contact.name||contact.username||'—')}. Проверьте сообщение перед отправкой.${message.fallback?' Черновик на английском; отредактируйте его под язык клиента.':''}</p>${contact.need?`<p class="muted">Запрос: ${E(contact.need)}</p>`:''}<div class="field"><label for="crmFollowupText">Сообщение</label><textarea id="crmFollowupText" rows="5" required maxlength="4000">${E(message.text)}</textarea></div><p id="crmFollowupError" role="alert" class="contract-fact-error"></p><button id="crmFollowupSend" class="btn" type="submit">Отправить клиенту</button></form>`);
   const openedForm=document.getElementById('crmFollowupForm');if(openedForm){openedForm.pcsSheetScope=window.pcsSheetLifecycle?.capture();openedForm.onsubmit=e=>{e.preventDefault();return submit(openedForm)}}
   if(attempt){const form=document.getElementById('crmFollowupForm'),field=document.getElementById('crmFollowupText');form.dataset.requestId=attempt.request_id;form.pcsAttemptedText=attempt.text;field.value=attempt.text;field.readOnly=true;document.getElementById('crmFollowupError').textContent='Доставка предыдущего сообщения не подтверждена. Повтор проверит ту же отправку.';document.getElementById('crmFollowupSend').textContent='Проверить отправку'}
  }catch{if(current())window.toast('Не удалось открыть запрос клиента. Повторите попытку.')}
 }
 async function submit(expectedForm){
  const form=document.getElementById('crmFollowupForm');if(!form||(expectedForm&&expectedForm!==form)||attempts.busy.has(form.dataset.contact))return;
  if(form.pcsSheetScope&&!window.pcsSheetLifecycle.current(form.pcsSheetScope))return;
  const scope=form.pcsSheetScope||window.pcsSheetLifecycle?.capture(),epoch=attempts.epoch,current=()=>epoch===attempts.epoch&&(!scope||window.pcsSheetLifecycle.current(scope))&&document.getElementById('crmFollowupForm')===form;
  const field=document.getElementById('crmFollowupText'),error=document.getElementById('crmFollowupError'),button=document.getElementById('crmFollowupSend');
  const id=form.dataset.contact,previous=attempts.get(id);if(previous&&!previous.confirmed){form.dataset.requestId=previous.request_id;form.pcsAttemptedText=previous.text;field.value=previous.text}
  const text=form.pcsAttemptedText??field.value.trim();
  if(!validId(id)||!text||text.length>4000){error.textContent='Введите сообщение до 4000 символов.';return}
  if(!form.dataset.requestId)form.dataset.requestId=crypto.randomUUID();
  attempts.set(id,{contact:id,channel:'telegram',text,request_id:form.dataset.requestId});attempts.busy.add(id);form.pcsAttemptedText=text;field.readOnly=true;button.disabled=true;button.textContent='Отправляю…';error.textContent='';
  try{
   const result=await window.call(`/crm/${id}/send`,{method:'POST',body:JSON.stringify({text,request_id:form.dataset.requestId})});
   if(epoch!==attempts.epoch)return;
   attempts.set(id,{contact:id,channel:'telegram',text,request_id:form.dataset.requestId,confirmed:true});
   window.toast(result?.operator_confirmed?'Доставка подтверждена оператором':'Сообщение отправлено');
   if(current()){window.closeSheet();try{await window.openClient(id,false)}catch{window.toast('Сообщение отправлено. Обновите карточку клиента.')}}
  }catch(e){const knownUnsent=['send_rejected','send_route_unavailable','invalid_send'].includes(e.code);if(epoch!==attempts.epoch)return;if(knownUnsent)attempts.set(id,null);if(current()){if(knownUnsent){field.readOnly=false;delete form.pcsAttemptedText;if(e.code==='send_rejected')form.dataset.requestId=crypto.randomUUID()}form.pcsUncertain=!knownUnsent;form.pcsPending=e.code==='delivery_uncertain';error.textContent=knownUnsent?(e.message||'Не удалось отправить сообщение.'):(e.code?e.message:'Доставка не подтверждена. Повторите попытку: система проверит предыдущую отправку.')}}
  finally{if(epoch===attempts.epoch)attempts.busy.delete(id);if(current()){button.disabled=false;button.textContent=form.pcsPending?'Проверить отправку':form.pcsUncertain?'Повторить попытку':'Отправить клиенту'}}
 }
 window.pcsCrmFollowup={open,submit,draft};
 window.followupClient=open;
})();
