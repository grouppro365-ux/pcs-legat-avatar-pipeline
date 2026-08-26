(()=>{
'use strict';
const LOGIN_URL='https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-api/login';
window.doLogin=async function(){
  const pw=document.querySelector('#pw');
  const err=document.querySelector('#err');
  const btn=[...document.querySelectorAll('button')].find(b=>/войти/i.test(b.textContent||''));
  if(err)err.textContent='';
  const password=String(pw?.value||'');
  if(!password){if(err)err.textContent='Введите пароль';return;}
  if(btn)btn.disabled=true;
  const c=new AbortController();
  const t=setTimeout(()=>c.abort(),20000);
  try{
    const r=await fetch(LOGIN_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password}),signal:c.signal,cache:'no-store'});
    let d={};
    try{d=await r.json()}catch{}
    if(!r.ok)throw new Error(d?.error||`Ошибка входа (${r.status})`);
    if(!d?.token)throw new Error('Сервер не вернул сессию');
    localStorage.pcsToken=d.token;
    location.reload();
  }catch(e){
    const msg=e?.name==='AbortError'?'Сервер входа не ответил вовремя':(e?.message||'Не удалось войти');
    if(err)err.textContent=msg;
  }finally{
    clearTimeout(t);
    if(btn)btn.disabled=false;
  }
};
})();
