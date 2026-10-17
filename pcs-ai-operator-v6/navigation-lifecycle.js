(()=>{
'use strict';
// One transition number covers page routes and nested booking tabs. Renderers
// capture it before I/O and verify it before touching shared state or the DOM.
let sequence=0;
const listeners=new Set();
function capture(){return {sequence,page:String(window.PCS?.page||'')}}
function isCurrent(scope){return !!scope&&scope.sequence===sequence&&scope.page===String(window.PCS?.page||'')}
function notify(scope){if(!isCurrent(scope))return;for(const listener of listeners){try{listener(scope)}catch(error){console.error('PCS navigation listener',error)}}}
function run(page,render){
 sequence++;
 if(window.PCS)window.PCS.page=page;
 const scope=capture();
 window.pcsSheetLifecycle?.invalidate();
 if(document.body.classList.contains('sheet-open'))window.closeSheet?.();
 try{window.scrollTo({top:0,left:0,behavior:'auto'})}catch{}
 let result;
 try{result=render()}catch(error){notify(scope);throw error}
 // Attach both branches: ignoring a derived .finally promise creates an
 // unhandled rejection even when the original caller handles its promise.
 if(result&&typeof result.then==='function')result.then(()=>notify(scope),()=>notify(scope));
 else notify(scope);
 return result;
}
window.pcsNavigation={capture,isCurrent,run,subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener)}};
})();
