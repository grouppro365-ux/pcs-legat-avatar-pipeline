(()=>{'use strict';
const VISUAL=['pcs-home-v1','pcs-home-v2','pcs-home-ref','pcs-home-exact','pcs-dashboard-v25','pcs-inbox-v25','pcs-calendar-v25','pcs-approved-page','pcs-secondary-v2'];
const ROUTES=new Set(['dashboard','inbox','crm','bookings','catalog','calendar','finance','approvals','kb','connect','status','errors']);
function top(){try{window.scrollTo({top:0,left:0,behavior:'auto'})}catch{window.scrollTo(0,0)}}
function clean(keep=''){for(const c of VISUAL)if(c!==keep)document.body.classList.remove(c);document.body.classList.add('pcs-system-ready')}
function pageClass(){if(document.querySelector('.pcs-h2-screen'))return'pcs-home-v2';if(document.querySelector('.in25'))return'pcs-inbox-v25';if(document.querySelector('.cal25'))return'pcs-calendar-v25';if(document.querySelector('.pcs-ap-screen'))return'pcs-approved-page';if(document.querySelector('.pcs-sp-screen'))return'pcs-secondary-v2';return''}
function normalize(){const k=pageClass();clean(k);if(k)document.body.classList.add(k);document.documentElement.style.overflowX='hidden';document.body.style.overflowX='hidden';const sh=document.getElementById('sheet');if(sh&&!sh.classList.contains('on'))sh.style.pointerEvents='none';document.querySelectorAll('.bottom svg,.nav-icon svg,.pcs-sp-navbtn svg').forEach(s=>{s.style.width='20px';s.style.height='20px';s.style.maxWidth='20px';s.style.maxHeight='20px'});}
const prevGo=window.go;
if(typeof prevGo==='function')window.go=function(p){if(ROUTES.has(p)){clean();top()}const r=prevGo(p);const done=()=>{top();normalize()};if(r&&typeof r.then==='function')r.finally(()=>setTimeout(done,0));else{setTimeout(done,0);setTimeout(normalize,120)}return r};
const prevTab=window.bookingTab;if(typeof prevTab==='function')window.bookingTab=function(t){clean();top();const r=prevTab(t);const done=()=>{top();normalize()};if(r&&typeof r.then==='function')r.finally(()=>setTimeout(done,0));else setTimeout(done,0);return r};
const obs=new MutationObserver(()=>{clearTimeout(window.__pcsNormT);window.__pcsNormT=setTimeout(normalize,20)});const root=document.getElementById('root');if(root)obs.observe(root,{subtree:true,childList:true});
window.addEventListener('resize',normalize,{passive:true});window.addEventListener('orientationchange',()=>setTimeout(normalize,120),{passive:true});
setTimeout(()=>{document.body.classList.add('pcs-system-ready');normalize()},0);
})();
