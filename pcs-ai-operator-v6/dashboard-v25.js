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

const actionTime=value=>{if(!value)return 'Срок не указан';const normalized=/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)?value.replace(' ','T')+'Z':value;const date=new Date(normalized);return Number.isFinite(date.getTime())?date.toLocaleString('ru-RU'):'Проверьте срок';};
const actionRow=x=>`<button class="pcs25-row" data-dashboard-contact="${E(x.id)}" style="width:100%;min-height:48px;text-align:left"><span style="min-width:0;overflow-wrap:anywhere"><b>${E(x.name||x.username||'Клиент')}</b><small>${E(x.next_action||'Следующее действие не описано')}</small><small>Срок: ${E(actionTime(x.next_action_at))}</small></span></button>`;
let dueState=null;
async function loadDueActions(s){
 const active=()=>dueState===s&&document.getElementById('pcsDueActionsList')===s.root;
 if(!active())return;const seq=++s.sequence,page=s.page;s.root.textContent='Загружаю действия…';
 const prev=document.getElementById('pcsDueActionsPrev'),next=document.getElementById('pcsDueActionsNext');prev.disabled=true;next.disabled=true;
 try{const d=await ui('/due-actions?'+new URLSearchParams({page}));if(!active()||seq!==s.sequence)return;
  if(d.page!==page||!Array.isArray(d.rows))throw Error('Некорректный ответ списка действий');
  s.root.innerHTML=d.rows.map(actionRow).join('')||'<p class="muted">Клиентов с наступившим сроком действия нет.</p>';
  prev.disabled=page===0;next.disabled=!d.truncated||page>=5000;
  document.getElementById('pcsDueActionsPage').textContent=`Страница ${page+1}`;
 }catch(e){if(active()&&seq===s.sequence)s.root.textContent=e.message||'Не удалось загрузить действия';}
}
window.pcsDueActions={open(){
 window.openSheet('Клиенты: пора продолжить',`<p class="muted">Наступил срок следующего действия. Откройте карточку клиента, чтобы продолжить работу.</p><button class="btn soft" id="pcsDueActionsRefresh">Обновить</button><div id="pcsDueActionsList" class="list" aria-live="polite"></div><div class="toolbar"><button class="btn soft" id="pcsDueActionsPrev" disabled>Назад</button><span id="pcsDueActionsPage">Страница 1</span><button class="btn soft" id="pcsDueActionsNext" disabled>Далее</button></div>`);
 const s=dueState={root:document.getElementById('pcsDueActionsList'),page:0,sequence:0};
 s.root.onclick=e=>{const id=e.target.closest?.('[data-dashboard-contact]')?.dataset.dashboardContact;if(id&&/^[A-Za-z0-9_-]{1,100}$/.test(id)&&typeof window.openClient==='function'){window.closeSheet();window.openClient(id)}};
 document.getElementById('pcsDueActionsRefresh').onclick=()=>loadDueActions(s);
 document.getElementById('pcsDueActionsPrev').onclick=()=>{s.page=Math.max(0,s.page-1);loadDueActions(s)};
 document.getElementById('pcsDueActionsNext').onclick=()=>{s.page++;loadDueActions(s)};
 return loadDueActions(s);
}};
let dashboardSequence=0;
async function loadDashboard(scope){
 const current=()=>scope.sequence===dashboardSequence&&window.PCS?.page==='dashboard'&&document.getElementById('main')===scope.main;
 let d;try{d=await ui('/dashboard');if(!current())return;if(!d?.sections)throw Error('Некорректный ответ главной панели')}catch(e){if(current())for(const id of ['pcs25Kpis','pcs25Clients','pcs25Bookings','pcs25Attention'])put(id,`<div class="pcs25-empty">${E(e.message||'Не удалось загрузить панель')}</div>`);return;}
 const crm=d.sections.crm?.data,biz=d.sections.business?.data,runtime=d.sections.runtime?.data;
 const num=x=>Number.isSafeInteger(x)&&x>=0?String(x):'—';
 put('pcs25Kpis',kpi('Клиенты',num(crm?.contacts),crm?'в CRM':'источник недоступен','clients')+kpi('Брони',num(biz?.active_bookings),biz?'активные и предварительные':'источник недоступен','bookings')+kpi('Каталог',num(biz?.catalog),biz?`${num(biz.catalog_review)} требуют проверки`:'источник недоступен','catalog')+kpi('Доступно',num(biz?.available),'по статусу карточек','available'));
 const count=[crm?.approvals,crm?.delivery_unknown,biz?.unread_notifications,runtime?.unresolved_jobs].filter(x=>Number.isSafeInteger(x)&&x>0).reduce((a,b)=>a+b,0);
 const bell=document.querySelector('.pcs25-bell-dot');if(bell)bell.classList.toggle('on',Number.isFinite(count)&&count>0);
 if(crm)put('pcs25Clients',(crm.clients||[]).map(x=>`<button class="pcs25-row" data-dashboard-contact="${E(x.id)}"><span class="pcs25-dot"></span><span><b>${E(x.name||x.username||'Клиент')}</b><small>${E(x.need||'Без описания')}</small></span><span class="pcs25-status">${E(x.priority==='HOT'?'HOT':'')}</span></button>`).join('')||'<div class="pcs25-empty">Обращений пока нет</div>');
 else put('pcs25Clients',`<div class="pcs25-empty">${E(d.sections.crm?.error||'CRM недоступна')}</div>`);
 if(biz)put('pcs25Bookings',(biz.bookings||[]).map(x=>`<button class="pcs25-row" data-dashboard-page="bookings"><span class="pcs25-dot"></span><span><b>${E(x.title||x.public_id||'Бронь')}</b><small>${E(x.public_id||'')}</small></span><span class="pcs25-status">${E(x.operational_status)}</span></button>`).join('')||'<div class="pcs25-empty">Активных броней нет</div>');
 else put('pcs25Bookings',`<div class="pcs25-empty">${E(d.sections.business?.error||'Заявки недоступны')}</div>`);
 const blocks=[];
 if(crm){blocks.push(`<p>Открытые задачи: ${num(crm.tasks?.open)} · Просрочены: ${num(crm.tasks?.overdue)} · Без срока: ${num(crm.tasks?.undated)}</p>`);
  if(crm.tasks?.overdue>0)blocks.push('<button class="btn soft" data-dashboard-tasks>Открыть задачи</button>');
  for(const x of crm.attention_tasks||[])blocks.push(`<button class="pcs25-row" data-dashboard-contact="${E(x.contact_id)}"><span><b>${E(x.title)}</b><small>${E(x.contact_name||'Клиент')} · ${E(x.assignee||'Без ответственного')}</small></span><span class="pcs25-status">Просрочено</span></button>`);
  if(crm.approvals>0)blocks.push(`<button class="btn soft" data-dashboard-page="approvals">Ответы на согласовании: ${num(crm.approvals)}</button>`);
  if(crm.delivery_unknown>0)blocks.push(`<button class="btn soft" data-dashboard-page="errors">Неизвестная доставка: ${num(crm.delivery_unknown)}</button>`);
  if(crm.due_actions>0){blocks.push(`<button class="btn soft" data-dashboard-due-actions>Пора продолжить с клиентами: ${num(crm.due_actions)}</button>`);for(const x of crm.attention_contacts||[])blocks.push(actionRow(x));}
 }
 if(biz){blocks.push(`<p>Заявки с просроченным SLA: ${num(biz.sla_overdue)} · Требуют решения: ${num(biz.human_review)} · Проблемы исполнения: ${num(biz.execution_issues)}</p>`);
  for(const x of biz.attention_applications||[])blocks.push(`<button class="pcs25-row" data-dashboard-application="${E(x.id)}"><span><b>${E(x.public_id||'Заявка')}</b><small>${E(x.client_name||'Клиент')} · ${E(x.operational_status)}</small></span><span class="pcs25-status">Требует внимания</span></button>`);
  blocks.push(`<button class="btn soft" data-dashboard-notifications>Непрочитанные события: ${num(biz.unread_notifications)}</button>`);
 }
 if(runtime)blocks.push(`<button class="btn soft" data-dashboard-page="errors">Неразрешённые ошибки: ${num(runtime.unresolved_jobs)}</button>`);
 for(const name of ['crm','business','runtime'])if(d.sections[name]?.error)blocks.push(`<p class="muted">${E(d.sections[name].error)}</p>`);
 put('pcs25Attention',blocks.join('')||'<div class="pcs25-empty">Данные недоступны</div>');
 const attention=document.getElementById('pcs25Attention');if(attention)attention.onclick=e=>{
  const b=e.target.closest?.('button');if(!b)return;
  if(b.hasAttribute('data-dashboard-due-actions'))window.pcsDueActions.open();
  if(b.hasAttribute('data-dashboard-tasks'))window.pcsTaskQueue?.open();
  if(b.hasAttribute('data-dashboard-notifications'))window.pcsNotifications?.open();
  const id=b.dataset.dashboardApplication;if(id&&/^[0-9a-f-]{36}$/i.test(id))window.pcsOpenOperationalApplication?.(id);
 };
 for(const id of ['pcs25Clients','pcs25Bookings','pcs25Attention']){const el=document.getElementById(id);if(el)el.addEventListener('click',e=>{
  const b=e.target.closest?.('button');if(!b)return;const cid=b.dataset.dashboardContact;
  if(cid&&/^[A-Za-z0-9_-]{1,100}$/.test(cid)&&typeof window.openClient==='function')window.openClient(cid);
  if(['bookings','approvals','errors'].includes(b.dataset.dashboardPage))window.go(b.dataset.dashboardPage);
 });}
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
 main.innerHTML=`<div class="pcs25"><section class="pcs25-hero"><div class="pcs25-photo" aria-hidden="true"></div><div class="pcs25-top"><button class="pcs25-icon" aria-label="Меню" onclick="pcs25Menu()">${rawIcon('menu')}</button><button class="pcs25-icon" aria-label="Уведомления" onclick="pcsNotifications.open()">${rawIcon('bell')}<i class="pcs25-bell-dot"></i></button></div><div class="pcs25-copy"><div class="pcs25-script">PCS Concierge</div><h1 class="pcs25-title">Управляйте<br> сервисом.<span>Не теряйте<br> клиента.</span></h1><p class="pcs25-sub">Все инструменты в одном месте:<br>клиенты, брони, каталог, оплаты<br>и Telegram.</p></div><div class="pcs25-search">${rawIcon('search')}<input id="pcs25Search" placeholder="Найти клиента, бронь, запрос..."><button aria-label="Найти" onclick="pcs25Search()">${rawIcon('search')}</button></div><div class="pcs25-quick">${quick('crm','Клиенты','clients')}${quick('bookings','Брони','bookings')}${quick('catalog','Каталог','catalog')}${quick('connect','Telegram','telegram')}</div></section><section class="pcs25-content"><div id="pcs25Kpis" class="pcs25-kpis">${kpi('Клиенты','…','в CRM','clients')}${kpi('Брони','…','активные и предварительные','bookings')}${kpi('Каталог','…','загрузка','catalog')}${kpi('Доступно','…','подтверждено','available')}</div><section class="pcs25-panel"><div class="pcs25-panel-head"><h2>Последние обращения</h2><button onclick="go('inbox')">Все →</button></div><div id="pcs25Clients" class="pcs25-list"><div class="pcs25-empty">Загружаю…</div></div></section><section class="pcs25-panel"><div class="pcs25-panel-head"><h2>Активные брони</h2><button onclick="go('calendar')">Календарь →</button></div><div id="pcs25Bookings" class="pcs25-list"><div class="pcs25-empty">Загружаю…</div></div></section><section class="pcs25-panel"><div class="pcs25-panel-head"><h2>Сегодня PCS</h2><button onclick="go('dashboard')">Обновить</button></div><div id="pcs25Attention" class="pcs25-list" aria-live="polite">Загружаю…</div></section></section></div>`;
 loadDashboard({sequence:++dashboardSequence,main}).catch(()=>{});
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
