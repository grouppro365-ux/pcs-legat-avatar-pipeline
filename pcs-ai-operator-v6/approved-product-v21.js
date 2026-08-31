(()=>{
'use strict';
document.documentElement.classList.add('pcs-v21');

const INTEGRATIONS='https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-publish-stable-web-v1';
const V={bookingTab:'reservations',catalogCat:'all',catalogStatus:'all'};
const e=s=>window.esc?window.esc(s):String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const arr=x=>Array.isArray(x)?x:Array.isArray(x?.items)?x.items:Array.isArray(x?.data)?x.data:[];
const call=(p,o)=>window.call(p,o);
const ops=(p,o)=>typeof window.opsCall==='function'?window.opsCall(p,o):Promise.reject(new Error('Операционный API недоступен'));
const money=(v,c='THB')=>{const n=Number(v);return Number.isFinite(n)&&n>0?new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(n)+' '+(c||'THB'):'по запросу'};

function mount(page,kicker,title,sub,html){
  if(window.PCS)window.PCS.page=page;
  const root=document.querySelector('#root');
  if(root&&typeof window.shell==='function')root.innerHTML=window.shell();
  if(typeof window.pcsInstallNav20==='function')window.pcsInstallNav20();
  const m=document.querySelector('#main');if(!m)return null;
  m.innerHTML=`<div class="eyebrow">${e(kicker)}</div><h1 class="title">${e(title)}</h1><p class="sub">${e(sub)}</p>${html||''}`;
  return m;
}
function statusRu(s){return({available:'Доступно',checking:'На проверке',held:'Предварительно занято',booked:'Забронировано',unavailable:'Недоступно',disabled:'Архив',requires_confirmation:'На проверке',available_confirmed:'Доступно'})[String(s||'').toLowerCase()]||String(s||'—')}
function categoryRu(c){return({car_rent:'Аренда авто',car_buy:'Продажа авто',housing_rent:'Аренда жилья',housing_buy:'Продажа жилья',bike_rent:'Аренда байка',visa:'Визы',education:'Образование',driving_license:'Права',transfer:'Трансферы',business_support:'Бизнес',legal:'Юристы',translation:'Переводы',tour:'Экскурсии',events:'Мероприятия',service:'Услуга'})[c]||c||'Услуга'}

/* ---------- CATALOG ---------- */
async function approvedCatalog(){
  mount('catalog','Каталог PCS','Каталог услуг и объектов','Автопарк, жильё и услуги с актуальными статусами, ценами и фотографиями.',`<div id="v21CatalogKpi" class="premium-kpis"><div class="premium-kpi"><span>Загрузка</span><b>…</b></div></div><div class="catalog-filter-block"><div class="filter-caption">Статус</div><div id="v21StatusFilters" class="ops-tabs"></div><div class="filter-caption">Категория</div><div id="v21CategoryFilters" class="ops-tabs"></div></div><div id="v21Catalog" class="list"><div class="v21-empty">Загружаю каталог…</div></div>`);
  try{
    const all=arr(await call('/catalog')).filter(x=>!x.deleted_at);if(window.PCS)window.PCS.catalog=all;
    const available=all.filter(x=>['available','available_confirmed'].includes(String(x.status||'').toLowerCase())).length;
    const checking=all.filter(x=>['checking','requires_confirmation'].includes(String(x.status||'').toLowerCase())).length;
    const cars=all.filter(x=>String(x.category||'').startsWith('car_')||String(x.entity_type||'').toUpperCase()==='VEHICLE').length;
    document.querySelector('#v21CatalogKpi').innerHTML=`<button class="premium-kpi" onclick="pcsV21CatalogKpi('all','all')"><span>Всего позиций</span><b>${all.length}</b></button><button class="premium-kpi" onclick="pcsV21CatalogKpi('cars','all')"><span>Автомобили</span><b>${cars}</b></button><button class="premium-kpi" onclick="pcsV21CatalogKpi('all','available')"><span>Подтверждено доступно</span><b>${available}</b></button><button class="premium-kpi" onclick="pcsV21CatalogKpi('all','checking')"><span>На проверке</span><b>${checking}</b></button>`;
    const statuses=[['all','Все'],['available','Доступно'],['checking','На проверке'],['held','Предварительно занято'],['booked','Забронировано'],['unavailable','Недоступно'],['disabled','Архив']];
    const cats=[['all','Все'],['car_rent','Аренда авто'],['car_buy','Продажа авто'],['housing_rent','Аренда жилья'],['housing_buy','Продажа жилья'],['visa','Визы'],['education','Образование'],['driving_license','Права'],['transfer','Трансферы'],['business_support','Бизнес'],['legal','Юристы'],['translation','Переводы'],['tour','Экскурсии'],['events','Мероприятия']];
    document.querySelector('#v21StatusFilters').innerHTML=statuses.map(([v,n])=>`<button class="ops-tab ${V.catalogStatus===v?'on':''}" onclick="pcsV21CatalogStatus('${v}')">${n}</button>`).join('');
    document.querySelector('#v21CategoryFilters').innerHTML=cats.map(([v,n])=>`<button class="ops-tab ${V.catalogCat===v?'on':''}" onclick="pcsV21CatalogCategory('${v}')">${n}</button>`).join('');
    window.__pcsV21CatalogRows=all;renderCatalogRows();
  }catch(err){const x=document.querySelector('#v21Catalog');if(x)x.innerHTML=`<div class="v21-empty">${e(err.message)}</div>`}
}
function renderCatalogRows(){
  const all=window.__pcsV21CatalogRows||[];let rows=all;
  if(V.catalogCat==='cars')rows=rows.filter(x=>String(x.category||'').startsWith('car_')||String(x.entity_type||'').toUpperCase()==='VEHICLE');
  else if(V.catalogCat!=='all')rows=rows.filter(x=>x.category===V.catalogCat);
  if(V.catalogStatus!=='all')rows=rows.filter(x=>{const s=String(x.status||'').toLowerCase();return V.catalogStatus==='available'?['available','available_confirmed'].includes(s):V.catalogStatus==='checking'?['checking','requires_confirmation'].includes(s):s===V.catalogStatus});
  const box=document.querySelector('#v21Catalog');if(!box)return;
  box.innerHTML=rows.map(x=>{const media=x.media_items||[],cover=media[0]?.public_url||x.image_url||'',cat=x.category||(String(x.entity_type||'').toUpperCase()==='VEHICLE'?'car_rent':String(x.entity_type||'').toUpperCase()==='PROPERTY'?'housing_rent':'service'),day=Number(x.daily_price||0),week=Number(x.weekly_price||0),month=Number(x.monthly_price||0),price=Number(x.final_price??x.price??x.client_price_thb??0);const prices=String(cat).startsWith('car_')&&(day||week||month)?`<div class="period-price-strip"><div><small>Сутки</small><b>${money(day,x.currency)}</b></div><div><small>Неделя</small><b>${money(week,x.currency)}</b></div><div><small>Месяц</small><b>${money(month,x.currency)}</b></div></div>`:`<div class="price-strip"><div><small>Цена клиенту</small><b>${money(price,x.currency)}</b></div></div>`;return `<article class="catalog-card"><div class="cover">${cover?`<img src="${e(cover)}" alt="${e(x.title||'')}">`:`<div class="empty-cover"><div><b>PCS</b><small>${e(categoryRu(cat))}</small></div></div>`}</div><div class="catalog-copy"><div class="pills"><span class="pill">${e(statusRu(x.status||x.availability_status))}</span><span class="pill">${e(categoryRu(cat))}</span>${media.length?`<span class="pill">${media.length} фото</span>`:''}</div><h3>${e(x.title||'Позиция')}</h3><p>${e(x.city||x.location||'Таиланд')}</p>${prices}<div class="toolbar">${typeof window.mediaManager==='function'?`<button class="btn soft" onclick="mediaManager('${e(x.id)}')">Фотографии</button>`:''}${typeof window.pricingManager==='function'?`<button class="btn" onclick="pricingManager('${e(x.id)}')">Цена и сезоны</button>`:''}</div></div></article>`}).join('')||'<div class="v21-empty">По выбранным фильтрам позиций нет</div>';
}
window.pcsV21CatalogStatus=v=>{V.catalogStatus=v;document.querySelectorAll('#v21StatusFilters .ops-tab').forEach(b=>b.classList.toggle('on',b.textContent===({all:'Все',available:'Доступно',checking:'На проверке',held:'Предварительно занято',booked:'Забронировано',unavailable:'Недоступно',disabled:'Архив'})[v]));renderCatalogRows()};
window.pcsV21CatalogCategory=v=>{V.catalogCat=v;approvedCatalog()};
window.pcsV21CatalogKpi=(cat,st)=>{V.catalogCat=cat;V.catalogStatus=st;approvedCatalog()};

/* ---------- BOOKINGS ---------- */
const bookingStatus=s=>({requested:'Запрос',new:'Новая',hold:'Холд',confirmed:'Подтверждено',active:'В аренде',in_progress:'В работе',booked:'Забронировано',paid:'Оплачено',completed:'Завершено',cancelled:'Отменено'})[String(s||'').toLowerCase()]||String(s||'—');
async function approvedBookings(tab=V.bookingTab){
  V.bookingTab=tab;
  mount('bookings','Операционная аренда','Бронирования','Брони, допуслуги и тарифы — в одной рабочей системе.',`<div class="ops-tabs"><button class="ops-tab ${tab==='reservations'?'on':''}" onclick="pcsV21BookingTab('reservations')">Брони</button><button class="ops-tab ${tab==='extras'?'on':''}" onclick="pcsV21BookingTab('extras')">Допуслуги</button><button class="ops-tab ${tab==='pricing'?'on':''}" onclick="pcsV21BookingTab('pricing')">Тарифы</button></div><div id="v21BookingBody" class="v21-booking-shell"><div class="v21-empty">Загрузка…</div></div>`);
  const box=document.querySelector('#v21BookingBody');
  try{
    if(tab==='reservations'){
      const rows=arr(await ops('/reservations')),state=x=>String(x.status||x.operational_status||'').toLowerCase(),newCount=rows.filter(x=>['requested','new','qualifying'].includes(state(x))).length,active=rows.filter(x=>['hold','confirmed','active','in_progress','booked'].includes(state(x))).length,paid=rows.filter(x=>String(x.payment_status||'').toLowerCase()==='paid'||state(x)==='paid').length;
      box.innerHTML=`<div class="ops-head"><div class="ops-stat-grid"><div class="ops-stat"><span class="muted">Всего</span><b>${rows.length}</b></div><div class="ops-stat"><span class="muted">Новые</span><b>${newCount}</b></div><div class="ops-stat"><span class="muted">Активные</span><b>${active}</b></div><div class="ops-stat"><span class="muted">Оплачены</span><b>${paid}</b></div></div>${typeof window.newReservation==='function'?'<button class="btn" onclick="newReservation()">+ Бронь</button>':''}</div><div class="list">${rows.map(r=>`<article class="booking-row"><div><div class="pills"><span class="pill">${e(bookingStatus(state(r)))}</span>${r.start_date?`<span class="pill">${e(r.start_date)}${r.end_date?' → '+e(r.end_date):''}</span>`:''}</div><h3>${e(r.pcs_catalog_items?.title||r.item_title||r.category||r.public_id||'Бронь')}</h3><p>${e(r.pcs_contacts?.name||r.client_name||r.client_contact||'Клиент не указан')}</p></div></article>`).join('')||'<div class="v21-empty">Бронирований пока нет</div>'}</div>`;
    }else if(tab==='extras'){
      const rows=arr(await ops('/extras'));
      box.innerHTML=`<div class="ops-head"><div><h2>Дополнительные услуги</h2><p class="muted">Услуги, которые можно добавлять к бронированию.</p></div>${typeof window.newExtra==='function'?'<button class="btn" onclick="newExtra()">+ Допуслуга</button>':''}</div><div class="list">${rows.map(x=>`<article class="extra-row"><div><b>${e(x.name||x.title||'Допуслуга')}</b><p>${e(x.description||'')}</p><div class="pills"><span class="pill">${money(x.price??x.client_price_thb,x.currency||'THB')}</span>${x.price_mode?`<span class="pill">${e(x.price_mode)}</span>`:''}</div></div></article>`).join('')||'<div class="v21-empty">Допуслуг пока нет</div>'}</div>`;
    }else{
      const [dur,seas]=await Promise.all([ops('/duration-rules'),ops('/seasonal-rules')]),d=arr(dur),s=arr(seas);
      box.innerHTML=`<div class="pricing-method"><b>Как считается цена</b><br>Базовая цена × сезонный коэффициент × коэффициент длительности + допуслуги. Все правила отображаются отдельно.</div><div class="grid2"><section class="card"><div class="ops-head"><div><h2>Сезоны</h2><p class="muted">Коэффициенты по датам.</p></div>${typeof window.newSeasonRule==='function'?'<button class="btn" onclick="newSeasonRule()">+ Сезон</button>':''}</div><div class="list">${s.map(x=>`<div class="price-rule"><b>${e(x.name||'Сезон')}</b><p>${e(x.date_from||'')} ${x.date_to?'— '+e(x.date_to):''}</p><span class="pill">×${e(x.multiplier??1)}</span></div>`).join('')||'<div class="muted">Сезонных правил нет</div>'}</div></section><section class="card"><div class="ops-head"><div><h2>Длительность</h2><p class="muted">Скидка или наценка по числу дней.</p></div>${typeof window.newDurationRule==='function'?'<button class="btn" onclick="newDurationRule()">+ Тариф</button>':''}</div><div class="list">${d.map(x=>`<div class="price-rule"><b>${e(x.name||'Тариф')}</b><p>${e(x.min_days||1)}${x.max_days?'–'+e(x.max_days):'+'} дней</p><span class="pill">×${e(x.multiplier??1)}</span></div>`).join('')||'<div class="muted">Правил длительности нет</div>'}</div></section></div>`;
    }
  }catch(err){box.innerHTML=`<div class="v21-empty">${e(err.message)}</div>`}
}
window.pcsV21BookingTab=t=>approvedBookings(t);

/* ---------- CONNECTIONS ---------- */
const schemas={
 line:{title:'LINE',desc:'LINE Official Account',fields:[['channel_id','Channel ID'],['channel_access_token','Channel access token','secret'],['channel_secret','Channel secret','secret']]},
 whatsapp:{title:'WhatsApp',desc:'WhatsApp Business Cloud API',fields:[['waba_id','WABA ID'],['phone_number_id','Phone Number ID'],['access_token','Permanent access token','secret'],['webhook_verify_token','Webhook verify token','secret'],['graph_version','Graph API version']]},
 instagram:{title:'Instagram',desc:'Instagram Business Messaging',fields:[['instagram_account_id','Instagram Business Account ID'],['facebook_page_id','Facebook Page ID'],['access_token','Access token','secret'],['graph_version','Graph API version']]},
 facebook:{title:'Facebook',desc:'Facebook Page Messenger',fields:[['page_id','Page ID'],['page_access_token','Page access token','secret'],['webhook_verify_token','Webhook verify token','secret'],['graph_version','Graph API version']]}
};
function integrationReady(provider,c){const cfg=c?.configured||{};if(provider==='line')return !!cfg.channel_access_token;if(provider==='whatsapp')return !!cfg.access_token&&!!c.phone_number_id;if(provider==='instagram')return !!cfg.access_token&&!!c.instagram_account_id;if(provider==='facebook')return !!cfg.page_access_token&&!!c.page_id;return false}
async function integrationRequest(method='GET',payload=null){const h={accept:'application/json'},t=localStorage.pcsToken||'';if(t)h.authorization='Bearer '+t;if(payload)h['content-type']='application/json';const r=await fetch(INTEGRATIONS,{method,headers:h,body:payload?JSON.stringify(payload):undefined,cache:'no-store'});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||('HTTP '+r.status));return d}
function connectionCard(provider,c={}){const s=schemas[provider],ready=integrationReady(provider,c);return `<section class="integration-card" data-provider="${provider}"><div class="integration-head"><div><h2>${s.title}</h2><p>${s.desc}</p></div><span class="integration-status ${ready?'ok':'warn'}">${ready?'Настроено':'Требует настройки'}</span></div><div class="integration-fields ${s.fields.length>3?'two':''}">${s.fields.map(([key,label,type])=>`<div class="field"><label>${label}</label><input id="int-${provider}-${key}" ${type==='secret'?'type="password" autocomplete="new-password"':''} value="${type==='secret'?'':e(c[key]||((key==='graph_version')?'v23.0':''))}" placeholder="${type==='secret'&&c.configured?.[key]?'Сохранено — оставьте пустым, чтобы не менять':''}"></div>`).join('')}</div><div class="integration-actions"><button class="btn" onclick="pcsSaveIntegration('${provider}')">Сохранить</button><button class="btn soft" onclick="pcsTestIntegration('${provider}')">Проверить</button></div><div id="int-result-${provider}" class="integration-result">${c.updated_at?'Обновлено: '+e(new Date(c.updated_at).toLocaleString('ru-RU')):''}</div></section>`}
async function approvedConnections(){
  mount('connect','Каналы и интеграции','Подключения','Все каналы остаются в системе: заполняете данные, сохраняете и проверяете подключение. Ничего не скрываем.',`<div id="v21Connections" class="v21-connections"><div class="integration-card">Загрузка…</div></div>`);
  const box=document.querySelector('#v21Connections');
  try{
    const [ints,tg]=await Promise.allSettled([integrationRequest(),call('/settings')]);const channels=ints.status==='fulfilled'?ints.value.channels||{}:{};const t=tg.status==='fulfilled'?tg.value:{};
    const tgReady=!!(t.telegram_business_connected||t.telegram_can_read||t.configured?.telegram_bot_token);
    const telegram=`<section class="integration-card"><div class="integration-head"><div><h2>Telegram Business</h2><p>${e(t.telegram_bot_username?'@'+t.telegram_bot_username:'@pcs_manager_bot')} · основной канал PCS</p></div><span class="integration-status ${tgReady?'ok':'warn'}">${tgReady?'Подключено':'Требует настройки'}</span></div><div class="integration-actions"><button class="btn soft" onclick="pcsTestTelegramV21()">Проверить Telegram</button></div><div id="int-result-telegram" class="integration-result">${t.telegram_webhook_url?'Webhook настроен':''}</div></section>`;
    box.innerHTML=telegram+Object.keys(schemas).map(p=>connectionCard(p,channels[p]||{})).join('');
  }catch(err){box.innerHTML=`<div class="integration-card"><div class="integration-result bad">${e(err.message)}</div></div>`}
}
window.pcsSaveIntegration=async provider=>{const s=schemas[provider],fields={};for(const [key] of s.fields){const el=document.querySelector(`#int-${provider}-${key}`);if(el)fields[key]=el.value.trim()}const out=document.querySelector('#int-result-'+provider);try{if(out){out.className='integration-result';out.textContent='Сохраняю…'}await integrationRequest('POST',{action:'save',provider,fields});if(out){out.className='integration-result ok';out.textContent='✓ Сохранено на сервере'}setTimeout(()=>approvedConnections(),500)}catch(err){if(out){out.className='integration-result bad';out.textContent='✕ '+err.message}}};
window.pcsTestIntegration=async provider=>{const out=document.querySelector('#int-result-'+provider);try{if(out){out.className='integration-result';out.textContent='Проверяю…'}const d=await integrationRequest('POST',{action:'test',provider});if(out){out.className='integration-result ok';out.textContent='✓ '+(d.label||'Подключение работает')}}catch(err){if(out){out.className='integration-result bad';out.textContent='✕ '+err.message}}};
window.pcsTestTelegramV21=async()=>{const out=document.querySelector('#int-result-telegram');try{if(out){out.className='integration-result';out.textContent='Проверяю…'}const d=await call('/test/telegram',{method:'POST',body:'{}'});if(out){out.className='integration-result ok';out.textContent='✓ Telegram работает'+(d.username?' · @'+d.username:'')}}catch(err){if(out){out.className='integration-result bad';out.textContent='✕ '+err.message}}};

/* Final navigation contract: product structure is not silently simplified. */
const prevGo=window.go;
window.go=function(p){if(p==='catalog')return approvedCatalog();if(p==='bookings')return approvedBookings();if(p==='connect')return approvedConnections();const r=prevGo(p);setTimeout(()=>{if(typeof window.pcsInstallNav20==='function')window.pcsInstallNav20()},0);return r};
window.moreMenu=function(){if(typeof window.openSheet!=='function')return;window.openSheet('Ещё',`<div class="more-grid"><button class="btn soft" onclick="closeSheet();go('crm')">CRM</button><button class="btn blue" onclick="closeSheet();go('approvals')">Требуют ответа</button><button class="btn sage" onclick="closeSheet();go('kb')">База знаний</button><button class="btn soft" onclick="closeSheet();go('calendar')">Календарь</button><button class="btn soft" onclick="closeSheet();go('finance')">Финансы</button><button class="btn" onclick="closeSheet();go('connect')">Подключения</button><button class="btn ghost" onclick="closeSheet();go('errors')">Ошибки и повторы</button><button class="btn ghost" onclick="closeSheet();go('status')">Состояние системы</button><button class="btn danger" onclick="logout()">Выйти</button></div>`)};

/* Repaint after legacy mutating actions that still return to an older screen. */
['createReservation','saveExtra','disableExtra','saveSeasonRule','disableSeason','saveDurationRule','disableDuration','setReservationStatus'].forEach(name=>{const orig=window[name];if(typeof orig==='function'){window[name]=async(...args)=>{const r=await orig(...args);setTimeout(()=>{if(window.PCS?.page==='bookings')approvedBookings()},80);return r}}});
['saveBasePrice','addSeasonRule','deleteSeasonRule'].forEach(name=>{const orig=window[name];if(typeof orig==='function'){window[name]=async(...args)=>{const r=await orig(...args);setTimeout(()=>{if(window.PCS?.page==='catalog')approvedCatalog()},80);return r}}});

window.addEventListener('DOMContentLoaded',()=>{document.documentElement.classList.add('pcs-v21');setTimeout(()=>{if(typeof window.pcsInstallNav20==='function')window.pcsInstallNav20()},0)});
})();
