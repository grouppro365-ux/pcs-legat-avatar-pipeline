(()=>{'use strict';
 let frame=0;
 const update=()=>{frame=0;const v=window.visualViewport;document.documentElement.style.setProperty('--pcs-visible-height',(v?.height||window.innerHeight)+'px');document.documentElement.style.setProperty('--pcs-visible-top',(v?.offsetTop||0)+'px');};
 const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
 window.visualViewport?.addEventListener('resize',schedule);window.visualViewport?.addEventListener('scroll',schedule);window.addEventListener('resize',schedule);update();
})();
