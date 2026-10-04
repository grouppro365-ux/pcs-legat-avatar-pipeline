(()=>{
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const valid=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id);
const uuid=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
let rows=[],state=null;
function open(index){
 const x=rows[index];if(state?.busy||!x||x.operation!=='crm_manual'||!valid(x.contact_id)||!uuid(x.id)||typeof x.edit_version!=='string')return;
 window.openSheet('Подтвердить доставку',`<form id="pcsDeliveryReviewForm"><p>Клиент: <strong>${esc(x.contact_name||'Клиент')}</strong></p><p>После проверки фактического диалога Telegram подтвердите, что именно это сообщение доставлено. Подтверждение будет записано от имени оператора.</p><p class="muted">Попытка: ${esc(x.id)} · создана ${esc(window.fmtDateTime?.(x.created_at)||x.created_at||'—')}</p><label><input id="pcsDeliveryReviewed" type="checkbox" required> Я проверил диалог Telegram: это сообщение есть у клиента.</label><div class="field"><label>Результат проверки<textarea id="pcsDeliveryNote" required minlength="10" maxlength="1000" rows="4" placeholder="Какое сообщение и в каком диалоге вы проверили"></textarea></label></div><p id="pcsDeliveryReviewError" role="alert"></p><button id="pcsDeliveryReviewSave" class="btn" type="submit">Зафиксировать доставку</button></form>`);
 const form=document.getElementById('pcsDeliveryReviewForm');state={form,row:{...x},busy:false};form.addEventListener('submit',e=>{e.preventDefault();submit()});
}
async function submit(){
 const s=state;if(!s||s.busy||document.getElementById('pcsDeliveryReviewForm')!==s.form)return;
 const checked=document.getElementById('pcsDeliveryReviewed'),field=document.getElementById('pcsDeliveryNote'),error=document.getElementById('pcsDeliveryReviewError'),button=document.getElementById('pcsDeliveryReviewSave'),note=field.value.trim();
 if(!checked.checked||note.length<10||note.length>1000){error.textContent='Подтвердите проверку диалога и добавьте комментарий от 10 до 1000 символов';return}
 s.busy=true;checked.disabled=true;field.disabled=true;button.disabled=true;button.textContent='Сохраняю…';error.textContent='';
 try{
  const r=await window.fetch('https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-errors-api/delivery/'+s.row.contact_id+'/confirm',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+(localStorage.pcsToken||'')},body:JSON.stringify({message_id:s.row.id,expected_version:s.row.edit_version,note,confirmed:true})});const data=await r.json();if(!r.ok)throw Error(data.error||'Не удалось подтвердить доставку');if(!data.ok||!data.operator_confirmed||data.review?.id!==s.row.id||data.review?.contact_id!==s.row.contact_id)throw Error('Сервер не подтвердил запись результата');
  window.toast('Доставка подтверждена оператором');if(state===s&&document.getElementById('pcsDeliveryReviewForm')===s.form&&window.PCS?.page==='errors'){window.closeSheet();try{await window.errorsPage('delivery',0)}catch{window.toast('Результат сохранён. Обновите список отправок.')}}
 }catch(e){if(state===s&&document.getElementById('pcsDeliveryReviewForm')===s.form)error.textContent=e.message||'Сохранение не подтверждено. Обновите список перед повтором.'}
 finally{s.busy=false;if(state===s&&document.getElementById('pcsDeliveryReviewForm')===s.form){checked.disabled=false;field.disabled=false;button.disabled=false;button.textContent='Зафиксировать доставку'}}
}
window.pcsDeliveryReview={open,submit,setRows:value=>{rows=Array.isArray(value)?value:[]}};
})();
