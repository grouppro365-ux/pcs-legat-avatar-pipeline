(()=>{
const oldPricing=window.pricingManager;
window.pricingManager=async function(id){
  await oldPricing(id);
  const x=PCS.catalog.find(v=>v.id===id);if(!x)return;
  const base=document.querySelector('#basePrice')?.closest('.field');
  base?.insertAdjacentHTML('beforeend',`<input type="hidden" id="catalogPriceVersion" value="${esc(x.edit_version||'')}">`);
  const isRent=/_rent$/.test(x.category||'');
  if(base&&!document.querySelector('#basePricePeriod')){
    const opts=isRent?`<option value="day" ${x.base_price_period==='day'?'selected':''}>День</option><option value="week" ${x.base_price_period==='week'?'selected':''}>Неделя</option><option value="month" ${x.base_price_period==='month'?'selected':''}>Месяц</option>`:`<option value="one_time" selected>Единоразовая цена</option>`;
    const note=isRent?'Система рассчитывает аренду из выбранной базовой единицы. Сезонный коэффициент и коэффициент длительности применяются прозрачно поверх базовой суммы.':'Для продажи цена единоразовая; сезонные арендные коэффициенты не применяются.';
    base.insertAdjacentHTML('afterend',`<div class="field"><label>Базовая цена указана за</label><select id="basePricePeriod">${opts}</select><div class="muted">${note}</div></div>`);
  }
  if(isRent&&!document.querySelector('#depositThb')){
    const priceLabel=base?.querySelector('label');if(priceLabel)priceLabel.textContent='Цена в сутки, THB';
    document.querySelector('#basePricePeriod')?.closest('.field')?.insertAdjacentHTML('afterend',`<div class="field"><label>Депозит за сохранность авто, THB</label><input id="depositThb" type="number" min="0" step="1" value="${esc(x.deposit??x.deposit_thb??'')}"><div class="muted">Депозит не является ценой аренды и отображается отдельно.</div></div>`);
  }
};
window.saveBasePrice=async function(id){try{const period=document.querySelector('#basePricePeriod')?.value||'one_time';const depositInput=document.querySelector('#depositThb');await adminCall({action:'pricing',id,expected_version:document.querySelector('#catalogPriceVersion')?.value||'',base_price:Number(document.querySelector('#basePrice').value),deposit_thb:depositInput?Number(depositInput.value):undefined,base_price_period:period,pricing_locked:document.querySelector('#pricingLocked').checked});PCS.catalog=await call('/catalog');toast('Цена и депозит сохранены');closeSheet();catalog()}catch(e){toast(e.message)}};
let archiveState=null;
window.confirmDeleteCatalog=function(id){
 if(archiveState?.busy)return;
 const x=PCS.catalog.find(v=>v.id===id);if(!x)return;
 archiveState={id,expected_version:x.edit_version||'',busy:false};
 openSheet('Убрать объект из каталога?',`<div class="danger-box"><h3>${esc(x.title)}</h3><p>Позиция будет архивирована. История бронирований, договоров и финансов сохранится.</p></div><p id="catalogArchiveError" role="alert" aria-live="polite" style="overflow-wrap:anywhere"></p><div class="toolbar"><button class="btn ghost" onclick="closeSheet()">Отмена</button><button id="catalogArchiveSave" class="btn danger" onclick="deleteCatalog('${id}')">Архивировать</button></div>`);
};
window.deleteCatalog=async function(id){
 const state=archiveState,button=document.querySelector('#catalogArchiveSave'),error=document.querySelector('#catalogArchiveError');
 if(!state||state.id!==id||state.busy||!button)return;
 state.busy=true;button.disabled=true;if(error)error.textContent='';
 try{
  await adminCall({action:'delete',id,expected_version:state.expected_version});
  const x=PCS.catalog.find(v=>v.id===id);if(x){x.publication_status='ARCHIVED';x.availability_status='UNAVAILABLE';}
  if(document.querySelector('#catalogArchiveSave')===button)closeSheet();
  archiveState=null;toast('Объект архивирован');
  try{await catalog()}catch{toast('Архивирование подтверждено. Обновите список каталога.');}
 }catch(e){if(document.querySelector('#catalogArchiveSave')===button&&error)error.textContent=e.message||'Не удалось подтвердить архивирование. Обновите карточку для проверки.';}
 finally{state.busy=false;button.disabled=false;}
};
})();
