(()=>{
'use strict';
function bind(){if(typeof window.pcsInstallNav25==='function'){window.opsNav=window.pcsInstallNav25;window.pcsInstallNav25()}}
bind();
const root=document.getElementById('root');if(root)new MutationObserver(()=>setTimeout(bind,0)).observe(root,{childList:true,subtree:false});
})();
