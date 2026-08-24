(()=>{
'use strict';
const BRAND='Premium Concierge Service Thailand';
const CDN_BASE='https://cdn.jsdelivr.net/gh/grouppro365-ux/pcs-legat-avatar-pipeline@main/pcs-ai-operator-v6/';
const LOGO=CDN_BASE+'pcs-mark.svg?v=20260824-32';
const UI='https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-ui-api';
const V9='https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-ui-api-v9';
const CAL='https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-calendar-api';
const icon={
 search:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.8"/><path d="m15 15 4.2 4.2"/></svg>',
 inbox:'<svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z"/><path d="M4 14h4l2 3h4l2-3h4"/></svg>',
 booking:'<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/><path d="m9 15 2 2 4-4"/></svg>',
 car:'<svg viewBox="0 0 24 24"><path d="m5 15 1.5-5h11l1.5 5"/><rect x="3" y="14" width="18" height="5" rx="2"/><circle cx="7" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/></svg>',
 calendar:'<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M8 3v4M16 3v4M3.5 10h17"/></svg>',
 money:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M15 8.5c-.7-.7-1.7-1-3-1-1.7 0-3 .8-3 2s1 1.8 3 2.2 3 1.1 3 2.4-1.3 2.1-3 2.1c-1.2 0-2.3-.4-3-1.1M12 5.5v13"/></svg>',
 bot:'<svg viewBox="0 0 24 24"><rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M8 12h.01M16 12h.01M8 16h8"/></svg>',
 crm:'<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3.5 19c.6-3.4 2.4-5 5.5-5s4.9 1.6 5.5 5"/><circle cx="17" cy="9" r="2.2"/></svg>',
 catalog:'<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>',
 theme:'<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z"/></svg>'
};
const escSafe=s=>typeof window.esc==='function'?window.esc(s):String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function arr(v){if(Array.isArray(v))return v;if(Array.isArray(v?.items))return v.items;if(Array.isArray(v?.data))return v.data;if(Array.isArray(v?.rows))return v.rows;if(Array.isArray(v?.reservations))return v.reservations;return []}
function n(v){const x=Number(v);return Number.isFinite(x)?x:0}
function fmtMoney(v,c='THB'){return new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(n(v))+' '+c}
function fmtDate(v){try{return new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'short'}).format(new Date(v))}catch{return '—'}}
function isoDate(d){return d.toISOString().slice(0,10)}
function token(){return localStorage.pcsToken||''}
async function fetchJson(url,ms=9000){const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),ms);try{const h:any={};if(token())h.authorization='Bearer '+token();const r=await fetch(url,{headers:h,signal:ctrl.signal,cache:'no-store'});let d:any=null;try{d=await r.json()}catch{}if(!r.ok)throw new Error(d?.error||`HTTP ${r.status}`);return d}finally{clearTimeout(timer)}}
function patchBrand(){
 document.querySelectorAll('.logo').forEach((el:any)=>{el.classList.remove('logo');el.classList.add('pcs-logo-final');el.innerHTML=`<img src="${LOGO}" alt="PCS" onerror="this.style.display='none';this.parentElement.classList.add('logo-fallback')">`});
 document.querySelectorAll('.brand').forEach((el:any)=>{el.classList.remove('brand');el.classList.add('pcs-brand-final');el.textContent=BRAND});
 document.querySelectorAll('.pcs-script').forEach((el:any)=>{if(/Premium Concierge/i.test(el.textContent||''))el.textContent=BRAND});
 const themeBtn=document.querySelector('.top .iconbtn');if(themeBtn&&!themeBtn.querySelector('svg'))themeBtn.innerHTML=icon.theme;
}
function physicalFleet(catalog){const ids=new Set();for(const x of catalog){if(x.deleted_at)continue;if(!['car_rent','car_buy'].includes(x.category))continue;const id=x.metadata?.ltc_id||x.metadata?.fleet_id||String(x.title||'').replace(/\s+(аренда|продажа).*$/iu,'').trim();if(id)ids.add(id)}return ids.size}
function loadState(okCount,total){return okCount===total?'Данные обновлены':okCount?'Часть данных временно недоступна':'Не удалось обновить данные'}
async function dashboardData(){
 const now=new Date(),to=new Date(now.getTime()+120*86400000);
 const req=[fetchJson(UI+'/crm'),fetchJson(UI+'/catalog'),fetchJson(V9+'/finance'),fetchJson(`${CAL}?from=${isoDate(now)}&to=${isoDate(to)}`)];
 const rs=await Promise.allSettled(req);
 const ok=rs.filter(x=>x.status==='fulfilled').length;
 return {clients:arr(rs[0].status==='fulfilled'?rs[0].value:[]),catalog:arr(rs[1].status==='fulfilled'?rs[1].value:[]),finance:arr(rs[2].status==='fulfilled'?rs[2].value:[]),bookings:arr(rs[3].status==='fulfilled'?rs[3].value:[]),ok,total:4};
}
window.dashboardPage=async function(){
 try{window.opsNav?.()}catch{}
 const m=document.querySelector('#main');if(!m)return;
 m.innerHTML=`<div class="travel-dashboard pcs-dashboard-v18">
 <section class="travel-hero pcs-hero-v18"><div class="travel-hero-copy"><span class="pcs-script">${BRAND}</span><h1>Управляйте сервисом.<br><span>Не теряйте клиента.</span></h1><p>Входящие, брони, каталог, оплаты и контроль коммуникаций — в одном кабинете.</p><div class="travel-search"><input id="dashSearch" placeholder="Клиент, запрос, город…" autocomplete="off"><button aria-label="Найти" onclick="dashboardSearch()">${icon.search}</button></div><div id="dashHealth" class="dash-health">Обновляю данные…</div></div><div class="travel-hero-side" id="heroStats"><div class="travel-hero-stat"><small>Горячие</small><b>—</b></div><div class="travel-hero-stat"><small>Брони</small><b>—</b></div><div class="travel-hero-stat"><small>Доступно</small><b>—</b></div><div class="travel-hero-stat"><small>Автопарк</small><b>—</b></div></div></section>
 <section class="travel-shortcuts"><button class="travel-shortcut" onclick="go('inbox')"><span class="ico">${icon.inbox}</span><span>Входящие</span></button><button class="travel-shortcut" onclick="go('bookings')"><span class="ico">${icon.booking}</span><span>Брони</span></button><button class="travel-shortcut" onclick="go('catalog')"><span class="ico">${icon.car}</span><span>Автопарк</span></button><button class="travel-shortcut" onclick="go('calendar')"><span class="ico">${icon.calendar}</span><span>Календарь</span></button><button class="travel-shortcut" onclick="go('finance')"><span class="ico">${icon.money}</span><span>Финансы</span></button><button class="travel-shortcut" onclick="go('connect')"><span class="ico">${icon.bot}</span><span>Подключения</span></button></section>
 <section id="dashKpis" class="travel-kpis"><div class="travel-kpi"><span>Загрузка данных</span><b>—</b></div></section>
 <section class="travel-dashboard-grid"><div class="travel-panel"><div class="travel-panel-head"><h2>Последние обращения</h2><button onclick="go('inbox')">Все →</button></div><div id="dashClients" class="travel-mini-list"><div class="muted">Обновляю…</div></div></div><div class="travel-panel"><div class="travel-panel-head"><h2>Ближайшие брони</h2><button onclick="go('calendar')">Календарь →</button></div><div id="dashBookings" class="travel-mini-list"><div class="muted">Обновляю…</div></div></div></section></div>`;
 patchBrand();
 try{
  const {clients,catalog,finance,bookings,ok,total}=await dashboardData();
  const hot=clients.filter((x:any)=>String(x.priority||'').toUpperCase()==='HOT').length;
  const waiting=clients.filter((x:any)=>String(x.status||'').toUpperCase()==='WAITING_CLIENT').length;
  const activeBookings=bookings.filter((x:any)=>['confirmed','active','hold','requested'].includes(String(x.status||'').toLowerCase())).length;
  const available=catalog.filter((x:any)=>!x.deleted_at&&x.status==='available').length;
  const checking=catalog.filter((x:any)=>!x.deleted_at&&x.status==='checking').length;
  const catalogTotal=catalog.filter((x:any)=>!x.deleted_at).length;
  const fleet=physicalFleet(catalog);
  const revenue=finance.filter((x:any)=>x.status==='paid'&&x.entry_type==='income'&&(x.currency||'THB')==='THB').reduce((s:number,x:any)=>s+n(x.amount),0);
  const hs=document.querySelector('#heroStats');if(hs)hs.innerHTML=`<div class="travel-hero-stat"><small>Горячие</small><b>${hot}</b></div><div class="travel-hero-stat"><small>Брони</small><b>${activeBookings}</b></div><div class="travel-hero-stat"><small>Доступно</small><b>${available}</b></div><div class="travel-hero-stat"><small>Автопарк</small><b>${fleet}</b></div>`;
  const kp=document.querySelector('#dashKpis');if(kp)kp.innerHTML=`<button class="travel-kpi" onclick="go('crm')"><div class="travel-kpi-head"><span>Клиенты</span><span class="travel-kpi-icon">${icon.crm}</span></div><b>${clients.length}</b><em>${waiting} ждут ответа</em></button><button class="travel-kpi" onclick="go('bookings')"><div class="travel-kpi-head"><span>Брони</span><span class="travel-kpi-icon">${icon.booking}</span></div><b>${activeBookings}</b><em>активные и предварительные</em></button><button class="travel-kpi" onclick="go('catalog')"><div class="travel-kpi-head"><span>Каталог</span><span class="travel-kpi-icon">${icon.catalog}</span></div><b>${catalogTotal}</b><em>${checking} на проверке · ${available} доступно</em></button><button class="travel-kpi" onclick="go('catalog')"><div class="travel-kpi-head"><span>Автопарк</span><span class="travel-kpi-icon">${icon.car}</span></div><b>${fleet}</b><em>физических машин</em></button><button class="travel-kpi finance-kpi" onclick="go('finance')"><div class="travel-kpi-head"><span>Оплачено</span><span class="travel-kpi-icon">${icon.money}</span></div><b>${fmtMoney(revenue)}</b><em>зафиксировано в финансах</em></button>`;
  const cl=document.querySelector('#dashClients');if(cl)cl.innerHTML=clients.slice(0,6).map((x:any)=>`<button class="travel-mini-row" onclick="openClient('${x.id}')"><span class="travel-mini-dot"></span><span><b>${escSafe(x.name||x.username||'Клиент')}</b><small>${escSafe(x.need||x.summary||x.intent||'Без описания')}</small></span><strong>${escSafe(x.priority==='HOT'?'HOT':x.status||'')}</strong></button>`).join('')||'<div class="muted">Обращений пока нет</div>';
  const next=bookings.filter((x:any)=>x.status!=='cancelled'&&String(x.end_date||'')>=isoDate(new Date())).sort((a:any,b:any)=>String(a.start_date).localeCompare(String(b.start_date))).slice(0,6);
  const bl=document.querySelector('#dashBookings');if(bl)bl.innerHTML=next.map((x:any)=>`<div class="travel-mini-row"><span class="travel-mini-dot"></span><span><b>${escSafe(x.pcs_catalog_items?.title||'Бронь')}</b><small>${fmtDate(x.start_date)} → ${fmtDate(x.end_date)}</small></span><strong>${escSafe(x.status||'')}</strong></div>`).join('')||'<div class="muted">Ближайших броней нет</div>';
  const health=document.querySelector('#dashHealth');if(health){health.textContent=loadState(ok,total);health.classList.toggle('warn',ok<total)}
 }catch(e){
  const health=document.querySelector('#dashHealth');if(health){health.textContent='Не удалось обновить дашборд · нажмите, чтобы повторить';health.classList.add('warn');health.setAttribute('onclick','dashboardPage()')}
  ['heroStats','dashKpis','dashClients','dashBookings'].forEach(id=>{const x=document.getElementById(id);if(x&&/Загруз|Обновля|—/.test(x.textContent||''))x.innerHTML='<div class="muted">Данные временно недоступны</div>'});
 }
 patchBrand();
};
window.dashboardSearch=function(){const q=(document.querySelector('#dashSearch') as HTMLInputElement)?.value?.trim()||'';go('crm');setTimeout(()=>{const x=document.querySelector('#crmSearch') as HTMLInputElement;if(x){x.value=q;x.dispatchEvent(new Event('input',{bubbles:true}))}},120)};
const mo=new MutationObserver(()=>requestAnimationFrame(patchBrand));
mo.observe(document.documentElement,{childList:true,subtree:true});
window.addEventListener('DOMContentLoaded',()=>{patchBrand();setTimeout(patchBrand,80);setTimeout(patchBrand,400)});
setTimeout(patchBrand,50);
})();