(()=>{
  const BRAND='Premium Concierge Service Thailand';
  const LOGO='https://cdn.jsdelivr.net/gh/grouppro365-ux/pcs-legat-avatar-pipeline@main/pcs-ai-operator-v6/pcs-mark.svg?v=20260824-28';
  function applyBrand(){
    document.title=BRAND;
    document.querySelectorAll('.logo').forEach(el=>{
      let img=el.querySelector('img');
      if(!img){img=document.createElement('img');el.replaceChildren(img)}
      if(img.getAttribute('src')!==LOGO) img.src=LOGO;
      img.alt=BRAND;
      img.decoding='async';
    });
    document.querySelectorAll('.brand').forEach(el=>{if(el.textContent!==BRAND)el.textContent=BRAND});
    document.querySelectorAll('.travel-hero .pcs-script').forEach(el=>{if(el.textContent!==BRAND)el.textContent=BRAND});
    document.querySelectorAll('.loginbox .eyebrow').forEach(el=>el.textContent='ИИ-оператор и CRM');
    document.querySelectorAll('.loginbox .title').forEach(el=>el.textContent=BRAND);
  }
  function fixDashboard(){
    const dash=document.querySelector('.travel-dashboard');
    if(!dash)return;
    dash.dataset.mobileV16='1';
    const side=document.querySelector('.travel-hero-side');
    if(side){side.style.removeProperty('width');side.querySelectorAll('.travel-hero-stat').forEach(x=>x.style.removeProperty('width'))}
    const shortcuts=document.querySelector('.travel-shortcuts');
    if(shortcuts) shortcuts.setAttribute('aria-label','Быстрые действия');
    const kpis=document.querySelector('.travel-kpis');
    if(kpis) kpis.setAttribute('aria-label','Ключевые показатели');
  }
  function apply(){applyBrand();fixDashboard()}
  let raf=0;
  new MutationObserver(()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(apply)}).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',apply);
  window.addEventListener('resize',apply,{passive:true});
  setTimeout(apply,0);setTimeout(apply,700);setTimeout(apply,2200);
})();
