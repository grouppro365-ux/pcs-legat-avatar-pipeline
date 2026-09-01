(()=>{
'use strict';
const pageClasses=['pcs-dashboard-v25','pcs-home-ref','pcs-home-exact','pcs-inbox-v25','pcs-calendar-v25','pcs-connect-v25'];
if(localStorage.pcsDesignVersion!=='26'){localStorage.pcsTheme='light';localStorage.pcsDesignVersion='26'}
document.documentElement.dataset.theme=localStorage.pcsTheme||'light';document.body.classList.add('pcs-v26');
const fallback=window.go;
function clean(page){pageClasses.forEach(c=>document.body.classList.remove(c));document.body.classList.add('pcs-v26');document.body.dataset.pcsPage=page||'';if(window.PCS)window.PCS.page=page}
function navLater(){setTimeout(()=>{if(typeof window.pcsInstallNav25==='function')window.pcsInstallNav25();if(typeof window.pcsBrand26==='function')window.pcsBrand26()},0)}
window.go=function(page){
 clean(page);
 if(page==='dashboard'&&typeof window.pcsDashboard25==='function')return window.pcsDashboard25();
 if(page==='inbox'&&typeof window.pcsInbox25==='function')return window.pcsInbox25();
 if(page==='calendar'&&typeof window.pcsCalendar25==='function')return window.pcsCalendar25();
 if(page==='connect'&&typeof window.pcsConnections25==='function')return window.pcsConnections25();
 if(page==='kb'&&typeof window.pcsKnowledge26==='function')return window.pcsKnowledge26();
 if(page==='finance'&&typeof window.pcsFinance26==='function')return window.pcsFinance26();
 const r=typeof fallback==='function'?fallback(page):undefined;navLater();return r;
};
window.moreMenu=function(){if(typeof window.openSheet!=='function')return;window.openSheet('Ещё',`<div class="v26-more"><button class="lav" onclick="closeSheet();go('crm')">Клиенты</button><button class="blue" onclick="closeSheet();go('approvals')">Требуют ответа</button><button class="sage" onclick="closeSheet();go('kb')">База знаний</button><button class="butter" onclick="closeSheet();go('calendar')">Календарь</button><button class="peach" onclick="closeSheet();go('finance')">Финансы</button><button class="lav" onclick="closeSheet();go('connect')">Подключения</button><button class="ghost" onclick="closeSheet();go('errors')">Ошибки и повторы</button><button class="ghost" onclick="closeSheet();go('status')">Состояние системы</button><button class="danger" onclick="logout()">Выйти</button></div>`)};
function boot(){document.body.classList.add('pcs-v26');if(typeof window.pcsBrand26==='function')window.pcsBrand26();if(localStorage.pcsToken&&typeof window.pcsDashboard25==='function'){setTimeout(()=>{const main=document.getElementById('main');if(main&&(!window.PCS?.page||window.PCS.page==='inbox'))window.go('dashboard')},450)}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
window.__PCS_ROUTER_V26__=true;
})();
