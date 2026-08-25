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
const dt=v=>{try{return new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'short'}).format(new Date(v))}catch{return E(v||'')}};
function set(id,html){const el=document.getElementById(id);if(el)el.innerHTML=html}
async function ui(path){const t=new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),9000));return Promise.race([window.call(path),t])}
async function ops(path){if(!window.opsCall)return[];const t=new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),9000));return Promise.race([window.opsCall(path),t])}
function quick(page,label,key){return `<button onclick="go('${page}')"><span class="qico">${icon(key)}</span><span>${label}</span></button>`}
function kpi(label,value,note,key){return `<article class="home-exact-kpi"><div class="kl">${label}</div><div class="kv">${value}</div><div class="kn">${note}</div><div class="ki">${icon(key)}</div></article>`}
async function loadExact(){
 const r=await Promise.allSettled([ui('/crm'),ops('/reservations'),ui('/catalog'),ui('/approvals')]);
 const clients=r[0].status==='fulfilled'?A(r[0].value):[];
 const bookings=r[1].status==='fulfilled'?A(r[1].value):[];
 const catalog=r[2].status==='fulfilled'?A(r[2].value):[];
 const approvals=r[3].status==='fulfilled'?A(r[3].value):[];
 const active=bookings.filter(x=>['requested','hold','confirmed','active'].includes(String(x.status||'').toLowerCase())).length;
 const items=catalog.filter(x=>!x.deleted_at);
 const available=items.filter(x=>String(x.status||'').toLowerCase()==='available').length;
 const checking=items.filter(x=>String(x.status||'').toLowerCase()==='checking').length;
 set('exactKpis',kpi('Клиенты',clients.length,'в CRM','clients')+kpi('Брони',active,'активные и предварительные','bookings')+kpi('Каталог',items.length,`${checking} требуют проверки`,'catalog')+kpi('Доступно',available,'подтверждено','available'));
 const dot=document.querySelector('.home-exact-bell-dot');if(dot)dot.classList.toggle('on',approvals.length>0);
 if(r[0].status==='fulfilled'){
  const rows=clients.slice(0,2).map((x,i)=>`<button class="home-exact-row" onclick="openClient('${x.id}')"><span class="home-exact-dot"></span><span><b>${E(x.name||x.username||'Клиент')}</b><small>${E(x.last_message||x.need||x.summary||x.intent||'Без описания')}</small></span><span class="home-exact-status ${x.priority==='HOT'?'hot':''}">${x.priority==='HOT'?'HOT':i===1?'NEW':''}</span></button>`).join('');
  set('exactClients',rows||'<div class="home-exact-empty">Обращений пока нет</div>');
 }else set('exactClients','<div class="home-exact-empty">Не удалось загрузить обращения</div>');
 if(r[1].status==='fulfilled'){
  const today=new Date().toISOString().slice(0,10);
  const rows=bookings.filter(x=>String(x.status||'').toLowerCase()!=='cancelled'&&(!x.end_date||x.end_date>=today)).sort((a,b)=>String(a.start_date||'').localeCompare(String(b.start_date||''))).slice(0,2);
  set('exactBookings',rows.map(x=>`<button class="home-exact-row" onclick="go('bookings')"><span class="home-exact-dot"></span><span><b>${E(x.pcs_catalog_items?.title||x.title||'Бронь')}</b><small>${dt(x.start_date)} — ${dt(x.end_date)}</small></span><span class="home-exact-status">${E(String(x.status||'').toUpperCase())}</span></button>`).join('')||'<div class="home-exact-empty">Ближайших броней нет</div>');
 }else set('exactBookings','<div class="home-exact-empty">Не удалось загрузить брони</div>');
}
function renderExact(){
 if(!localStorage.pcsToken)return;
 document.body.classList.remove('pcs-home-ref');
 document.body.classList.add('pcs-home-exact');
 if(window.PCS)window.PCS.page='dashboard';
 const root=document.getElementById('root');if(!root||typeof window.shell!=='function')return;
 root.innerHTML=window.shell();
 if(window.pcsInstallNav20)window.pcsInstallNav20();
 const m=document.getElementById('main');if(!m)return;
 m.innerHTML=`<div class="pcs-exact-shell"><section class="pcs-exact-hero"><div class="home-photo-layer" aria-hidden="true"></div><div class="home-exact-top"><button class="home-exact-icon" aria-label="Меню" onclick="pcsExactMenu23()">${icon('menu')}</button><button class="home-exact-icon" aria-label="Уведомления" onclick="go('approvals')">${icon('bell')}<i class="home-exact-bell-dot"></i></button></div><div class="home-exact-copy"><div class="home-exact-script">PCS Concierge</div><h1 class="home-exact-title">Управляйте<br>сервисом.<span>Не теряйте<br>клиента.</span></h1><p class="home-exact-sub">Все инструменты в одном месте:<br>клиенты, брони, каталог, оплаты<br>и Telegram.</p></div><div class="home-exact-search">${icon('search')}<input id="exactSearch23" placeholder="Найти клиента, бронь, запрос..."><button aria-label="Найти" onclick="pcsExactSearch23()">${icon('search')}</button></div><div class="home-exact-quick">${quick('crm','Клиенты','clients')}${quick('bookings','Брони','bookings')}${quick('catalog','Каталог','catalog')}${quick('connect','Telegram','telegram')}</div></section><section class="home-exact-content"><div id="exactKpis" class="home-exact-kpis">${kpi('Клиенты','…','в CRM','clients')}${kpi('Брони','…','активные и предварительные','bookings')}${kpi('Каталог','…','загрузка','catalog')}${kpi('Доступно','…','подтверждено','available')}</div><section class="home-exact-panel"><div class="home-exact-panel-head"><h2>Последние обращения</h2><button onclick="go('inbox')">Все →</button></div><div id="exactClients" class="home-exact-list"><div class="home-exact-empty">Загружаю…</div></div></section><section class="home-exact-panel"><div class="home-exact-panel-head"><h2>Ближайшие брони</h2><button onclick="go('calendar')">Календарь →</button></div><div id="exactBookings" class="home-exact-list"><div class="home-exact-empty">Загружаю…</div></div></section></section></div>`;
 loadExact().catch(()=>{});
}
window.pcsDashboard23=renderExact;
window.pcsExactSearch23=function(){const q=(document.getElementById('exactSearch23')?.value||'').trim();window.go('crm');setTimeout(()=>{const s=document.getElementById('crmSearch');if(s){s.value=q;s.dispatchEvent(new Event('input',{bubbles:true}))}},50)};
window.pcsExactMenu23=function(){if(typeof window.openSheet!=='function')return;window.openSheet('PCS Manager',`<div class="action-grid"><button class="btn soft" onclick="closeSheet();go('dashboard')">Главная</button><button class="btn blue" onclick="closeSheet();go('inbox')">Входящие</button><button class="btn sage" onclick="closeSheet();go('crm')">Клиенты</button><button class="btn soft" onclick="closeSheet();go('bookings')">Брони</button><button class="btn blue" onclick="closeSheet();go('catalog')">Каталог</button><button class="btn sage" onclick="closeSheet();go('calendar')">Календарь</button><button class="btn soft" onclick="closeSheet();go('finance')">Финансы</button><button class="btn blue" onclick="closeSheet();go('connect')">Telegram</button><button class="btn ghost" onclick="theme()">Светлая / тёмная тема</button></div>`)};
const previousGo=window.go;
window.go=function(page){if(page==='dashboard')return renderExact();document.body.classList.remove('pcs-home-exact','pcs-home-ref');return previousGo(page)};
let tries=0;const timer=setInterval(()=>{tries++;if(!localStorage.pcsToken){if(tries>40)clearInterval(timer);return}const main=document.getElementById('main');if(main){renderExact();clearInterval(timer)}else if(tries>60)clearInterval(timer)},140);
})();
