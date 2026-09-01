(()=>{
'use strict';
const LOGO='./pcs-mark.svg';
const BRAND='Premium Concierge Service Thailand';
function apply(){
 document.title='PCS — '+BRAND;
 document.querySelectorAll('.logo').forEach(el=>{let img=el.querySelector('img');if(!img){img=document.createElement('img');el.replaceChildren(img)}img.src=LOGO;img.alt='PCS PREMIUM Concierge Service';img.decoding='async'});
 document.querySelectorAll('.brand').forEach(el=>{el.textContent=BRAND});
 document.querySelectorAll('.loginbox .title').forEach(el=>{el.textContent=BRAND});
 document.querySelectorAll('.loginbox .eyebrow').forEach(el=>{el.textContent='Рабочая панель PCS'});
}
let raf=0;new MutationObserver(()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(apply)}).observe(document.documentElement,{childList:true,subtree:true});
document.addEventListener('DOMContentLoaded',apply);setTimeout(apply,0);
window.pcsBrand26=apply;
})();