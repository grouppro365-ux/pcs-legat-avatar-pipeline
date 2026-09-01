(()=>{
'use strict';
const E=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const yes=v=>v?'<span class="v24-ok">Работает</span>':'<span class="v24-bad">Нет связи</span>';
async function status24(){
  if(window.PCS)window.PCS.page='status';
  const root=document.querySelector('#root');if(root&&typeof window.shell==='function')root.innerHTML=window.shell();
  if(typeof window.pcsInstallNav20==='function')window.pcsInstallNav20();
  const m=document.querySelector('#main');if(!m)return;
  m.innerHTML='<div class="eyebrow">Система</div><h1 class="title">Состояние системы</h1><p class="sub">Проверка рабочих контуров PCS.</p><div id="v24Status" class="v24-status-grid"><div class="v22-empty">Проверяю…</div></div>';
  try{
    const d=await window.call('/status'),rows=[
      ['База оператора',yes(!!d.operator_database)],
      ['База бизнеса',yes(!!d.business_database)],
      ['Клиенты',E(d.contacts??0)],
      ['Каталог',E(d.catalog??0)],
      ['Медиа',E(d.media??0)],
      ['Telegram',yes(!!d.telegram_configured)]
    ];
    document.querySelector('#v24Status').innerHTML=rows.map(([n,v])=>`<div class="status-row"><span>${n}</span><b>${v}</b></div>`).join('');
  }catch(e){document.querySelector('#v24Status').innerHTML=`<div class="v22-empty">${E(e.message)}</div>`}
}
window.pcsStatus24=status24;
const oldGo=window.go;window.go=function(p){if(p==='status')return status24();return oldGo(p)};
})();