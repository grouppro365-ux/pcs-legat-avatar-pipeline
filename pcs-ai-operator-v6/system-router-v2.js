(()=>{'use strict';
const legacyGo=window.go;
const legacyBookingTab=window.bookingTab;
const VISUAL=['pcs-home-v1','pcs-home-v2','pcs-home-ref','pcs-home-exact','pcs-dashboard-v25','pcs-inbox-v25','pcs-inbox-chat-open','pcs-calendar-v25','pcs-approved-page','pcs-secondary-v2'];
const secondary=new Set(['approvals','kb','connect','status','errors']);
const top=()=>{try{window.scrollTo({top:0,left:0,behavior:'auto'})}catch{window.scrollTo(0,0)}};
function clearVisual(){for(const c of VISUAL)document.body.classList.remove(c);document.body.classList.add('pcs-system-ready')}
function settle(){top();if(typeof window.pcsInstallNav25==='function')window.pcsInstallNav25();document.documentElement.style.overflowX='hidden';document.body.style.overflowX='hidden'}
function finish(r){if(r&&typeof r.then==='function'){return r.finally(()=>setTimeout(settle,0))}setTimeout(settle,0);return r}
function prepareBase(page){clearVisual();if(window.PCS)window.PCS.page=page;const root=document.getElementById('root');if(root&&typeof window.shell==='function')root.innerHTML=window.shell();if(typeof window.opsNav==='function')window.opsNav()}
function baseBookings(){prepareBase('bookings');try{if(typeof OPS!=='undefined')OPS.tab='reservations'}catch{}return typeof window.bookingsPage==='function'?window.bookingsPage():legacyGo('bookings')}
function baseRoute(page,fn){prepareBase(page);return typeof fn==='function'?fn():legacyGo(page)}
function dispatch(page){const p=String(page||'');clearVisual();top();let r;
 if(p==='dashboard'&&typeof window.pcsHomeV2==='function')r=window.pcsHomeV2();
 else if(p==='inbox'&&typeof window.pcsInbox25==='function')r=window.pcsInbox25();
 else if(p==='calendar'&&typeof window.pcsCalendar25==='function')r=window.pcsCalendar25();
 else if(p==='crm'&&window.pcsApprovedPages?.clients)r=window.pcsApprovedPages.clients();
 else if(p==='catalog'&&window.pcsApprovedPages?.catalog)r=window.pcsApprovedPages.catalog();
 else if(p==='finance'&&window.pcsApprovedPages?.finance)r=window.pcsApprovedPages.finance();
 else if(p==='bookings')r=baseBookings();
 else if(secondary.has(p))r=legacyGo(p);
 else r=legacyGo(p);
 return finish(r)
}
window.go=dispatch;
window.bookingTab=function(tab){const t=String(tab||'reservations');clearVisual();top();let r;
 if(t==='extras'&&window.pcsApprovedPages?.extras)r=window.pcsApprovedPages.extras();
 else if(t==='pricing'&&window.pcsApprovedPages?.tariffs)r=window.pcsApprovedPages.tariffs('directions');
 else {try{if(typeof OPS!=='undefined')OPS.tab='reservations'}catch{}r=baseBookings()}
 return finish(r)
};
window.pcsApBookingsBase=()=>window.go('bookings');
const oldOpen=window.openClient;
if(typeof oldOpen==='function')window.pcsOpenClientSystem=oldOpen;
window.addEventListener('pageshow',settle,{passive:true});
setTimeout(settle,0);
})();