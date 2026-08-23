(()=>{
const oldPricing=window.pricingManager;
window.pricingManager=async function(id){
  await oldPricing(id);
  const x=PCS.catalog.find(v=>v.id===id);if(!x)return;
  const base=document.querySelector('#basePrice')?.closest('.field');
  if(base&&!document.querySelector('#basePricePeriod')){
    const isRent=/_rent$/.test(x.category||'');
    const opts=isRent?`<option value="day" ${x.base_price_period==='day'?'selected':''}>День</option><option value="week" ${x.base_price_period==='week'?'selected':''}>Неделю</option><option value="month" ${x.base_price_period==='month'?'selected':''}>Месяц</option>`:`<option value="one_time" selected>Единоразовая цена</option>`;
    const note=isRent?'Сезонный автоматический расчёт по дням применяется только к тарифу «за день». Для недельного/месячного тарифа система не угадывает итог.':'Для продажи цена единоразовая; сезонный арендный коэффициент к ней не применяется.';
    base.insertAdjacentHTML('afterend',`<div class="field"><label>Базовая цена указана за</label><select id="basePricePeriod">${opts}</select><div class="muted">${note}</div></div>`);
  }
};
window.saveBasePrice=async function(id){try{const period=document.querySelector('#basePricePeriod')?.value||'one_time';await adminCall({action:'pricing',id,base_price:Number(document.querySelector('#basePrice').value),base_price_period:period,pricing_locked:document.querySelector('#pricingLocked').checked});PCS.catalog=await call('/catalog');toast('Цена и период сохранены');closeSheet();catalog()}catch(e){toast(e.message)}};
window.confirmDeleteCatalog=function(id){const x=PCS.catalog.find(v=>v.id===id);if(!x)return;openSheet('Убрать объект из каталога?',`<div class="danger-box"><h3>${esc(x.title)}</h3><p>Позиция будет архивирована и сразу перестанет показываться клиентам и AI. История бронирований, договоров и финансов сохранится.</p></div><div class="toolbar"><button class="btn ghost" onclick="closeSheet()">Отмена</button><button class="btn danger" onclick="deleteCatalog('${id}')">Архивировать</button></div>`)};
window.deleteCatalog=async function(id){try{await adminCall({action:'delete',id});closeSheet();toast('Объект архивирован');await catalog()}catch(e){toast(e.message)}};
})();