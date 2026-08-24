(()=>{
  const API='https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-ui-api';
  const OPS='https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-ops-api';
  const FIN='https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-ui-api-v9';
  const esc=window.esc||((s='')=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])));
  const arr=x=>Array.isArray(x)?x:Array.isArray(x?.data)?x.data:Array.isArray(x?.items)?x.items:Array.isArray(x?.reservations)?x.reservations:[];
  const timeoutMs=7000;
  function headers(json=true){const h=json?{'content-type':'application/json'}:{};const t=localStorage.pcsToken||'';if(t)h.authorization='Bearer '+t;return h;}
  async function fetchJson(url,opt={},label='запрос'){
    const c=new AbortController();const tm=setTimeout(()=>c.abort(),timeoutMs);
    try{
      const r=await fetch(url,{...opt,signal:c.signal,cache:'no-store'});
      let d={};try{d=await r.json()}catch{}
      if(r.status===401){localStorage.removeItem('pcsToken');throw new Error('Сессия истекла. Войдите заново.');}
      if(!r.ok)throw new Error(d.error||`${label}: HTTP ${r.status}`);
      return d;
    }catch(e){if(e?.name==='AbortError')throw new Error(`${label}: таймаут`);throw e;}
    finally{clearTimeout(tm)}
  }
  async function hotCall(path,opt={}){return fetchJson(API+path,{...opt,headers:{...headers(true),...(opt.headers||{})}},path)}
  async function hotOps(path){return fetchJson(OPS+path,{headers:headers(false)},path)}
  async function hotFin(path){return fetchJson(FIN+path,{headers:headers(false)},path)}
  window.call=hotCall;
  window.hotfixLoadingV21=true;

  function sectionError(msg, retry="go('dashboard')"){return `<div class="empty"><b>Не загрузилось</b><p>${esc(msg)}</p><button class="btn ghost" onclick="${retry}">Повторить</button><button class="btn ghost" onclick="localStorage.removeItem('pcsToken');location.reload()">Войти заново</button></div>`}
  function kpi(label,val,sub=''){return `<div class="travel-kpi"><div class="travel-kpi-head"><span>${esc(label)}</span></div><b>${esc(val)}</b><em>${esc(sub)}</em></div>`}

  window.dashboardPage=async function(){
    if(typeof window.opsNav==='function')window.opsNav();
    const m=document.querySelector('#main');if(!m)return;
    m.innerHTML=`<div class="travel-dashboard">
      <section class="travel-hero"><div class="travel-hero-copy"><span class="pcs-script">Premium Concierge Thailand</span><h1>Главная</h1><p>Входящие, брони, каталог и финансы. Данные грузятся независимо.</p></div><div class="travel-hero-side" id="heroStats"><div class="travel-hero-stat"><small>WebView</small><b>OK</b></div></div></section>
      <section class="travel-shortcuts"><button class="travel-shortcut" onclick="go('inbox')"><span>Входящие</span></button><button class="travel-shortcut" onclick="go('bookings')"><span>Брони</span></button><button class="travel-shortcut" onclick="go('catalog')"><span>Каталог</span></button><button class="travel-shortcut" onclick="go('connect')"><span>Telegram</span></button></section>
      <section id="dashKpis" class="travel-kpis">${kpi('Клиенты','…','загрузка')}${kpi('Брони','…','загрузка')}${kpi('Каталог','…','загрузка')}${kpi('Финансы','…','загрузка')}</section>
      <section class="travel-dashboard-grid"><div class="travel-panel"><div class="travel-panel-head"><h2>Последние обращения</h2><button onclick="go('inbox')">Все →</button></div><div id="dashClients" class="travel-mini-list"><div class="muted">Загрузка…</div></div></div><div class="travel-panel"><div class="travel-panel-head"><h2>Ближайшие брони</h2><button onclick="go('calendar')">Календарь →</button></div><div id="dashBookings" class="travel-mini-list"><div class="muted">Загрузка…</div></div></div></section>
    </div>`;
    const kpis=document.querySelector('#dashKpis');
    hotCall('/crm').then(d=>{
      const rows=arr(d);window.PCS&&(window.PCS.crm=rows);
      const hot=rows.filter(x=>x.priority==='HOT').length, waiting=rows.filter(x=>x.status==='WAITING_CLIENT').length;
      if(kpis)kpis.children[0].outerHTML=kpi('Клиенты',rows.length,`${waiting} ждут · ${hot} HOT`);
      const box=document.querySelector('#dashClients');if(box)box.innerHTML=rows.slice(0,6).map(x=>`<button class="travel-mini-row" onclick="openClient('${x.id}')"><span><b>${esc(x.name||x.username||'Клиент')}</b><small>${esc(x.need||x.summary||x.intent||'Без описания')}</small></span><strong>${esc(x.priority==='HOT'?'HOT':x.status||'')}</strong></button>`).join('')||'<div class="muted">Обращений нет</div>';
    }).catch(e=>{const box=document.querySelector('#dashClients');if(box)box.innerHTML=sectionError(e.message);if(kpis)kpis.children[0].outerHTML=kpi('Клиенты','ошибка',e.message)});
    hotOps('/reservations').then(d=>{
      const rows=arr(d);const active=rows.filter(x=>['requested','hold','confirmed','active'].includes(x.status)).length;
      if(kpis)kpis.children[1].outerHTML=kpi('Брони',active,'активные');
      const box=document.querySelector('#dashBookings');if(box)box.innerHTML=rows.slice(0,6).map(x=>`<div class="travel-mini-row"><span><b>${esc(x.pcs_catalog_items?.title||'Бронь')}</b><small>${esc(x.start_date||'')} → ${esc(x.end_date||'')}</small></span><strong>${esc(x.status||'')}</strong></div>`).join('')||'<div class="muted">Броней нет</div>';
    }).catch(e=>{const box=document.querySelector('#dashBookings');if(box)box.innerHTML=sectionError(e.message);if(kpis)kpis.children[1].outerHTML=kpi('Брони','ошибка',e.message)});
    hotCall('/catalog').then(d=>{const rows=arr(d);window.PCS&&(window.PCS.catalog=rows);const visible=rows.filter(x=>!x.deleted_at&&x.customer_visible!==false).length, checking=rows.filter(x=>!x.deleted_at&&x.status==='checking').length;if(kpis)kpis.children[2].outerHTML=kpi('Каталог',visible,`${checking} на проверке`)}).catch(e=>{if(kpis)kpis.children[2].outerHTML=kpi('Каталог','ошибка',e.message)});
    hotFin('/finance').then(d=>{const rows=arr(d);const paid=rows.filter(x=>x.status==='paid'&&x.entry_type==='income').reduce((s,x)=>s+Number(x.amount||0),0);if(kpis)kpis.children[3].outerHTML=kpi('Финансы',Math.round(paid)+' THB','оплачено')}).catch(e=>{if(kpis)kpis.children[3].outerHTML=kpi('Финансы','ошибка',e.message)});
  };

  window.inbox=async function(){
    const m=document.querySelector('#main');if(!m)return;
    const header=typeof window.header==='function'?window.header('Telegram для бизнеса','Входящие','Реальные обращения клиентов и следующий шаг.'):`<div class="eyebrow">TELEGRAM ДЛЯ БИЗНЕСА</div><h1 class="title">Входящие</h1><p class="sub">Реальные обращения клиентов и следующий шаг.</p>`;
    m.innerHTML=header+`<div id="inboxList" class="list"><div class="muted">Загрузка…</div></div>`;
    const box=document.querySelector('#inboxList');
    try{const rows=arr(await hotCall('/crm')).slice(0,80);box.innerHTML=rows.map(c=>`<button class="client-row" onclick="openClient('${c.id}')"><b>${esc(c.name||c.username||c.telegram_chat_id||'Клиент')}</b><span>${esc(c.need||c.summary||c.last_message||'')}</span><div class="pills"><span class="pill">${esc(c.status||'NEW')}</span>${c.priority==='HOT'?'<span class="pill warn">HOT</span>':''}${c.intent?`<span class="pill">${esc(c.intent)}</span>`:''}</div></button>`).join('')||'<div class="empty">Пока нет обращений</div>'}
    catch(e){box.innerHTML=sectionError(e.message,"go('inbox')")}
  };
})();
