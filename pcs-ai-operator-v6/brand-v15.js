(()=>{
  const LOGO='https://cdn.jsdelivr.net/gh/grouppro365-ux/pcs-legat-avatar-pipeline@main/pcs-ai-operator-v6/pcs-mark.svg?v=20260824-30';
  const BRAND='Premium Concierge Service Thailand';
  function apply(){
    document.title=BRAND;
    document.querySelectorAll('.logo').forEach(el=>{
      let img=el.querySelector('img');
      if(!img){img=document.createElement('img');el.replaceChildren(img)}
      if(img.getAttribute('src')!==LOGO)img.src=LOGO;
      img.alt=BRAND;img.decoding='async';
    });
    document.querySelectorAll('.brand').forEach(el=>{if(el.textContent!==BRAND)el.textContent=BRAND});
    document.querySelectorAll('.loginbox .title').forEach(el=>{if(el.textContent!==BRAND)el.textContent=BRAND});
    document.querySelectorAll('.loginbox .eyebrow').forEach(el=>{if(el.textContent!=='ИИ-оператор и CRM')el.textContent='ИИ-оператор и CRM'});
  }
  let raf=0;
  new MutationObserver(()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(apply)}).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',apply);
  setTimeout(apply,0);
})();
