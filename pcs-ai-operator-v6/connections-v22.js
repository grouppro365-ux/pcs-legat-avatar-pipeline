(()=>{
'use strict';
const ENDPOINT='https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-publish-stable-web-v1';
const esc22=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const token22=()=>localStorage.pcsToken||'';
async function api22(payload){
 const r=await fetch(ENDPOINT,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token22()},body:JSON.stringify(payload)});
 let d={};try{d=await r.json()}catch{}
 if(!r.ok||d.ok===false)throw new Error(d.error||('HTTP '+r.status));return d;
}
function field22(id,label,placeholder='',type='text'){return `<label>${esc22(label)}<input id="${id}" type="${type}" placeholder="${esc22(placeholder)}" autocomplete="off"></label>`}
function card22(p,title,subtitle,fields,status){return `<section class="v22-integration"><div class="v22-integration-head"><div><h2>${esc22(title)}</h2><p>${esc22(subtitle)}</p></div><span class="v22-state ${status?'ok':''}">${status?'Настроено':'Не настроено'}</span></div><div class="v22-fields">${fields}</div><div class="v22-actions"><button class="btn" onclick="pcsSave22('${p}')">Сохранить</button><button class="btn soft" onclick="pcsTest22('${p}')">Проверить</button></div><div id="v22-result-${p}" class="v22-result"></div></section>`}
async function connections22(){
 if(window.PCS)window.PCS.page='connect';
 const root=document.querySelector('#root');if(root&&typeof window.shell==='function')root.innerHTML=window.shell();
 if(typeof window.pcsInstallNav20==='function')window.pcsInstallNav20();else if(typeof window.opsNav==='function')window.opsNav();
 const m=document.querySelector('#main');if(!m)return;
 m.innerHTML=`<div class="eyebrow">Каналы и маршрутизация</div><h1 class="title">Подключения</h1><p class="sub">Подключайте нужные каналы к единому профилю клиента и общей логике PCS. Неработающие каналы не маскируются: здесь виден их реальный статус.</p><div id="v22Connect" class="v22-connections"><div class="v22-empty">Загружаю подключения…</div></div>`;
 try{
  const d=await api22({action:'list'}),x=d.integrations||{},box=document.querySelector('#v22Connect');
  box.innerHTML=
   card22('telegram','Telegram Business','Основной рабочий канал PCS.',`<div class="v22-result">Управляется действующим Telegram Business подключением.</div>`,true)+
   card22('line','LINE','Сообщения LINE в тот же профиль клиента.',field22('line-channel-id','Channel ID',x.line?.channel_id||'')+field22('line-token','Channel access token','введите новый токен','password')+field22('line-secret','Channel secret','введите secret','password'),!!x.line?.configured)+
   card22('whatsapp','WhatsApp','WhatsApp Business Cloud API.',field22('wa-business-id','WABA ID',x.whatsapp?.business_id||'')+field22('wa-phone-id','Phone Number ID',x.whatsapp?.phone_number_id||'')+field22('wa-token','Access token','введите новый токен','password')+field22('wa-verify','Webhook verify token','введите verify token','password'),!!x.whatsapp?.configured)+
   card22('instagram','Instagram','Instagram Direct через Meta Business.',field22('ig-account-id','Instagram Business Account ID',x.instagram?.account_id||'')+field22('ig-page-id','Facebook Page ID',x.instagram?.page_id||'')+field22('ig-token','Access token','введите новый токен','password'),!!x.instagram?.configured)+
   card22('facebook','Facebook','Messenger страницы Facebook.',field22('fb-page-id','Page ID',x.facebook?.page_id||'')+field22('fb-token','Page access token','введите новый токен','password')+field22('fb-verify','Webhook verify token','введите verify token','password'),!!x.facebook?.configured);
 }catch(e){document.querySelector('#v22Connect').innerHTML=`<div class="v22-empty">${esc22(e.message)}</div>`}
}
function value22(id){return document.getElementById(id)?.value?.trim()||''}
window.pcsSave22=async p=>{const out=document.getElementById('v22-result-'+p);try{if(out)out.textContent='Сохраняю…';let data={};if(p==='line')data={channel_id:value22('line-channel-id'),access_token:value22('line-token'),channel_secret:value22('line-secret')};if(p==='whatsapp')data={business_id:value22('wa-business-id'),phone_number_id:value22('wa-phone-id'),access_token:value22('wa-token'),verify_token:value22('wa-verify')};if(p==='instagram')data={account_id:value22('ig-account-id'),page_id:value22('ig-page-id'),access_token:value22('ig-token')};if(p==='facebook')data={page_id:value22('fb-page-id'),access_token:value22('fb-token'),verify_token:value22('fb-verify')};await api22({action:'save',provider:p,data});if(out)out.textContent='✓ Сохранено';if(typeof window.toast==='function')window.toast('Подключение сохранено');setTimeout(connections22,500)}catch(e){if(out)out.textContent='✕ '+e.message}};
window.pcsTest22=async p=>{const out=document.getElementById('v22-result-'+p);try{if(out)out.textContent='Проверяю…';if(p==='telegram'){if(typeof window.call!=='function')throw new Error('API PCS недоступен');const d=await window.call('/test/telegram',{method:'POST',body:'{}'});if(out)out.textContent='✓ Telegram работает'+(d.username?' · @'+d.username:'');return}const d=await api22({action:'test',provider:p});if(out)out.textContent='✓ '+(d.label||'Подключение работает')}catch(e){if(out)out.textContent='✕ '+e.message}};
window.connections22=connections22;
const oldGo22=window.go;window.go=function(p){if(p==='connect')return connections22();return oldGo22(p)};
window.moreMenu=function(){if(typeof window.openSheet!=='function')return;window.openSheet('Ещё',`<div class="more-grid"><button class="btn soft" onclick="closeSheet();go('crm')">Клиенты</button><button class="btn blue" onclick="closeSheet();go('approvals')">Требуют ответа</button><button class="btn sage" onclick="closeSheet();go('kb')">База знаний</button><button class="btn soft" onclick="closeSheet();go('calendar')">Календарь</button><button class="btn soft" onclick="closeSheet();go('finance')">Финансы</button><button class="btn" onclick="closeSheet();go('connect')">Подключения</button><button class="btn ghost" onclick="closeSheet();go('errors')">Ошибки и повторы</button><button class="btn ghost" onclick="closeSheet();go('status')">Состояние системы</button><button class="btn danger" onclick="logout()">Выйти</button></div>`) };
})();
