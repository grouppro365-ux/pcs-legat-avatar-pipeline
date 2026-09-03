(()=>{
'use strict';
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=(v,c='THB')=>{const n=Number(v);return Number.isFinite(n)&&n>0?new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(n)+' '+(String(c||'THB').toUpperCase()==='THB'?'฿':esc(c)):'Цена по запросу'};
const titleOf=x=>String(x?.title||x?.name||x?.metadata?.title||'').trim();
const imageOf=x=>x?.media_items?.[0]?.public_url||x?.image_url||x?.cover_url||x?.metadata?.image_url||'';
const priceOf=x=>x?.final_price??x?.client_price_thb??x?.price??x?.base_price??x?.monthly_price??x?.weekly_price??x?.daily_price;
const periodOf=x=>x?.base_price_period==='day'||x?.daily_price&&priceOf(x)===x.daily_price?' / сутки':x?.base_price_period==='week'||x?.weekly_price&&priceOf(x)===x.weekly_price?' / неделю':x?.base_price_period==='month'||x?.monthly_price&&priceOf(x)===x.monthly_price?' / месяц':'';
const groupLabels={housing:['Недвижимость'],cars:['Автомобили'],services:['Трансферы','Визы и документы','Медицина и страховка','Допуслуги']};
let extrasData=[],extrasFilter='all';
const extraGroups={transfers:['transfer'],visas:['visa'],medicine:['medical','medicine','insurance'],household:['cleaning','repair'],popular:[]};

function activeCatalogKey(){
  const t=document.querySelector('.ref-catalog .pcs-ap-filter button.on')?.textContent.trim();
  return t==='Недвижимость'?'housing':t==='Автомобили'?'cars':t==='Услуги'?'services':'all';
}
function applyCatalogRows(){
  const key=activeCatalogKey(),allowed=groupLabels[key];
  document.querySelectorAll('.ref-catalog .pcs-ap-catrow').forEach(row=>{
    const title=row.querySelector('b')?.textContent.trim()||'';
    row.hidden=Boolean(allowed&&!allowed.includes(title));
  });
}
function catalogItemsForActiveFilter(){
  const key=activeCatalogKey(),map={housing:['housing_rent','housing_sale'],cars:['car_rent','car_sale'],services:['transfer','visa','documents','medical','medicine','insurance','service','cleaning','translation','legal','education','excursion']};
  return (window.PCS?.catalog||[]).filter(x=>!map[key]||map[key].includes(String(x.category||'').toLowerCase()));
}
function refreshPopular(limit=8){
  const box=document.getElementById('pcsApPopular');if(!box)return;
  const list=catalogItemsForActiveFilter().filter(x=>titleOf(x));
  const shown=list.slice(0,limit),sig=shown.map(x=>`${x.id}:${priceOf(x)}:${imageOf(x)}`).join('|');
  if(box.dataset.v32Signature===sig)return;
  box.dataset.v32Signature=sig;
  box.innerHTML=shown.map(productCard).join('')||'<div class="pcs-ap-empty">В этой категории пока нет опубликованных позиций</div>';
  const head=box.previousElementSibling;if(head)head.hidden=!list.length;
}
function productCard(x){
  const img=imageOf(x),title=titleOf(x)||'Позиция каталога';
  return `<button class="pcs-ap-product" type="button" data-product-id="${esc(x.id)}">${img?`<img src="${esc(img)}" alt="${esc(title)}">`:`<span class="pcs-v32-cover-empty">PCS</span>`}<div><b>${esc(title)}</b><small>${esc(x.city||x.location||x.category||'Таиланд')}</small><strong>${money(priceOf(x),x.currency)}${periodOf(x)}</strong></div></button>`;
}
function showAllPopular(){
  const box=document.getElementById('pcsApPopular');
  if(!box)return;
  const list=catalogItemsForActiveFilter().filter(x=>titleOf(x));
  box.innerHTML=list.map(productCard).join('')||'<div class="pcs-ap-empty">В каталоге пока нет объектов с фотографиями</div>';
  box.classList.add('is-expanded');
  box.scrollIntoView({behavior:'smooth',block:'start'});
  const link=document.querySelector('.ref-catalog .pcs-ap-section-head .pcs-ap-link');
  if(link)link.textContent='Показаны все';
}
async function openProduct(id){
  if(!id)return;
  try{
    if(typeof window.pricingManager!=='function')throw new Error('Карточка объекта недоступна');
    await window.pricingManager(id);
    if(!document.body.classList.contains('sheet-open'))throw new Error('Не удалось открыть карточку объекта');
  }catch(e){window.toast?.(e.message||'Не удалось открыть объект')}
}
async function showAllFinance(){
  try{
    const r=await window.opsCall('/finance'),list=Array.isArray(r)?r:r?.items||[];
    const rows=list.map(x=>{const neg=['expense','partner_payout'].includes(x.entry_type),amount=Number(x.amount||0);return `<div class="pcs-v32-finrow"><span><b>${esc(x.counterparty||x.note||x.entry_type||'Операция')}</b><small>${esc(x.created_at?new Date(x.created_at).toLocaleString('ru-RU'):'')}</small></span><strong class="${neg?'neg':''}">${neg?'-':'+'}${money(amount,x.currency)}</strong></div>`}).join('');
    window.openSheet?.('Все операции',`<div class="pcs-v32-finlist">${rows||'<div class="pcs-ap-empty">Финансовых операций пока нет</div>'}</div>`);
  }catch(e){window.toast?.(e.message||'Не удалось загрузить операции')}
}
function categoryFromRow(row){
  const title=row.querySelector('b')?.textContent.trim();
  return title==='Недвижимость'?'housing':title==='Автомобили'?'cars':title==='Допуслуги'?'services':title==='Трансферы'?'transfer':title==='Визы и документы'?'visa':title==='Медицина и страховка'?'medicine':null;
}
function openCategory(row){
  const key=categoryFromRow(row);if(!key)return;
  const map={housing:['housing_rent','housing_sale'],cars:['car_rent','car_sale'],transfer:['transfer'],visa:['visa','documents'],medicine:['medicine','insurance'],services:['service','cleaning','translation','legal','education','excursion']};
  const list=(window.PCS?.catalog||[]).filter(x=>(map[key]||[]).includes(String(x.category||'')));
  const title=row.querySelector('b')?.textContent.trim()||'Категория';
  window.openSheet?.(title,`<div class="pcs-v32-category">${list.map(productCard).join('')||'<div class="pcs-ap-empty">В этой категории пока нет позиций</div>'}</div>`);
}
function filterExtras(button){
  const label=button.textContent.trim().toLowerCase(),keys={'все':'all','популярные':'popular','трансферы':'transfers','визы':'visas','медицина':'medicine','бытовые':'household'};
  extrasFilter=keys[label]||'all';
  document.querySelectorAll('.pcs-ap-chipbar .pcs-ap-chip').forEach(x=>x.classList.toggle('on',x===button));
  drawExtrasFromData();
}
function extraCard(x){const title=titleOf(x)||'Услуга PCS',img=imageOf(x);return `<button class="pcs-ap-service" type="button" data-extra-id="${esc(x.id)}">${img?`<img class="pcs-v32-service-cover" src="${esc(img)}" alt="${esc(title)}">`:`<span class="ico">${esc(String(x.category||'PCS').slice(0,1).toUpperCase())}</span>`}<span><b>${esc(title)}</b><p>${esc(x.description||x.summary||'Описание уточняется')}</p><strong>${money(priceOf(x),x.currency)}${periodOf(x)}</strong></span></button>`}
function drawExtrasFromData(){
  const box=document.getElementById('pcsApServices');if(!box)return;
  let list=extrasData.filter(x=>x.is_active!==false);
  if(extrasFilter==='popular')list=list.slice(0,8);
  else if(extrasFilter!=='all')list=list.filter(x=>(extraGroups[extrasFilter]||[]).includes(String(x.category||'').toLowerCase()));
  box.innerHTML=list.map(extraCard).join('')||'<div class="pcs-ap-empty">В этой категории услуг пока нет</div>';
}
async function hydrateExtras(){
  const box=document.getElementById('pcsApServices');if(!box||box.dataset.v32Hydrated)return;
  box.dataset.v32Hydrated='loading';
  try{const r=await window.opsCall('/extras');extrasData=(Array.isArray(r)?r:r?.items||[]).filter(x=>x.is_active!==false);box.dataset.v32Hydrated='yes';drawExtrasFromData()}catch(e){delete box.dataset.v32Hydrated;box.innerHTML=`<div class="pcs-ap-empty">${esc(e.message)}</div>`}
}
function openExtra(id){
  const x=extrasData.find(v=>String(v.id)===String(id));if(!x)return;
  window.openSheet?.(titleOf(x)||'Услуга',`<div class="pcs-v32-extra"><p>${esc(x.description||x.summary||'Описание пока не добавлено')}</p><div><span>Стоимость</span><b>${money(priceOf(x),x.currency)}${periodOf(x)}</b></div><div><span>Расчёт</span><b>${esc(x.price_mode||'по запросу')}</b></div>${x.requires_approval?'<small>Требуется подтверждение менеджера</small>':''}</div>`);
}
function normalizeCity(v){const s=String(v||'').toLowerCase();if(/pattaya|паттай|bang saray/.test(s))return'Паттайя';if(/phuket|пхукет/.test(s))return'Пхукет';if(/bangkok|бангкок/.test(s))return'Бангкок';return'Таиланд'}
function locationOptions(){const cities=new Set(['Паттайя','Пхукет','Бангкок','Таиланд']);(window.PCS?.catalog||[]).forEach(x=>cities.add(normalizeCity(x.city)));return [...cities]}
function installLocationPicker(){
  const place=document.querySelector('.pcs-ap-place');if(!place||place.dataset.v32Picker)return;place.dataset.v32Picker='yes';
  const city=place.querySelector('span:first-child')?.textContent.replace('⌾','').trim()||'Паттайя';
  place.innerHTML=`<button type="button" class="pcs-v32-location"><span><i>⌾</i><b>${esc(city)}</b></span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7 5 5 5-5"/></svg></button>`;
}
function openLocations(){
  window.openSheet?.('Выберите локацию',`<div class="pcs-v32-locations">${locationOptions().map(x=>`<button type="button" data-location="${esc(x)}">${esc(x)}</button>`).join('')}</div>`)
}
async function chooseLocation(city){
  window.closeSheet?.();const label=document.querySelector('.pcs-v32-location b');if(label)label.textContent=city;
  const aliases={Паттайя:/pattaya|паттай|bang saray/i,Пхукет:/phuket|пхукет/i,Бангкок:/bangkok|бангкок/i,Таиланд:/.*/i},match=aliases[city]||/.*/i;
  const products=(window.PCS?.catalog||[]).filter(x=>match.test(String(x.city||'')));
  const cats=[['car_rent'],['housing_rent'],['housing_rent'],['transfer']];
  document.querySelectorAll('.pcs-ap-pricecard').forEach((card,i)=>{const x=products.find(v=>cats[i].includes(String(v.category||''))&&Number(v.base_price??v.price)>0);const b=card.querySelector('b');if(b)b.textContent=x?`от ${money(x.final_price??x.base_price??x.price,x.currency)}`:'—'});
}
function iso(d){return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
let priceMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1),priceRules=[];
function drawPriceCalendar(){
  const box=document.getElementById('pcsApTariffContent');if(!box)return;
  const first=new Date(priceMonth.getFullYear(),priceMonth.getMonth(),1),last=new Date(priceMonth.getFullYear(),priceMonth.getMonth()+1,0),offset=(first.getDay()+6)%7;
  let days=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(x=>`<span class="pcs-v32-dow">${x}</span>`).join('');
  days+='<i></i>'.repeat(offset);
  for(let d=1;d<=last.getDate();d++){
    const ds=iso(new Date(first.getFullYear(),first.getMonth(),d));
    const rule=priceRules.find(r=>(!r.date_from||r.date_from<=ds)&&(!r.date_to||r.date_to>=ds));
    days+=`<div class="pcs-v32-day ${rule?'has-price':''}"><b>${d}</b>${rule?`<small>${esc(rule.name||'Сезон')}</small><span>×${Number(rule.multiplier||1).toFixed(2)}</span>`:'<small>Базовый тариф</small>'}</div>`;
  }
  box.innerHTML=`<div class="pcs-v32-calhead"><button type="button" data-price-move="-1">←</button><h2>${new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'}).format(first)}</h2><button type="button" data-price-move="1">→</button></div><p class="pcs-v32-calnote">Коэффициент цены показан для каждого дня. Это календарь тарифов, а не календарь броней.</p><div class="pcs-v32-calendar">${days}</div>`;
}
async function showPriceCalendar(button){
  document.querySelectorAll('.pcs-ap-subseg button').forEach(x=>x.classList.toggle('on',x===button));
  const box=document.getElementById('pcsApTariffContent');if(!box)return;
  box.innerHTML='<div class="pcs-ap-empty">Загрузка календаря цен…</div>';
  try{const r=await window.opsCall('/seasonal-rules');priceRules=(Array.isArray(r)?r:r?.items||[]).filter(x=>x.is_active!==false);drawPriceCalendar()}catch(e){box.innerHTML=`<div class="pcs-ap-empty">${esc(e.message)}</div>`}
}

document.addEventListener('click',e=>{
  const priceMove=e.target.closest('[data-price-move]');
  if(priceMove){priceMonth=new Date(priceMonth.getFullYear(),priceMonth.getMonth()+Number(priceMove.dataset.priceMove),1);drawPriceCalendar();return}
  const product=e.target.closest('.pcs-ap-product');
  if(product){e.preventDefault();e.stopImmediatePropagation();const id=product.dataset.productId||product.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];openProduct(id);return}
  const all=e.target.closest('.ref-catalog .pcs-ap-section-head .pcs-ap-link');
  if(all){e.preventDefault();e.stopImmediatePropagation();showAllPopular();return}
  const financeAll=e.target.closest('.ref-finance .pcs-ap-section-head .pcs-ap-link');
  if(financeAll){e.preventDefault();e.stopImmediatePropagation();showAllFinance();return}
  const row=e.target.closest('.ref-catalog .pcs-ap-catrow');
  if(row){e.preventDefault();e.stopImmediatePropagation();openCategory(row);return}
  const chip=e.target.closest('.pcs-ap-chipbar .pcs-ap-chip');if(chip){filterExtras(chip);return}
  const extra=e.target.closest('.pcs-ap-service[data-extra-id]');if(extra){e.preventDefault();e.stopImmediatePropagation();openExtra(extra.dataset.extraId);return}
  const loc=e.target.closest('.pcs-v32-location');if(loc){e.preventDefault();openLocations();return}
  const locChoice=e.target.closest('[data-location]');if(locChoice){chooseLocation(locChoice.dataset.location);return}
  const calendar=[...document.querySelectorAll('.pcs-ap-subseg button')].find(x=>x.textContent.trim()==='Календарь цен');
  if(calendar&&calendar.contains(e.target)){e.preventDefault();e.stopImmediatePropagation();showPriceCalendar(calendar);return}
  if(e.target.closest('.ref-catalog .pcs-ap-filter'))requestAnimationFrame(()=>{applyCatalogRows();refreshPopular()});
},true);

document.addEventListener('wheel',e=>{const rail=e.target.closest('.pcs-ap-popular');if(rail&&Math.abs(e.deltaY)>Math.abs(e.deltaX)){rail.scrollLeft+=e.deltaY;e.preventDefault()}},{passive:false});

new MutationObserver(()=>{if(document.querySelector('.ref-catalog .pcs-ap-catrow'))requestAnimationFrame(()=>{applyCatalogRows();refreshPopular()});const services=document.getElementById('pcsApServices');if(services)requestAnimationFrame(()=>{if(!services.dataset.v32Hydrated)hydrateExtras();else if(services.querySelector('.pcs-ap-service:not([data-extra-id])'))drawExtrasFromData()});if(document.querySelector('.pcs-ap-place'))requestAnimationFrame(installLocationPicker)}).observe(document.documentElement,{subtree:true,childList:true});
hydrateExtras();installLocationPicker();
})();
