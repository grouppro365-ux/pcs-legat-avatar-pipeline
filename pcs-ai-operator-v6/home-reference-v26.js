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
const put=(id,html)=>{const el=document.getElementById(id);if(el)el.innerHTML=html};
const dt=v=>{try{return new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'short'}).format(new Date(v))}catch{return E(v||'')}};
async function ui(path){return window.call(path)}
async function ops(path){return typeof window.opsCall==='function'?window.opsCall(path):[]}
function q(page,label,key){return `<button type="button" onclick="go('${page}')"><span class="pcs-home26-qico">${icon(key)}</span><span>${label}</span></button>`}
function k(label,value,note,key){return `<article class="pcs-home26-kpi"><div class="pcs-home26-kl">${label}</div><div class="pcs-home26-kv">${value}</div><div class="pcs-home26-kn">${note}</div><div class="pcs-home26-ki">${icon(key)}</div></article>`}
async function loadHome26(){
 const r=await Promise.allSettled([ui('/crm'),ops('/reservations'),ui('/catalog'),ui('/approvals')]);
 const clients=r[0].status==='fulfilled'?A(r[0].value):[];
 const bookings=r[1].status==='fulfilled'?A(r[1].value):[];
 const catalog=r[2].status==='fulfilled'?A(r[2].value):[];
 const approvals=r[3].status==='fulfilled'?A(r[3].value):[];
 const active=bookings.filter(x=>['requested','hold','confirmed','active'].includes(String(x.status||'').toLowerCase())).length;
 const items=catalog.filter(x=>!x.deleted_at);
 const available=items.filter(x=>String(x.status||'').toLowerCase()==='available').length;
 const checking=items.filter(x=>String(x.status||'').toLowerCase()==='checking').length;
 put('home26Kpis',k('Клиенты',clients.length,'в CRM','clients')+k('Брони',active,'активные и предварительные','bookings')+k('Каталог',items.length,`${checking} требуют проверки`,'catalog')+k('Доступно',available,'подтверждено','available'));
 const badge=document.querySelector('.pcs-home26-badge');if(badge)badge.classList.toggle('on',approvals.length>0);
 if(r[0].status==='fulfilled'){
  const rows=clients.slice(0,2).map((x,i)=>`<button class="pcs-home26-row" type="button" onclick="openClient('${x.id}')"><span class="pcs-home26-dot"></span><span><b>${E(x.name||x.username||'Клиент')}</b><small>${E(x.last_message||x.need||x.summary||x.intent||'Без описания')}</small></span><span class="pcs-home26-status ${x.priority==='HOT'?'hot':''}">${x.priority==='HOT'?'HOT':i===1?'NEW':''}</span></button>`).join('');
  put('home26Clients',rows||'<div class="pcs-home26-empty">Обращений пока нет</div>');
 }else put('home26Clients','<div class="pcs-home26-empty">Не удалось загрузить обращения</div>');
 if(r[1].status==='fulfilled'){
  const today=new Date().toISOString().slice(0,10);
  const rows=bookings.filter(x=>String(x.status||'').toLowerCase()!=='cancelled'&&(!x.end_date||x.end_date>=today)).sort((a,b)=>String(a.start_date||'').localeCompare(String(b.start_date||''))).slice(0,2);
  put('home26Bookings',rows.map(x=>`<button class="pcs-home26-row" type="button" onclick="go('bookings')"><span class="pcs-home26-dot"></span><span><b>${E(x.pcs_catalog_items?.title||x.title||'Бронь')}</b><small>${dt(x.start_date)} — ${dt(x.end_date)}</small></span><span class="pcs-home26-status">${E(String(x.status||'').toUpperCase())}</span></button>`).join('')||'<div class="pcs-home26-empty">Ближайших броней нет</div>');
 }else put('home26Bookings','<div class="pcs-home26-empty">Не удалось загрузить брони</div>');
}
function renderHome26(){
 if(!localStorage.pcsToken)return;
 document.body.classList.remove('pcs-home-exact','pcs-home-ref');
 document.body.classList.add('pcs-home-ref','pcs-home-v26');
 if(window.PCS)window.PCS.page='dashboard';
 const root=document.getElementById('root');if(!root||typeof window.shell!=='function')return;
 root.innerHTML=window.shell();
 if(typeof window.pcsInstallNav20==='function')window.pcsInstallNav20();
 const m=document.getElementById('main');if(!m)return;
 m.innerHTML=`<div class="pcs-home26"><section class="pcs-home26-hero"><div class="pcs-home26-scene" aria-hidden="true"></div><div class="pcs-home26-top"><button class="pcs-home26-icon" type="button" aria-label="Меню" onclick="pcsHome26Menu()">${icon('menu')}</button><button class="pcs-home26-icon" type="button" aria-label="Уведомления" onclick="go('approvals')">${icon('bell')}<i class="pcs-home26-badge"></i></button></div><div class="pcs-home26-copy"><div class="pcs-home26-script">PCS Concierge</div><h1 class="pcs-home26-title">Управляйте<br>сервисом.<span>Не теряйте<br>клиента.</span></h1><p class="pcs-home26-sub">Все инструменты в одном месте:<br>клиенты, брони, каталог, оплаты<br>и Telegram.</p></div><div class="pcs-home26-search">${icon('search')}<input id="home26Search" placeholder="Найти клиента, бронь, запрос..."><button type="button" aria-label="Найти" onclick="pcsHome26Search()">${icon('search')}</button></div><div class="pcs-home26-quick">${q('crm','Клиенты','clients')}${q('bookings','Брони','bookings')}${q('catalog','Каталог','catalog')}${q('connect','Telegram','telegram')}</div></section><section class="pcs-home26-content"><div id="home26Kpis" class="pcs-home26-kpis">${k('Клиенты','…','в CRM','clients')}${k('Брони','…','активные и предварительные','bookings')}${k('Каталог','…','загрузка','catalog')}${k('Доступно','…','подтверждено','available')}</div><section class="pcs-home26-panel"><div class="pcs-home26-panel-head"><h2>Последние обращения</h2><button type="button" onclick="go('inbox')">Все →</button></div><div id="home26Clients" class="pcs-home26-list"><div class="pcs-home26-empty">Загружаю…</div></div></section><section class="pcs-home26-panel"><div class="pcs-home26-panel-head"><h2>Ближайшие брони</h2><button type="button" onclick="go('calendar')">Календарь →</button></div><div id="home26Bookings" class="pcs-home26-list"><div class="pcs-home26-empty">Загружаю…</div></div></section></section></div>`;
 loadHome26().catch(()=>{});
}
window.pcsHome26=renderHome26;
window.pcsHome26Search=function(){const q=(document.getElementById('home26Search')?.value||'').trim();window.go('crm');setTimeout(()=>{const s=document.getElementById('crmSearch');if(s){s.value=q;s.dispatchEvent(new Event('input',{bubbles:true}))}},50)};
window.pcsHome26Menu=function(){if(typeof window.openSheet!=='function')return;window.openSheet('PCS Manager',`<div class="action-grid"><button class="btn soft" onclick="closeSheet();go('dashboard')">Главная</button><button class="btn blue" onclick="closeSheet();go('inbox')">Входящие</button><button class="btn sage" onclick="closeSheet();go('crm')">Клиенты</button><button class="btn soft" onclick="closeSheet();go('bookings')">Брони</button><button class="btn blue" onclick="closeSheet();go('catalog')">Каталог</button><button class="btn sage" onclick="closeSheet();go('calendar')">Календарь</button><button class="btn soft" onclick="closeSheet();go('finance')">Финансы</button><button class="btn blue" onclick="closeSheet();go('connect')">Telegram</button><button class="btn ghost" onclick="theme();closeSheet();setTimeout(pcsHome26,0)">Светлая / тёмная тема</button></div>`)};
const previousGo=window.go;
window.go=function(page){
 if(page==='dashboard')return renderHome26();
 document.body.classList.remove('pcs-home-v26','pcs-home-ref');
 return previousGo(page);
};
let attempts=0;const t=setInterval(()=>{
 attempts++;
 if(!localStorage.pcsToken){if(attempts>40)clearInterval(t);return}
 const main=document.getElementById('main');
 if(main){renderHome26();clearInterval(t)}else if(attempts>80)clearInterval(t);
},120);
})();
