(()=>{
 'use strict';
 const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const validId=id=>/^[A-Za-z0-9_-]{1,128}$/.test(String(id));
 let submitting=false;
 function draft(contact){
  const language=String(contact.detected_language||contact.language||'ru').toLowerCase().slice(0,2);
  const text={ru:'Здравствуйте! Ваш запрос ещё актуален? Если изменились даты или пожелания, напишите — помогу с подбором.',en:'Hello! Are you still looking for help with your request? If your dates or preferences have changed, let me know.',th:'สวัสดีค่ะ ยังต้องการความช่วยเหลือเกี่ยวกับคำขอของคุณอยู่ไหมคะ หากวันที่หรือความต้องการเปลี่ยนไป แจ้งได้เลยค่ะ'};
  return {text:text[language]||text.en,fallback:!Object.hasOwn(text,language)};
 }
 async function open(id){
  if(!validId(id))return;
  try{
   const detail=await window.call(`/crm/${id}`),contact=detail.contact||detail,message=draft(contact);
   window.openSheet('Уточнить запрос клиента',`<form id="crmFollowupForm" data-contact="${id}" data-request-id="${crypto.randomUUID()}" onsubmit="event.preventDefault();pcsCrmFollowup.submit()"><p class="muted">Клиент: ${E(contact.name||contact.username||'—')}. Проверьте сообщение перед отправкой.${message.fallback?' Черновик на английском; отредактируйте его под язык клиента.':''}</p>${contact.need?`<p class="muted">Запрос: ${E(contact.need)}</p>`:''}<div class="field"><label for="crmFollowupText">Сообщение</label><textarea id="crmFollowupText" rows="5" required maxlength="4000">${E(message.text)}</textarea></div><p id="crmFollowupError" role="alert" class="contract-fact-error"></p><button id="crmFollowupSend" class="btn" type="submit">Отправить клиенту</button></form>`);
  }catch{window.toast('Не удалось открыть запрос клиента. Повторите попытку.')}
 }
 async function submit(){
  const form=document.getElementById('crmFollowupForm');if(!form||submitting)return;
  const field=document.getElementById('crmFollowupText'),error=document.getElementById('crmFollowupError'),button=document.getElementById('crmFollowupSend');
  const text=form.pcsAttemptedText??field.value.trim(),id=form.dataset.contact;
  if(!validId(id)||!text||text.length>4000){error.textContent='Введите сообщение до 4000 символов.';return}
  if(!form.dataset.requestId)form.dataset.requestId=crypto.randomUUID();
  form.pcsAttemptedText=text;field.readOnly=true;submitting=true;button.disabled=true;button.textContent='Отправляю…';error.textContent='';
  try{
   const result=await window.call(`/crm/${id}/send`,{method:'POST',body:JSON.stringify({text,request_id:form.dataset.requestId})});
   window.toast(result?.operator_confirmed?'Доставка подтверждена оператором':'Сообщение отправлено');
   if(document.getElementById('crmFollowupForm')===form){window.closeSheet();try{await window.openClient(id,false)}catch{window.toast('Сообщение отправлено. Обновите карточку клиента.')}}
  }catch(e){if(document.getElementById('crmFollowupForm')===form){const knownUnsent=['send_rejected','send_route_unavailable','invalid_send'].includes(e.code)||e.status===401||e.status===400||e.status===413;if(knownUnsent){field.readOnly=false;delete form.pcsAttemptedText;if(e.code==='send_rejected')form.dataset.requestId=crypto.randomUUID()}form.pcsUncertain=!knownUnsent;form.pcsPending=e.code==='delivery_uncertain';error.textContent=knownUnsent?(e.message||'Не удалось отправить сообщение.'):(e.code?e.message:'Доставка не подтверждена. Повторите попытку: система проверит предыдущую отправку.')}}
  finally{submitting=false;if(document.getElementById('crmFollowupForm')===form){button.disabled=false;button.textContent=form.pcsPending?'Проверить отправку':form.pcsUncertain?'Повторить попытку':'Отправить клиенту'}}
 }
 window.pcsCrmFollowup={open,submit,draft};
 window.followupClient=open;
})();
