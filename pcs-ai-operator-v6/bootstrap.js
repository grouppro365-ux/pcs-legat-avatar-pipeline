(()=>{
  const start=async()=>{
    try{
      if(typeof window.boot==='function'){
        await window.boot();
        return;
      }
      if(typeof boot==='function'){
        await boot();
        return;
      }
      const root=document.querySelector('#root');
      if(root) root.innerHTML='<div style="padding:24px;font:16px system-ui;color:#252830">Ошибка запуска интерфейса. Обновите страницу.</div>';
      console.error('PCS bootstrap: boot() is not available');
    }catch(error){
      console.error('PCS bootstrap failed',error);
      const root=document.querySelector('#root');
      if(root) root.innerHTML='<div style="padding:24px;font:16px system-ui;color:#252830">Не удалось запустить PCS AI Operator. Обновите страницу.</div>';
    }
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
