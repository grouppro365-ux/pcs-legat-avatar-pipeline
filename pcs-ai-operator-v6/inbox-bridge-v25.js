(()=>{
'use strict';
window.pcsOpenInboxContact25=function(id){
 window.__pcsInboxPendingContact=String(id||'');
 window.go('inbox');
 let n=0;const t=setInterval(()=>{n++;if(typeof window.pcsInboxOpen25==='function'&&window.__pcsInboxPendingContact){const v=window.__pcsInboxPendingContact;window.__pcsInboxPendingContact='';window.pcsInboxOpen25(v);clearInterval(t)}else if(n>25)clearInterval(t)},80);
};
})();
