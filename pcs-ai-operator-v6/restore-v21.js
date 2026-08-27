(()=>{
  const navIcon=(k)=>({home:'⌂',inbox:'✉',bookings:'▣',catalog:'▦',more:'•••'}[k]||'•');
  const safeGo=p=>{try{return window.go?.(p)}catch(e){console.error(e)}};
  function openBookingTab(tab){safeGo('bookings');setTimeout(()=>{try{window.bookingTab?.(tab)}catch{}},80)}
  window.pcsOpenExtras=()=>openBookingTab('extras');
  window.pcsOpenPricing=()=>openBookingTab('pricing');
  function bottom(){
    const b=document.querySelector('.bottom'); if(!b)return;
    const p=window.PCS?.page||'dashboard';
    b.innerHTML=[
      ['dashboard','Главная',()=>safeGo('dashboard')],
      ['inbox','Входящие',()=>safeGo('inbox')],
      ['bookings','Брони',()=>safeGo('bookings')],
      ['catalog','Каталог',()=>safeGo('catalog')],
      ['more','Ещё',()=>window.moreMenu?.()]
    ].map(([id,label])=>`<button data-v21-nav="${id}" class="${p===id||(id==='more'&&['crm','calendar','finance','kb','connect','approvals','errors','status'].includes(p))?'on':''}"><i>${navIcon(id)}</i><span>${label}</span></button>`).join('');
    [...b.querySelectorAll('[data-v21-nav]')].forEach((el,i)=>el.onclick=[()=>safeGo('dashboard'),()=>safeGo('inbox'),()=>safeGo('bookings'),()=>safeGo('catalog'),()=>window.moreMenu?.()][i]);
  }
  window.moreMenu=()=>{
    if(!window.openSheet)return;
    openSheet('Ещё',`<div class="more-grid v21-more">
      <button class="btn soft" onclick="closeSheet();go('crm')">Клиенты</button>
      <button class="btn soft" onclick="closeSheet();pcsOpenExtras()">Допуслуги</button>
      <button class="btn soft" onclick="closeSheet();pcsOpenPricing()">Тарифы</button>
      <button class="btn soft" onclick="closeSheet();pcsOpenPricing()">Сезоны</button>
      <button class="btn soft" onclick="closeSheet();go('calendar')">Календарь</button>
      <button class="btn soft" onclick="closeSheet();go('finance')">Финансы</button>
      <button class="btn sage" onclick="closeSheet();go('kb')">База знаний</button>
      <button class="btn blue" onclick="closeSheet();go('approvals')">Требуют ответа</button>
      <button class="btn soft" onclick="closeSheet();go('connect')">Telegram и подключения</button>
      <button class="btn ghost" onclick="closeSheet();go('errors')">Ошибки и повторы</button>
      <button class="btn ghost" onclick="closeSheet();go('status')">Состояние системы</button>
      <button class="btn danger" onclick="logout()">Выйти</button>
    </div>`)
  };
  function cleanBrand(){
    document.title='Premium Concierge Service Thailand';
    document.querySelectorAll('.brand').forEach(x=>x.remove());
    document.querySelectorAll('.loginbox .eyebrow').forEach(x=>{x.textContent='Premium Concierge Service Thailand'});
    document.querySelectorAll('.loginbox .title').forEach(x=>{if(/AI|ИИ|Operator|Оператор/i.test(x.textContent||''))x.textContent='Панель PCS'});
    document.querySelectorAll('h1,h2,h3,p,span,small,button').forEach(x=>{
      if(x.childElementCount)return;
      const t=(x.textContent||'').trim();
      if(t==='ИИ-оператор'||t==='AI Operator'||t==='Оператор PCS')x.textContent='';
    });
  }
  function patchMobile(){
    bottom();cleanBrand();
    const tg=window.Telegram?.WebApp;
    if(tg){try{tg.ready();tg.expand();tg.setHeaderColor(getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()||'#f4f8f9');tg.setBackgroundColor(getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()||'#f4f8f9')}catch{}}
  }
  let raf=0;new MutationObserver(()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(patchMobile)}).observe(document.documentElement,{subtree:true,childList:true});
  document.addEventListener('DOMContentLoaded',patchMobile);setTimeout(patchMobile,80);setTimeout(patchMobile,600);
})();
