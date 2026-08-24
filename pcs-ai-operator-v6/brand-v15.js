(()=>{
  const LOGO='https://raw.githubusercontent.com/grouppro365-ux/pcs-legat-avatar-pipeline/main/pcs-ai-operator-v6/pcs-mark.svg?v=20260824-26';
  const BRAND='Premium Concierge Service Thailand';
  function apply(){
    document.title=BRAND;
    document.querySelectorAll('.logo').forEach(el=>{
      let img=el.querySelector('img');
      if(!img){img=document.createElement('img');el.replaceChildren(img)}
      img.src=LOGO;img.alt=BRAND;img.decoding='async';
    });
    document.querySelectorAll('.brand').forEach(el=>{el.textContent=BRAND});
    document.querySelectorAll('.loginbox .title').forEach(el=>{if(/PCS|AI Operator/i.test(el.textContent||''))el.textContent=BRAND});
    document.querySelectorAll('.loginbox .eyebrow').forEach(el=>{el.textContent='ИИ-оператор и CRM'});
  }
  let raf=0;
  new MutationObserver(()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(apply)}).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',apply);
  setTimeout(apply,0);
})();
