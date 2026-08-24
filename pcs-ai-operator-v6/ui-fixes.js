(()=>{
const RU_EXACT={
  ok:'Система работает',
  database:'База данных',
  new_count:'Новые обращения',
  approval_count:'Требуют ответа',
  hot_count:'Горячие обращения',
  today_count:'Обращения сегодня',
  business_connections:'Подключения Telegram Business',
  business_can_reply:'Ответ от бизнес-аккаунта доступен',
  auto_send:'Автоматическая отправка',
  true:'Да',false:'Нет',
  runtime:'Система',
  status:'Состояние',
  health:'Работоспособность',
  connected:'Подключено',disconnected:'Не подключено',
  active:'Активно',inactive:'Неактивно'
};

const ICONS={
  'Входящие':'<svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z"/><path d="M4 14h4l2 3h4l2-3h4"/></svg>',
  'Клиенты':'<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3.5 19c.6-3.4 2.4-5 5.5-5s4.9 1.6 5.5 5"/><circle cx="17" cy="9" r="2.2"/><path d="M15.8 14.5c2.7.2 4.1 1.6 4.7 4.5"/></svg>',
  'CRM':'<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3.5 19c.6-3.4 2.4-5 5.5-5s4.9 1.6 5.5 5"/><path d="M16 5h5M16 9h5M16 13h5"/></svg>',
  'Брони':'<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/><path d="m9 15 2 2 4-4"/></svg>',
  'Каталог':'<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>',
  'Календарь':'<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M8 3v4M16 3v4M3.5 10h17"/></svg>',
  'База знаний':'<svg viewBox="0 0 24 24"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M8 4v13a3 3 0 0 0-3 3"/></svg>',
  'База':'<svg viewBox="0 0 24 24"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M8 4v13a3 3 0 0 0-3 3"/></svg>',
  'Требуют ответа':'<svg viewBox="0 0 24 24"><path d="M4 5h16v12H8l-4 4z"/><path d="M8 9h8M8 13h5"/></svg>',
  'Финансы':'<svg viewBox="0 0 24 24"><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/></svg>',
  'Подключения':'<svg viewBox="0 0 24 24"><path d="M8 12a4 4 0 0 1 4-4h3"/><path d="M16 12a4 4 0 0 1-4 4H9"/><path d="M14 5h5v5M10 19H5v-5"/></svg>',
  'Ошибки и повторы':'<svg viewBox="0 0 24 24"><path d="M12 3 2.8 19h18.4z"/><path d="M12 9v4M12 17h.01"/></svg>',
  'Состояние':'<svg viewBox="0 0 24 24"><path d="M3 12h4l2-6 4 12 2-6h6"/></svg>',
  'Состояние системы':'<svg viewBox="0 0 24 24"><path d="M3 12h4l2-6 4 12 2-6h6"/></svg>',
  'Ещё':'<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>'
};

function normalizeTextNode(node){
  const t=(node.nodeValue||'').trim();
  if(!t)return;
  if(Object.prototype.hasOwnProperty.call(RU_EXACT,t))node.nodeValue=node.nodeValue.replace(t,RU_EXACT[t]);
}
function localizeRaw(root=document){
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  const nodes=[];let n;
  while(n=walker.nextNode())nodes.push(n);
  for(const node of nodes){
    const p=node.parentElement;
    if(!p||p.closest('.conversation,.bubble,[data-user-content],textarea,script,style'))continue;
    normalizeTextNode(node);
  }
}
function iconize(root=document){
  root.querySelectorAll?.('.nav button,.bottom button').forEach(btn=>{
    const text=[...btn.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.nodeValue.trim()).filter(Boolean).join(' ')||btn.textContent.trim();
    const key=Object.keys(ICONS).find(k=>text===k||text.endsWith(k));
    if(!key||btn.querySelector('.nav-icon'))return;
    const span=document.createElement('span');span.className='nav-icon';span.setAttribute('aria-hidden','true');span.innerHTML=ICONS[key];
    btn.prepend(span);
  });
}
function bindHorizontal(el){
  if(el.dataset.pcsScrollBound)return;el.dataset.pcsScrollBound='1';el.classList.add('pcs-drag-scroll');
  el.addEventListener('wheel',e=>{
    if(el.scrollWidth<=el.clientWidth)return;
    const d=Math.abs(e.deltaY)>=Math.abs(e.deltaX)?e.deltaY:e.deltaX;
    if(!d)return;
    el.scrollLeft+=d;
    e.preventDefault();
  },{passive:false});
  let down=false,startX=0,startLeft=0,pid=null;
  el.addEventListener('pointerdown',e=>{
    if(e.button!==0||e.target.closest('button,input,select,textarea,a'))return;
    down=true;pid=e.pointerId;startX=e.clientX;startLeft=el.scrollLeft;el.classList.add('pcs-dragging');try{el.setPointerCapture(pid)}catch{}
  });
  el.addEventListener('pointermove',e=>{if(!down||e.pointerId!==pid)return;el.scrollLeft=startLeft-(e.clientX-startX);});
  const end=e=>{if(!down)return;down=false;el.classList.remove('pcs-dragging');try{el.releasePointerCapture(pid)}catch{}};
  el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);
}
function bindScroll(root=document){root.querySelectorAll?.('.ops-tabs,.premium-fleet,.media-grid,.queue-grid,.scroll-x').forEach(bindHorizontal);}
function themeButton(){document.querySelectorAll('.iconbtn').forEach(btn=>{if(btn.textContent.trim()==='◐'){btn.innerHTML='<span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z"/></svg></span>';}})}
function apply(){localizeRaw(document);iconize(document);bindScroll(document);themeButton();}
let raf=0;const mo=new MutationObserver(()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(apply)});mo.observe(document.documentElement,{subtree:true,childList:true});
window.addEventListener('DOMContentLoaded',apply);setTimeout(apply,0);
})();