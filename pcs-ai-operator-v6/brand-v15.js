(()=>{
  const LOGO='./pcs-ai-operator-v6/pcs-mark.svg?v=20260827-21';
  const BRAND='Premium Concierge Service Thailand';
  function apply(){
    document.title=BRAND;
    document.querySelectorAll('.logo').forEach(el=>{
      let img=el.querySelector('img');
      if(!img){img=document.createElement('img');el.replaceChildren(img)}
      if(img.getAttribute('src')!==LOGO)img.src=LOGO;
      img.alt=BRAND;img.decoding='async';
    });
    document.querySelectorAll('.brand').forEach(el=>{el.textContent='';el.setAttribute('aria-hidden','true')});
    document.querySelectorAll('.loginbox .title').forEach(el=>{el.textContent='Панель PCS'});
    document.querySelectorAll('.loginbox .eyebrow').forEach(el=>{el.textContent=BRAND});
  }
  let raf=0;new MutationObserver(()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(apply)}).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',apply);setTimeout(apply,0);
})();
