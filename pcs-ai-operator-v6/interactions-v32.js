(()=>{
'use strict';
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=(v,c='THB')=>{const n=Number(v||0);return n?new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(n)+' '+(c==='THB'?'฿':esc(c)):'—'};
const groupLabels={housing:['Недвижимость'],cars:['Автомобили'],services:['Трансферы','Визы и документы','Медицина и страховка','Допуслуги']};

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
function productCard(x){
  const img=x.media_items?.[0]?.public_url||x.image_url||'';
  return `<button class="pcs-ap-product" type="button" data-product-id="${esc(x.id)}">${img?`<img src="${esc(img)}" alt="">`:''}<div><b>${esc(x.title||'Объект')}</b><small>${esc(x.city||x.location||'')}</small><strong>${money(x.final_price??x.price??x.base_price,x.currency)}</strong></div></button>`;
}
function showAllPopular(){
  const box=document.getElementById('pcsApPopular');
  if(!box)return;
  const list=(window.PCS?.catalog||[]).filter(x=>x.media_items?.length||x.image_url);
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
  const label=button.textContent.trim().toLowerCase();
  document.querySelectorAll('.pcs-ap-chipbar .pcs-ap-chip').forEach(x=>x.classList.toggle('on',x===button));
  const tests={
    'популярные':/популяр|premium|vip/i,'трансферы':/трансфер|авто|водител/i,
    'визы':/виз|документ|легализ/i,'медицина':/медицин|страхов|клиник/i,'бытовые':/уборк|клининг|быт|ремонт/i
  };
  document.querySelectorAll('.pcs-ap-service').forEach(card=>card.hidden=Boolean(tests[label]&&!tests[label].test(card.textContent)));
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
  const calendar=[...document.querySelectorAll('.pcs-ap-subseg button')].find(x=>x.textContent.trim()==='Календарь цен');
  if(calendar&&calendar.contains(e.target)){e.preventDefault();e.stopImmediatePropagation();showPriceCalendar(calendar);return}
  if(e.target.closest('.ref-catalog .pcs-ap-filter'))requestAnimationFrame(applyCatalogRows);
},true);

new MutationObserver(()=>{if(document.querySelector('.ref-catalog .pcs-ap-catrow'))requestAnimationFrame(applyCatalogRows)}).observe(document.documentElement,{subtree:true,childList:true});
})();
