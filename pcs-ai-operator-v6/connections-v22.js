(()=>{
'use strict';
const ENDPOINT='https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-publish-stable-web-v1';
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const token=()=>localStorage.pcsToken||'';
async function req(method='GET',payload){
  const opt={method,headers:{authorization:'Bearer '+token(),accept:'application/json'}};
  if(payload!==undefined){opt.headers['content-type']='application/json';opt.body=JSON.stringify(payload)}
  const r=await fetch(ENDPOINT,opt);let d={};try{d=await r.json()}catch{}
  if(!r.ok||d.ok===false)throw new Error(d.error||('HTTP '+r.status));return d;
}
const configured=x=>!!x&&Object.keys(x.configured||{}).length>0;
function field(id,label,value='',type='text'){return `<label>${esc(label)}<input id="${id}" type="${type}" value="${type==='password'?'':esc(value)}" placeholder="${type==='password'?'Оставьте пустым, чтобы не менять':''}" autocomplete="off"></label>`}
function card(p,title,subtitle,fields,status){return `<section class="v22-integration"><div class="v22-integration-head"><div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div><span class="v22-state ${status?'ok':''}">${status?'Настроено':'Не настроено'}</span></div><div class="v22-fields">${fields}</div><div class="v22-actions"><button class="btn" onclick="pcsSave22('${p}')">Сохранить</button><button class="btn soft" onclick="pcsTest22('${p}')">Проверить</button></div><div id="v22-result-${p}" class="v22-result"></div></section>`}
async function connections22(){
  if(window.PCS)window.PCS.page='connect';
  const root=document.querySelector('#root');if(root&&typeof window.shell==='function')root.innerHTML=window.shell();
  if(typeof window.pcsInstallNav20==='function')window.pcsInstallNav20();else if(typeof window.opsNav==='function')window.opsNav();
  const m=document.querySelector('#main');if(!m)return;
  m.innerHTML=`<div class="eyebrow">Каналы и маршрутизация</div><h1 class="title">Подключения</h1><p class="sub">Подключайте нужные каналы к единому профилю клиента и общей логике PCS. Здесь показывается реальный статус каждого подключения.</p><div id="v22Connect" class="v22-connections"><div class="v22-empty">Загружаю подключения…</div></div>`;
  try{
    const d=await req('GET'),x=d.channels||{},box=document.querySelector('#v22Connect');
    box.innerHTML=
      card('telegram','Telegram Business','Основной рабочий канал PCS.','<div class="v22-result">Управляется действующим Telegram Business подключением.</div>',true)+
      card('line','LINE','Сообщения LINE в тот же профиль клиента.',field('line-channel-id','Channel ID',x.line?.channel_id||'')+field('line-token','Channel access token','','password')+field('line-secret','Channel secret','','password'),configured(x.line))+
      card('whatsapp','WhatsApp','WhatsApp Business Cloud API.',field('wa-business-id','WABA ID',x.whatsapp?.business_id||'')+field('wa-phone-id','Phone Number ID',x.whatsapp?.phone_number_id||'')+field('wa-token','Access token','','password')+field('wa-verify','Webhook verify token','','password'),configured(x.whatsapp))+
      card('instagram','Instagram','Instagram Direct через Meta Business.',field('ig-account-id','Instagram Business Account ID',x.instagram?.instagram_account_id||'')+field('ig-page-id','Facebook Page ID',x.instagram?.page_id||'')+field('ig-token','Access token','','password'),configured(x.instagram))+
      card('facebook','Facebook','Messenger страницы Facebook.',field('fb-page-id','Page ID',x.facebook?.page_id||'')+field('fb-token','Page access token','','password')+field('fb-verify','Webhook verify token','','password'),configured(x.facebook));
  }catch(e){const b=document.querySelector('#v22Connect');if(b)b.innerHTML=`<div class="v22-empty">${esc(e.message)}</div>`}
}
const val=id=>document.getElementById(id)?.value?.trim()||'';
window.pcsSave22=async p=>{
  const out=document.getElementById('v22-result-'+p);try{
    if(out)out.textContent='Сохраняю…';let fields={};
    if(p==='line')fields={channel_id:val('line-channel-id'),channel_access_token:val('line-token'),channel_secret:val('line-secret')};
    if(p==='whatsapp')fields={business_id:val('wa-business-id'),phone_number_id:val('wa-phone-id'),access_token:val('wa-token'),webhook_verify_token:val('wa-verify')};
    if(p==='instagram')fields={instagram_account_id:val('ig-account-id'),page_id:val('ig-page-id'),access_token:val('ig-token')};
    if(p==='facebook')fields={page_id:val('fb-page-id'),page_access_token:val('fb-token'),webhook_verify_token:val('fb-verify')};
    await req('POST',{action:'save',provider:p,fields});
    if(out)out.textContent='✓ Сохранено';if(typeof window.toast==='function')window.toast('Подключение сохранено');setTimeout(connections22,350);
  }catch(e){if(out)out.textContent='✕ '+e.message}
};
window.pcsTest22=async p=>{
  const out=document.getElementById('v22-result-'+p);try{
    if(out)out.textContent='Проверяю…';
    if(p==='telegram'){
      if(typeof window.call!=='function')throw new Error('API PCS недоступен');
      const d=await window.call('/test/telegram',{method:'POST',body:'{}'});
      if(out)out.textContent='✓ Telegram работает'+(d.username?' · @'+d.username:'');return;
    }
    const d=await req('POST',{action:'test',provider:p});
    if(out)out.textContent='✓ '+(d.label||'Подключение работает');
  }catch(e){if(out)out.textContent='✕ '+e.message}
};
window.connections22=connections22;
const oldGo=window.go;window.go=function(p){if(p==='connect')return connections22();return oldGo(p)};
window.moreMenu=function(){if(typeof window.openSheet!=='function')return;window.openSheet('Ещё',`<div class="more-grid"><button class="btn soft" onclick="closeSheet();go('crm')">Клиенты</button><button class="btn blue" onclick="closeSheet();go('approvals')">Требуют ответа</button><button class="btn sage" onclick="closeSheet();go('kb')">База знаний</button><button class="btn soft" onclick="closeSheet();go('calendar')">Календарь</button><button class="btn soft" onclick="closeSheet();go('finance')">Финансы</button><button class="btn" onclick="closeSheet();go('connect')">Подключения</button><button class="btn ghost" onclick="closeSheet();go('errors')">Ошибки и повторы</button><button class="btn ghost" onclick="closeSheet();go('status')">Состояние системы</button><button class="btn danger" onclick="logout()">Выйти</button></div>`) };
})();
