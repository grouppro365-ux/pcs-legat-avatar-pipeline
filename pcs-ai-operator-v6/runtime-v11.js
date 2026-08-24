(()=>{
function applyTelegramTheme(){
  const tg=window.Telegram?.WebApp;
  if(!tg)return;
  try{tg.ready();tg.expand()}catch{}
  const saved=localStorage.pcsTheme;
  const dark=saved==='dark'||(!saved&&tg.colorScheme==='dark');
  document.documentElement.dataset.theme=dark?'dark':'light';
  document.body?.classList.toggle('tg-dark',dark);
  const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=dark?'#061421':'#f6f8f6';
  try{tg.setHeaderColor(dark?'#071827':'#f6f8f6');tg.setBackgroundColor(dark?'#061421':'#f6f8f6')}catch{}
}
function bindHorizontal(el){
  if(el.dataset.v11Scroll)return;el.dataset.v11Scroll='1';el.classList.add('pcs-drag-scroll');
  el.addEventListener('wheel',e=>{if(el.scrollWidth<=el.clientWidth)return;const d=Math.abs(e.deltaY)>=Math.abs(e.deltaX)?e.deltaY:e.deltaX;if(!d)return;el.scrollLeft+=d;e.preventDefault()},{passive:false});
  let down=false,start=0,left=0,pid=null;
  el.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('button,input,select,textarea,a'))return;down=true;pid=e.pointerId;start=e.clientX;left=el.scrollLeft;el.classList.add('pcs-dragging');try{el.setPointerCapture(pid)}catch{}});
  el.addEventListener('pointermove',e=>{if(down&&e.pointerId===pid)el.scrollLeft=left-(e.clientX-start)});
  const end=e=>{if(!down)return;down=false;el.classList.remove('pcs-dragging');try{el.releasePointerCapture(pid)}catch{}};el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);
}
function bind(){document.querySelectorAll('.ops-tabs,.premium-fleet,.media-grid,.queue-grid,.scroll-x,.calendar-desktop').forEach(bindHorizontal)}
function forceDarkContrast(){if(document.documentElement.dataset.theme==='dark')document.body?.classList.add('tg-dark');else document.body?.classList.remove('tg-dark')}
let raf=0;const mo=new MutationObserver(()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(()=>{applyTelegramTheme();forceDarkContrast();bind()})});mo.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['data-theme']});
window.addEventListener('DOMContentLoaded',()=>{applyTelegramTheme();bind()});window.addEventListener('pcs:bind-scroll',bind);setTimeout(()=>{applyTelegramTheme();bind()},0);
})();