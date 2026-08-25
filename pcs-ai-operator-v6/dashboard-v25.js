(()=>{
'use strict';
const A=x=>Array.isArray(x)?x:Array.isArray(x?.items)?x.items:Array.isArray(x?.data)?x.data:[];
const E=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const SVG={
 dashboard:'<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>',
 inbox:'<svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z"/><path d="M4 14h4l2 3h4l2-3h4"/></svg>',
 bookings:'<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/><path d="m9 15 2 2 4-4"/></svg>',
 catalog:'<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>',
 more:'<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>',
 menu:'<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
 bell:'<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>',
 search:'<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg>',
 clients:'<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2"/><path d="M3 19c.7-3.5 2.7-5.2 6-5.2s5.3 1.7 6 5.2M15 15c2.7.1 4.3 1.4 5 4"/></svg>',
 telegram:'<svg viewBox="0 0 24 24"><path d="m3 11 17-7-5.5 16-3.3-5.4L7 13l-4-2Z"/><path d="m11.2 14.6 4.5-5"/></svg>',
 available:'<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/><path d="m9 15 2 2 4-4"/></svg>'
};
const icon=k=>`<span class="nav-icon" aria-hidden="true">${SVG[k]||SVG.more}</span>`;
const rawIcon=k=>SVG[k]||'';
const dt=v=>{try{return new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'short'}).format(new Date(v))}catch{return E(v||'')}};
const put=(id,html)=>{const el=document.getElementById(id);if(el)el.innerHTML=html};
async function withTimeout(p,ms=9000){return Promise.race([p,new Promise((_,r)=>setTimeout(()=>r(new Error('timeout')),ms))])}
async function ui(path){return withTimeout(window.call(path))}
async function ops(path){if(typeof window.opsCall!=='function')return[];return withTimeout(window.opsCall(path))}

function installNav(){
 const page=window.PCS?.page||'dashboard';
 const side=document.querySelector('.side .nav');
 const bottom=document.querySelector('.bottom');
 const desktop=[['dashboard','Главная'],['inbox','Входящие'],['crm','Клиенты'],['bookings','Брони'],['catalog','Каталог'],['calendar','Календарь'],['finance','Финансы'],['connect','Telegram']];
 if(side)side.innerHTML=desktop.map(([p,n])=>`<button class="${page===p?'on':''}" onclick="go('${p}')">${icon(p==='crm'?'clients':p)}<span>${n}</span></button>`).join('')+`<button onclick="moreMenu()">${icon('more')}<span>Ещё</span></button>`;
 if(bottom)bottom.innerHTML=[['dashboard','Главная'],['inbox','Входящие'],['bookings','Брони'],['catalog','Каталог']].map(([p,n])=>`<button class="${page===p?'on':''}" onclick="go('${p}')">${icon(p)}<span>${n}</span></button>`).join('')+`<button onclick="moreMenu()">${icon('more')}<span>Ещё</span></button>`;
}
window.pcsInstallNav25=installNav;

function quick(page,label,key){return `<button onclick="go('${page}')"><span class="pcs25-qicon">${rawIcon(key)}</span><span>${label}</span></button>`}
function kpi(label,value,note,key){return `<article class="pcs25-kpi"><div class="pcs25-kpi-label">${label}</div><div class="pcs25-kpi-value">${value}</div><div class="pcs25-kpi-note">${note}</div><div class="pcs25-kpi-icon">${rawIcon(key)}</div></article>`}

async function loadDashboard(){
 const r=await Promise.allSettled([ui('/crm'),ops('/reservations'),ui('/catalog'),ui('/approvals')]);
 const clients=r[0].status==='fulfilled'?A(r[0].value):[];
 const bookings=r[1].status==='fulfilled'?A(r[1].value):[];
 const catalog=r[2].status==='fulfilled'?A(r[2].value):[];
 const approvals=r[3].status==='fulfilled'?A(r[3].value):[];
 const active=bookings.filter(x=>['requested','hold','confirmed','active'].includes(String(x.status||'').toLowerCase())).length;
 const items=catalog.filter(x=>!x.deleted_at);
 const available=items.filter(x=>String(x.status||'').toLowerCase()==='available').length;
 const checking=items.filter(x=>String(x.status||'').toLowerCase()==='checking').length;
 put('pcs25Kpis',kpi('Клиенты',clients.length,'в CRM','clients')+kpi('Брони',active,'активные и предварительные','bookings')+kpi('Каталог',items.length,`${checking} требуют проверки`,'catalog')+kpi('Доступно',available,'подтверждено','available'));
 const bell=document.querySelector('.pcs25-bell-dot');if(bell)bell.classList.toggle('on',approvals.length>0);
 if(r[0].status==='fulfilled'){
  put('pcs25Clients',clients.slice(0,2).map((x,i)=>`<button class="pcs25-row" onclick="openClient('${x.id}')"><span class="pcs25-dot"></span><span><b>${E(x.name||x.username||'Клиент')}</b><small>${E(x.last_message||x.need||x.summary||x.intent||'Без описания')}</small></span><span class="pcs25-status ${x.priority==='HOT'?'hot':''}">${x.priority==='HOT'?'HOT':i===1?'NEW':''}</span></button>`).join('')||'<div class="pcs25-empty">Обращений пока нет</div>');
 } else put('pcs25Clients','<div class="pcs25-empty">Не удалось загрузить обращения</div>');
 if(r[1].status==='fulfilled'){
  const today=new Date().toISOString().slice(0,10);
  const rows=bookings.filter(x=>String(x.status||'').toLowerCase()!=='cancelled'&&(!x.end_date||x.end_date>=today)).sort((a,b)=>String(a.start_date||'').localeCompare(String(b.start_date||''))).slice(0,2);
  put('pcs25Bookings',rows.map(x=>`<button class="pcs25-row" onclick="go('bookings')"><span class="pcs25-dot"></span><span><b>${E(x.pcs_catalog_items?.title||x.title||'Бронь')}</b><small>${dt(x.start_date)} — ${dt(x.end_date)}</small></span><span class="pcs25-status">${E(String(x.status||'').toUpperCase())}</span></button>`).join('')||'<div class="pcs25-empty">Ближайших броней нет</div>');
 } else put('pcs25Bookings','<div class="pcs25-empty">Не удалось загрузить брони</div>');
}

function renderDashboard(){
 if(!localStorage.pcsToken)return;
 document.body.classList.remove('pcs-home-ref','pcs-home-exact');
 document.body.classList.add('pcs-dashboard-v25','pcs-home-ref');
 if(window.PCS)window.PCS.page='dashboard';
 const root=document.getElementById('root');if(!root||typeof window.shell!=='function')return;
 root.innerHTML=window.shell();
 installNav();
 const main=document.getElementById('main');if(!main)return;
 main.innerHTML=`<div class="pcs25"><section class="pcs25-hero"><div class="pcs25-photo" aria-hidden="true"></div><div class="pcs25-top"><button class="pcs25-icon" aria-label="Меню" onclick="pcs25Menu()">${rawIcon('menu')}</button><button class="pcs25-icon" aria-label="Уведомления" onclick="go('approvals')">${rawIcon('bell')}<i class="pcs25-bell-dot"></i></button></div><div class="pcs25-copy"><div class="pcs25-script">PCS Concierge</div><h1 class="pcs25-title">Управляйте<br>сервисом.<span>Не теряйте<br>клиента.</span></h1><p class="pcs25-sub">Все инструменты в одном месте:<br>клиенты, брони, каталог, оплаты<br>и Telegram.</p></div><div class="pcs25-search">${rawIcon('search')}<input id="pcs25Search" placeholder="Найти клиента, бронь, запрос..."><button aria-label="Найти" onclick="pcs25Search()">${rawIcon('search')}</button></div><div class="pcs25-quick">${quick('crm','Клиенты','clients')}${quick('bookings','Брони','bookings')}${quick('catalog','Каталог','catalog')}${quick('connect','Telegram','telegram')}</div></section><section class="pcs25-content"><div id="pcs25Kpis" class="pcs25-kpis">${kpi('Клиенты','…','в CRM','clients')}${kpi('Брони','…','активные и предварительные','bookings')}${kpi('Каталог','…','загрузка','catalog')}${kpi('Доступно','…','подтверждено','available')}</div><section class="pcs25-panel"><div class="pcs25-panel-head"><h2>Последние обращения</h2><button onclick="go('inbox')">Все →</button></div><div id="pcs25Clients" class="pcs25-list"><div class="pcs25-empty">Загружаю…</div></div></section><section class="pcs25-panel"><div class="pcs25-panel-head"><h2>Ближайшие брони</h2><button onclick="go('calendar')">Календарь →</button></div><div id="pcs25Bookings" class="pcs25-list"><div class="pcs25-empty">Загружаю…</div></div></section></section></div>`;
 loadDashboard().catch(()=>{});
}
window.pcsDashboard25=renderDashboard;
window.pcs25Search=function(){const q=(document.getElementById('pcs25Search')?.value||'').trim();window.go('crm');setTimeout(()=>{const s=document.getElementById('crmSearch');if(s){s.value=q;s.dispatchEvent(new Event('input',{bubbles:true}))}},40)};
window.pcs25Menu=function(){if(typeof window.openSheet!=='function')return;window.openSheet('PCS Manager',`<div class="action-grid"><button class="btn soft" onclick="closeSheet();go('dashboard')">Главная</button><button class="btn blue" onclick="closeSheet();go('inbox')">Входящие</button><button class="btn sage" onclick="closeSheet();go('crm')">Клиенты</button><button class="btn soft" onclick="closeSheet();go('bookings')">Брони</button><button class="btn blue" onclick="closeSheet();go('catalog')">Каталог</button><button class="btn sage" onclick="closeSheet();go('calendar')">Календарь</button><button class="btn soft" onclick="closeSheet();go('finance')">Финансы</button><button class="btn blue" onclick="closeSheet();go('connect')">Telegram</button><button class="btn ghost" onclick="theme()">Светлая / тёмная тема</button></div>`)};

const previousGo=window.go;
window.go=function(page){
 if(page==='dashboard')return renderDashboard();
 document.body.classList.remove('pcs-dashboard-v25','pcs-home-ref','pcs-home-exact');
 const result=previousGo(page);
 setTimeout(installNav,0);
 return result;
};

let attempts=0;const boot=setInterval(()=>{attempts++;if(!localStorage.pcsToken){if(attempts>40)clearInterval(boot);return}if(document.getElementById('main')){renderDashboard();clearInterval(boot)}else if(attempts>60)clearInterval(boot)},120);
})();
