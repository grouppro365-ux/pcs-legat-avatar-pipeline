(()=>{
  const API='https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-ui-api';
  const esc=window.esc||((s='')=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])));
  const timeoutMs=9000;
  async function hotCall(path,opt={}){
    const c=new AbortController();
    const t=setTimeout(()=>c.abort(),timeoutMs);
    try{
      const h={'content-type':'application/json',...(opt.headers||{})};
      const token=localStorage.pcsToken||'';
      if(token)h.authorization='Bearer '+token;
      const r=await fetch(API+path,{...opt,headers:h,signal:c.signal,cache:'no-store'});
      let d={};try{d=await r.json()}catch{}
      if(r.status===401){localStorage.removeItem('pcsToken');throw new Error('Сессия истекла. Закройте Mini App и войдите заново.');}
      if(!r.ok)throw new Error(d.error||('HTTP '+r.status));
      return d;
    }catch(e){
      if(e?.name==='AbortError')throw new Error('Запрос завис. Перезагрузите Mini App; backend уже отвечает, Telegram держит старый WebView.');
      throw e;
    }finally{clearTimeout(t)}
  }
  window.call=hotCall;
  window.hotfixLoadingV21=true;
  window.inbox=async function(){
    const m=document.querySelector('#main');
    if(!m)return;
    const header=typeof window.header==='function'?window.header('Telegram для бизнеса','Входящие','Реальные обращения клиентов и следующий шаг.'):`<div class="eyebrow">TELEGRAM ДЛЯ БИЗНЕСА</div><h1 class="title">Входящие</h1><p class="sub">Реальные обращения клиентов и следующий шаг.</p>`;
    m.innerHTML=header+`<div id="inboxList" class="list"><div class="muted">Загрузка…</div></div>`;
    const box=document.querySelector('#inboxList');
    try{
      const d=await hotCall('/crm');
      const rows=(Array.isArray(d)?d:[]).slice(0,80);
      box.innerHTML=rows.map(c=>`<button class="client-row" onclick="openClient('${c.id}')"><b>${esc(c.name||c.username||c.telegram_chat_id||'Клиент')}</b><span>${esc(c.need||c.summary||c.last_message||'')}</span><div class="pills"><span class="pill">${esc(c.status||'NEW')}</span>${c.priority==='HOT'?'<span class="pill warn">HOT</span>':''}${c.intent?`<span class="pill">${esc(c.intent)}</span>`:''}</div></button>`).join('')||'<div class="empty">Пока нет обращений</div>';
    }catch(e){
      box.innerHTML=`<div class="empty"><b>Не удалось загрузить входящие</b><p>${esc(e.message||e)}</p><button class="btn" onclick="go('inbox')">Повторить</button><button class="btn ghost" onclick="localStorage.removeItem('pcsToken');location.reload()">Войти заново</button></div>`;
    }
  };
})();
