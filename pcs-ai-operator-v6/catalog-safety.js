(()=>{
const oldPricing=window.pricingManager;
window.pricingManager=async function(id){
  await oldPricing(id);
  const x=PCS.catalog.find(v=>v.id===id);if(!x)return;
  const priceInput=document.querySelector('#basePrice');
  if(priceInput){priceInput.type='text';priceInput.inputMode='decimal';priceInput.maxLength=30;}
  const base=priceInput?.closest('.field');
  base?.insertAdjacentHTML('beforeend',`<input type="hidden" id="catalogPriceVersion" value="${esc(x.edit_version||'')}">`);
  const isRent=/_rent$/.test(x.category||'');
  if(base&&!document.querySelector('#basePricePeriod')){
    const opts=isRent?`<option value="day" ${x.base_price_period==='day'?'selected':''}>День</option><option value="week" ${x.base_price_period==='week'?'selected':''}>Неделя</option><option value="month" ${x.base_price_period==='month'?'selected':''}>Месяц</option>`:`<option value="one_time" selected>Единоразовая цена</option>`;
    const note='Период цены сохранён в карточке. Изменение периода пока не подключено.';
    base.insertAdjacentHTML('afterend',`<div class="field"><label>Базовая цена указана за</label><select id="basePricePeriod" disabled>${opts}</select><div class="muted">${note}</div></div>`);
  }
  if(isRent&&!document.querySelector('#depositThb')){
    const priceLabel=base?.querySelector('label');if(priceLabel)priceLabel.textContent='Цена за выбранный период, THB';
    document.querySelector('#basePricePeriod')?.closest('.field')?.insertAdjacentHTML('afterend',`<div class="field"><label>Депозит за сохранность авто, THB</label><input id="depositThb" type="text" inputmode="decimal" maxlength="30" value="${esc(x.deposit??x.deposit_thb??'')}"><div class="muted">Депозит отображается отдельно. Пустое поле означает, что сумма не указана.</div></div>`);
  }
  const period=document.querySelector('#basePricePeriod');if(period){period.value=x.base_price_period??x.price_period??x.rate_period??(isRent?'day':'one_time');period.disabled=true;}
  const lock=document.querySelector('#pricingLocked');if(lock){lock.disabled=true;lock.checked=Boolean(x.pricing_locked);lock.closest('label')?.insertAdjacentHTML('afterend','<p class="muted">Изменение сезонной блокировки пока не подключено.</p>');}
  const button=document.querySelector('button[onclick^="saveBasePrice("]');
  if(button){button.id='catalogPriceSave';button.insertAdjacentHTML('beforebegin','<p id="catalogPriceError" role="alert" aria-live="polite" style="overflow-wrap:anywhere"></p>');}
};
const priceSaves=new WeakMap();
window.saveBasePrice=async function(id){
 const input=document.querySelector('#basePrice'),button=document.querySelector('#catalogPriceSave'),error=document.querySelector('#catalogPriceError');
 if(!input||!button||priceSaves.has(input))return;
 priceSaves.set(input,'pending');button.disabled=true;if(error)error.textContent='';
 const fields=[input,document.querySelector('#depositThb')].filter(Boolean);fields.forEach(x=>x.disabled=true);
 try{
  const deposit=document.querySelector('#depositThb');
  const result=await adminCall({action:'pricing',id,expected_version:document.querySelector('#catalogPriceVersion')?.value||'',base_price:input.value, ...(deposit?{deposit_thb:deposit.value}:{})});
  if(result?.ok!==true)throw Error('Сервер не подтвердил сохранение. Обновите карточку для проверки.');
  priceSaves.set(input,'saved');
  if(document.querySelector('#basePrice')===input)closeSheet();
  toast('Цена и депозит сохранены');
  try{PCS.catalog=await call('/catalog');await catalog()}catch{toast('Сохранение подтверждено. Обновите список каталога.');}
 }catch(e){priceSaves.delete(input);if(document.querySelector('#basePrice')===input&&error)error.textContent=e.message||'Не удалось сохранить цену';}
 finally{button.disabled=false;fields.forEach(x=>x.disabled=false);}
};
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
