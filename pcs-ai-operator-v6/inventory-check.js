(()=>{
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let state=null;
 const active=s=>state===s&&document.getElementById('pcsInventoryResult')===s.root;
 async function check(s){
  if(!active(s)||s.busy)return;
  const start=document.getElementById('pcsInventoryStart').value,end=document.getElementById('pcsInventoryEnd').value;
  if(!start||!end||end<=start){s.root.textContent='Укажите даты: окончание должно быть позже начала.';return;}
  const seq=++s.sequence;s.busy=true;s.button.disabled=true;s.root.textContent='Проверяю периоды и активные брони…';
  try{
   const d=await window.call('/inventory-check?'+new URLSearchParams({id:s.id,start,end}));
   if(!active(s)||seq!==s.sequence)return;
   const titles={available:'Период отмечен свободным',conflict:'Есть занятый период',unavailable:'Карточка недоступна',confirmation_required:'Нужно подтвердить наличие'};
   if(d.item?.id!==s.id||d.start!==start||d.end!==end||!titles[d.status])throw Error('Некорректный результат проверки');
   s.root.innerHTML=`<article class="item"><b>${esc(titles[d.status])}</b><p>${esc(d.item.title)}</p><p>${esc(d.reason)}</p><p class="muted">${esc(start)} → ${esc(end)} · Таиланд (UTC+7)</p><p class="muted">Проверено: ${esc(new Date(d.checked_at).toLocaleString('ru-RU'))}</p></article>`;
  }catch(e){if(active(s)&&seq===s.sequence)s.root.textContent=e.message||'Не удалось проверить наличие. Повторите проверку.';}
  finally{if(active(s)&&seq===s.sequence){s.busy=false;s.button.disabled=false;}}
 }
 window.pcsInventory={open(id){
  if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))return;
  window.openSheet('Наличие на даты',`<div class="v37-catalog-editor"><p class="muted">Проверка по сохранённым периодам и активным броням. Даты указаны по времени Таиланда; окончание не входит в период.</p><div class="field"><label for="pcsInventoryStart">Начало периода</label><input id="pcsInventoryStart" type="date"></div><div class="field"><label for="pcsInventoryEnd">Окончание периода</label><input id="pcsInventoryEnd" type="date"></div><button id="pcsInventoryCheck" class="btn" type="button">Проверить наличие</button><div id="pcsInventoryResult" aria-live="polite"></div></div>`);
  const s=state={id,root:document.getElementById('pcsInventoryResult'),button:document.getElementById('pcsInventoryCheck'),sequence:0,busy:false};
  s.button.onclick=()=>check(s);
  for(const key of ['pcsInventoryStart','pcsInventoryEnd'])document.getElementById(key).onchange=()=>{s.sequence++;s.busy=false;s.button.disabled=false;s.root.textContent='Даты изменились. Проверьте наличие заново.';};
 }};
})();
