(()=>{
'use strict';
const E=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const A=x=>Array.isArray(x)?x:Array.isArray(x?.items)?x.items:Array.isArray(x?.data)?x.data:[];
const SVG={
 menu:'<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
 bell:'<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>',
 search:'<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg>',
 clients:'<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2"/><path d="M3 19c.7-3.5 2.7-5.2 6-5.2s5.3 1.7 6 5.2M15 15c2.7.1 4.3 1.4 5 4"/></svg>',
 bookings:'<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/><path d="m9 15 2 2 4-4"/></svg>',
 catalog:'<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>',
 telegram:'<svg viewBox="0 0 24 24"><path d="m3 11 17-7-5.5 16-3.3-5.4L7 13l-4-2Z"/><path d="m11.2 14.6 4.5-5"/></svg>',
 available:'<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/><path d="m9 15 2 2 4-4"/></svg>'
};
const icon=k=>SVG[k]||'';
const d=v=>{try{return new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'short'}).format(new Date(v))}catch{return E(v||'')}};
function set(id,html){const x=document.getElementById(id);if(x)x.innerHTML=html}
async function u(path){const t=new Promise((_,r)=>setTimeout(()=>r(new Error('timeout')),9000));return Promise.race([window.call(path),t])}
async function o(path){if(!window.opsCall)return[];const t=new Promise((_,r)=>setTimeout(()=>r(new Error('timeout')),9000));return Promise.race([window.opsCall(path),t])}
function quick(page,label,key){return `<button class="home-quick-btn" onclick="go('${page}')"><span class="home-quick-icon">${icon(key)}</span><span>${label}</span></button>`}
function kpi(label,value,note,key){return `<article class="home-kpi"><div class="home-kpi-label">${label}</div><div class="home-kpi-value">${value}</div><div class="home-kpi-note">${note}</div><div class="home-kpi-icon">${icon(key)}</div></article>`}
async function load22(){
 const r=await Promise.allSettled([u('/crm'),o('/reservations'),u('/catalog'),u('/approvals')]);
 const clients=r[0].status==='fulfilled'?A(r[0].value):[];
 const bookings=r[1].status==='fulfilled'?A(r[1].value):[];
 const catalog=r[2].status==='fulfilled'?A(r[2].value):[];
 const approvals=r[3].status==='fulfilled'?A(r[3].value):[];
 const active=bookings.filter(x=>['requested','hold','confirmed','active'].includes(String(x.status||'').toLowerCase())).length;
 const items=catalog.filter(x=>!x.deleted_at);
 const available=items.filter(x=>String(x.status||'').toLowerCase()==='available').length;
 const checking=items.filter(x=>String(x.status||'').toLowerCase()==='checking').length;
 set('homeKpis',kpi('Клиенты',clients.length,'в CRM','clients')+kpi('Брони',active,'активные и предварительные','bookings')+kpi('Каталог',items.length,`${checking} требуют проверки`,'catalog')+kpi('Доступно',available,'подтверждено','available'));
 const dot=document.querySelector('.home-bell-dot');if(dot)dot.classList.toggle('on',approvals.length>0);
 if(r[0].status==='fulfilled'){
  const rows=clients.slice(0,2).map((x,i)=>`<button class="home-row" onclick="openClient('${x.id}')"><span class="home-row-dot"></span><span><b>${E(x.name||x.username||'Клиент')}</b><small>${E(x.last_message||x.need||x.summary||x.intent||'Без описания')}</small></span><span class="home-row-status ${x.priority==='HOT'?'hot':''}">${x.priority==='HOT'?'HOT':i===0?'NEW':''}</span></button>`).join('');
  set('homeClients',rows||'<div class="home-booking-empty">Обращений пока нет</div>');
 }else set('homeClients','<div class="home-booking-empty">Не удалось загрузить обращения</div>');
 if(r[1].status==='fulfilled'){
  const today=new Date().toISOString().slice(0,10);
  const rows=bookings.filter(x=>String(x.status||'').toLowerCase()!=='cancelled'&&(!x.end_date||x.end_date>=today)).sort((a,b)=>String(a.start_date||'').localeCompare(String(b.start_date||''))).slice(0,2);
  set('homeBookings',rows.map(x=>`<button class="home-row" onclick="go('bookings')"><span class="home-row-dot"></span><span><b>${E(x.pcs_catalog_items?.title||x.title||'Бронь')}</b><small>${d(x.start_date)} — ${d(x.end_date)}</small></span><span class="home-row-status">${E(String(x.status||'').toUpperCase())}</span></button>`).join('')||'<div class="home-booking-empty">Ближайших броней нет</div>');
 }else set('homeBookings','<div class="home-booking-empty">Не удалось загрузить брони</div>');
}
function render22(){
 if(!localStorage.pcsToken)return;
 document.body.classList.add('pcs-home-ref');
 if(window.PCS)window.PCS.page='dashboard';
 const root=document.getElementById('root');if(!root||typeof window.shell!=='function')return;
 root.innerHTML=window.shell();
 if(window.pcsInstallNav20)window.pcsInstallNav20();
 const m=document.getElementById('main');if(!m)return;
 m.innerHTML=`<div class="pcs-home-shell"><section class="pcs-home-cover"><div class="home-fade"></div><div class="home-topbar"><button class="home-icon-btn" aria-label="Меню" onclick="pcsHomeMenu22()">${icon('menu')}</button><button class="home-icon-btn" aria-label="Уведомления" onclick="go('approvals')">${icon('bell')}<i class="home-bell-dot"></i></button></div><div class="home-copy"><div class="home-script">PCS Concierge</div><h1 class="home-title">Управляйте<br>сервисом.<span>Не теряйте<br>клиента.</span></h1><p class="home-sub">Все инструменты в одном месте:<br>клиенты, брони, каталог, оплаты<br>и Telegram.</p></div><div class="home-search">${icon('search')}<input id="homeSearch22" placeholder="Найти клиента, бронь, запрос..."><button aria-label="Найти" onclick="pcsHomeSearch22()">${icon('search')}</button></div><div class="home-quick">${quick('crm','Клиенты','clients')}${quick('bookings','Брони','bookings')}${quick('catalog','Каталог','catalog')}${quick('connect','Telegram','telegram')}</div></section><section class="home-content"><div id="homeKpis" class="home-kpis">${kpi('Клиенты','…','в CRM','clients')}${kpi('Брони','…','активные и предварительные','bookings')}${kpi('Каталог','…','загрузка','catalog')}${kpi('Доступно','…','подтверждено','available')}</div><section class="home-panel"><div class="home-panel-head"><h2>Последние обращения</h2><button class="home-panel-link" onclick="go('inbox')">Все →</button></div><div id="homeClients" class="home-list"><div class="home-booking-empty">Загружаю…</div></div></section><section class="home-panel"><div class="home-panel-head"><h2>Ближайшие брони</h2><button class="home-panel-link" onclick="go('calendar')">Календарь →</button></div><div id="homeBookings" class="home-list"><div class="home-booking-empty">Загружаю…</div></div></section></section></div>`;
 load22().catch(()=>{});
}
window.pcsDashboard22=render22;
window.pcsHomeSearch22=function(){const q=(document.getElementById('homeSearch22')?.value||'').trim();window.go('crm');setTimeout(()=>{const s=document.getElementById('crmSearch');if(s){s.value=q;s.dispatchEvent(new Event('input',{bubbles:true}))}},50)};
window.pcsHomeMenu22=function(){if(typeof window.openSheet!=='function')return;window.openSheet('PCS Manager',`<div class="action-grid"><button class="btn soft" onclick="closeSheet();go('dashboard')">Главная</button><button class="btn blue" onclick="closeSheet();go('inbox')">Входящие</button><button class="btn sage" onclick="closeSheet();go('crm')">Клиенты</button><button class="btn soft" onclick="closeSheet();go('bookings')">Брони</button><button class="btn blue" onclick="closeSheet();go('catalog')">Каталог</button><button class="btn sage" onclick="closeSheet();go('calendar')">Календарь</button><button class="btn soft" onclick="closeSheet();go('finance')">Финансы</button><button class="btn blue" onclick="closeSheet();go('connect')">Telegram</button><button class="btn ghost" onclick="theme()">Светлая / тёмная тема</button></div>`)};
const prev=window.go;
window.go=function(page){if(page==='dashboard')return render22();document.body.classList.remove('pcs-home-ref');return prev(page)};
let tries=0;const boot=setInterval(()=>{tries++;if(!localStorage.pcsToken){if(tries>40)clearInterval(boot);return}const main=document.getElementById('main');if(main){render22();clearInterval(boot)}else if(tries>60)clearInterval(boot)},140);
})();