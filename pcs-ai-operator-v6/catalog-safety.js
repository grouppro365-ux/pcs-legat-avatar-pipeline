(()=>{
const oldPricing=window.pricingManager;
window.pricingManager=async function(id){
  await oldPricing(id);
  const x=PCS.catalog.find(v=>v.id===id);if(!x)return;
  const base=document.querySelector('#basePrice')?.closest('.field');
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
window.saveBasePrice=async function(id){try{const period=document.querySelector('#basePricePeriod')?.value||'one_time';const depositInput=document.querySelector('#depositThb');await adminCall({action:'pricing',id,base_price:Number(document.querySelector('#basePrice').value),deposit_thb:depositInput?Number(depositInput.value):undefined,base_price_period:period,pricing_locked:document.querySelector('#pricingLocked').checked});PCS.catalog=await call('/catalog');toast('Цена и депозит сохранены');closeSheet();catalog()}catch(e){toast(e.message)}};
window.confirmDeleteCatalog=function(id){const x=PCS.catalog.find(v=>v.id===id);if(!x)return;openSheet('Убрать объект из каталога?',`<div class="danger-box"><h3>${esc(x.title)}</h3><p>Позиция будет архивирована и сразу перестанет показываться клиентам и ИИ. История бронирований, договоров и финансов сохранится.</p></div><div class="toolbar"><button class="btn ghost" onclick="closeSheet()">Отмена</button><button class="btn danger" onclick="deleteCatalog('${id}')">Архивировать</button></div>`)};
window.deleteCatalog=async function(id){try{await adminCall({action:'delete',id});closeSheet();toast('Объект архивирован');await catalog()}catch(e){toast(e.message)}};
})();
