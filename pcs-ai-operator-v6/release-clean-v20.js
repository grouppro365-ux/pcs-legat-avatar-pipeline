(()=>{
'use strict';
const SVG={
 dashboard:'<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>',
 inbox:'<svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z"/><path d="M4 14h4l2 3h4l2-3h4"/></svg>',
 crm:'<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3.5 19c.6-3.4 2.4-5 5.5-5s4.9 1.6 5.5 5"/><path d="M16 5h5M16 9h5M16 13h5"/></svg>',
 bookings:'<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/><path d="m9 15 2 2 4-4"/></svg>',
 catalog:'<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>',
 calendar:'<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M8 3v4M16 3v4M3.5 10h17"/></svg>',
 finance:'<svg viewBox="0 0 24 24"><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/></svg>',
 connect:'<svg viewBox="0 0 24 24"><path d="M8 12a4 4 0 0 1 4-4h3"/><path d="M16 12a4 4 0 0 1-4 4H9"/><path d="M14 5h5v5M10 19H5v-5"/></svg>',
 more:'<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>'
};
const icon=(k)=>`<span class="nav-icon" aria-hidden="true">${SVG[k]||SVG.more}</span>`;
const esc20=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const arr=x=>Array.isArray(x)?x:Array.isArray(x?.items)?x.items:Array.isArray(x?.data)?x.data:[];
const money=(v,c='THB')=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(Number(v||0)||0)+' '+c;
const date=v=>{try{return new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'short'}).format(new Date(v))}catch{return String(v||'')}};

function installNav(){
 const side=document.querySelector('.side .nav'), bottom=document.querySelector('.bottom');
 const page=window.PCS?.page||'dashboard';
 if(side) side.innerHTML=[
  ['dashboard','Главная'],['inbox','Входящие'],['crm','CRM'],['bookings','Брони'],['catalog','Каталог'],['calendar','Календарь'],['finance','Финансы'],['connect','Подключения']
 ].map(([p,n])=>`<button class="${page===p?'on':''}" onclick="go('${p}')">${icon(p)}<span>${n}</span></button>`).join('')+
 `<button class="${['approvals','kb','errors','status'].includes(page)?'on':''}" onclick="moreMenu()">${icon('more')}<span>Ещё</span></button>`;
 if(bottom) bottom.innerHTML=[['dashboard','Главная'],['inbox','Входящие'],['bookings','Брони'],['catalog','Каталог']].map(([p,n])=>`<button class="${page===p?'on':''}" onclick="go('${p}')">${icon(p)}<span>${n}</span></button>`).join('')+`<button class="${['crm','calendar','finance','connect','approvals','kb','errors','status'].includes(page)?'on':''}" onclick="moreMenu()">${icon('more')}<span>Ещё</span></button>`;
}
window.pcsInstallNav20=installNav;
window.opsNav=installNav;

async function safeCall(kind,path){
 const timeout=new Promise((_,rej)=>setTimeout(()=>rej(new Error('Таймаут загрузки')),9000));
 if(kind==='ui') return Promise.race([window.call(path),timeout]);
 if(kind==='ops') return Promise.race([window.opsCall(path),timeout]);
 throw new Error('Неизвестный источник данных');
}
function retryBox(text,fn){return `<div class="release-load-error"><span>${esc20(text)}</span><button class="btn soft compact" onclick="${fn}">Повторить</button></div>`;}
function put(id,html){const el=document.getElementById(id);if(el)el.innerHTML=html;}
async function loadDashboard(){
 const results=await Promise.allSettled([
  safeCall('ui','/crm'), safeCall('ops','/reservations'), safeCall('ui','/catalog')
 ]);
 const clients=results[0].status==='fulfilled'?arr(results[0].value):[];
 const bookings=results[1].status==='fulfilled'?arr(results[1].value):[];
 const catalog=results[2].status==='fulfilled'?arr(results[2].value):[];
 const hot=clients.filter(x=>x.priority==='HOT').length;
 const active=bookings.filter(x=>['requested','hold','confirmed','active'].includes(x.status)).length;
 const available=catalog.filter(x=>!x.deleted_at&&x.status==='available').length;
 const checking=catalog.filter(x=>!x.deleted_at&&x.status==='checking').length;
 put('heroStats',`<div class="travel-hero-stat"><small>Горячие</small><b>${hot}</b></div><div class="travel-hero-stat"><small>Активные брони</small><b>${active}</b></div><div class="travel-hero-stat"><small>Доступно</small><b>${available}</b></div><div class="travel-hero-stat"><small>На проверке</small><b>${checking}</b></div>`);
 put('dashKpis',`<div class="travel-kpi"><span>Клиенты</span><b>${clients.length}</b><em>в CRM</em></div><div class="travel-kpi"><span>Брони</span><b>${active}</b><em>активные и предварительные</em></div><div class="travel-kpi"><span>Каталог</span><b>${catalog.filter(x=>!x.deleted_at).length}</b><em>${checking} требуют проверки</em></div><div class="travel-kpi"><span>Доступно</span><b>${available}</b><em>подтверждено</em></div>`);
 if(results[0].status==='fulfilled') put('dashClients',clients.slice(0,6).map(x=>`<button class="travel-mini-row" onclick="openClient('${x.id}')"><span class="travel-mini-dot"></span><span><b>${esc20(x.name||x.username||'Клиент')}</b><small>${esc20(x.need||x.summary||x.intent||'Без описания')}</small></span><strong>${esc20(x.priority==='HOT'?'HOT':x.status||'')}</strong></button>`).join('')||'<div class="muted">Обращений пока нет</div>');
 else put('dashClients',retryBox('Не удалось загрузить обращения','pcsDashboard20.refresh()'));
 if(results[1].status==='fulfilled'){
  const today=new Date().toISOString().slice(0,10);
  const rows=bookings.filter(x=>x.status!=='cancelled'&&(!x.end_date||x.end_date>=today)).sort((a,b)=>String(a.start_date||'').localeCompare(String(b.start_date||''))).slice(0,6);
  put('dashBookings',rows.map(x=>`<div class="travel-mini-row"><span class="travel-mini-dot"></span><span><b>${esc20(x.pcs_catalog_items?.title||x.title||'Бронь')}</b><small>${date(x.start_date)} — ${date(x.end_date)}</small></span><strong>${esc20(x.status||'')}</strong></div>`).join('')||'<div class="muted">Ближайших броней нет</div>');
 } else put('dashBookings',retryBox('Не удалось загрузить брони','pcsDashboard20.refresh()'));
}
function shortcut(p,n,k){return `<button class="travel-shortcut" onclick="go('${p}')"><span class="ico">${SVG[k||p]}</span><span>${n}</span></button>`;}
function dashboardPage(){
 if(window.PCS)window.PCS.page='dashboard';
 const root=document.querySelector('#root');
 if(root&&typeof window.shell==='function')root.innerHTML=window.shell();
 installNav();
 const m=document.querySelector('#main'); if(!m)return;
 m.innerHTML=`<div class="travel-dashboard"><section class="travel-hero"><div class="travel-hero-copy"><span class="pcs-script">Premium Concierge Service Thailand</span><h1>Управляйте сервисом.<br><span>Не теряйте клиента.</span></h1><p>Входящие, CRM, брони, каталог, оплаты и Telegram в одном кабинете.</p><div class="travel-search"><input id="dashSearch" placeholder="Найти клиента, запрос, город"><button aria-label="Найти" onclick="dashboardSearch20()">⌕</button></div></div><div class="travel-hero-side" id="heroStats"><div class="travel-hero-stat"><small>Загрузка</small><b>…</b></div></div></section><section class="travel-shortcuts">${shortcut('inbox','Входящие','inbox')}${shortcut('bookings','Брони','bookings')}${shortcut('catalog','Каталог','catalog')}${shortcut('calendar','Календарь','calendar')}${shortcut('finance','Финансы','finance')}${shortcut('connect','Telegram','connect')}</section><section id="dashKpis" class="travel-kpis"><div class="travel-kpi"><b>…</b></div></section><section class="travel-dashboard-grid"><div class="travel-panel"><div class="travel-panel-head"><h2>Последние обращения</h2><button onclick="go('inbox')">Все →</button></div><div id="dashClients" class="travel-mini-list"><div class="muted">Загружаю…</div></div></div><div class="travel-panel"><div class="travel-panel-head"><h2>Ближайшие брони</h2><button onclick="go('calendar')">Календарь →</button></div><div id="dashBookings" class="travel-mini-list"><div class="muted">Загружаю…</div></div></div></section></div>`;
 loadDashboard().catch(()=>{});
}
window.dashboardPage=dashboardPage;
window.pcsDashboard20={refresh:loadDashboard};
window.dashboardSearch20=function(){const q=(document.getElementById('dashSearch')?.value||'').trim();window.go('crm');setTimeout(()=>{const s=document.getElementById('crmSearch');if(s){s.value=q;s.dispatchEvent(new Event('input',{bubbles:true}));}},30)};

const previousGo=window.go;
window.go=function(p){
 if(p==='dashboard') return dashboardPage();
 const r=previousGo(p); setTimeout(installNav,0); return r;
};

let booted=false;
function promoteDashboard(){
 if(booted||!localStorage.pcsToken)return;
 const main=document.querySelector('#main');
 if(!main)return;
 booted=true;
 setTimeout(()=>{if(window.PCS?.page==='inbox')dashboardPage();},40);
}
window.addEventListener('DOMContentLoaded',()=>{installNav();let n=0;const t=setInterval(()=>{promoteDashboard();if(booted||++n>20)clearInterval(t)},150)});
})();