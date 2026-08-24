(()=>{
const CFG='https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-admin-config-v15';
const META=new Set(['whatsapp','instagram','facebook']);
const FIELDS={
 whatsapp:['phone_number_id','business_account_id','graph_version'],
 instagram:['instagram_account_id','page_id','graph_version'],
 facebook:['page_id','graph_version'],
 line:['channel_id']
};
const SECRETS={
 whatsapp:['access_token','verify_token','app_secret'],
 instagram:['access_token','verify_token','app_secret'],
 facebook:['access_token','verify_token','app_secret'],
 line:['channel_secret','channel_access_token']
};
let lastGrid=null,inFlight=false,scheduled=0;
async function cfg(path,opt={}){const h={'content-type':'application/json',...(opt.headers||{})},t=localStorage.pcsToken||'';if(t)h.authorization='Bearer '+t;const r=await fetch(CFG+path,{...opt,headers:h});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||('HTTP '+r.status));return d}
function field(id,label,placeholder=''){const wrap=document.createElement('div');wrap.className='field pcs-v20-field';wrap.innerHTML=`<label>${esc(label)}</label><input id="${id}" type="password" placeholder="${esc(placeholder||'Оставьте пустым, чтобы не менять')}" autocomplete="new-password">`;return wrap}
function readinessHtml(ch,d){return `<b>Webhook E2E</b><p class="muted">${esc(d.webhook_url||'')}</p><div class="pills"><span class="pill ${d.readiness?.credentials_ok?'ok':'warn'}">Credentials ${d.readiness?.credentials_ok?'OK':'нет'}</span><span class="pill ${d.readiness?.incoming_processed?'ok':'warn'}">Inbound ${d.readiness?.incoming_processed||0}</span><span class="pill ${d.readiness?.outgoing_sent?'ok':'warn'}">Outbound ${d.readiness?.outgoing_sent||0}</span></div><button class="btn ghost" style="margin-top:10px" onclick="channelReadinessV20('${ch}')">Проверить E2E и активировать</button>`}
function info(ch,d){const card=document.querySelector(`.channel-card[data-channel="${ch}"]`);if(!card)return;if(META.has(ch)&&!card.querySelector(`#ch_${ch}_app_secret`)){const toolbar=card.querySelector('.toolbar');toolbar?.before(field(`ch_${ch}_app_secret`,'Meta App Secret','Обязателен для проверки подписи webhook'))}
 let box=card.querySelector('.pcs-v20-readiness');if(!box){box=document.createElement('div');box.className='card inset-card pcs-v20-readiness';card.appendChild(box)}const html=readinessHtml(ch,d);if(box.innerHTML!==html)box.innerHTML=html}
async function decorate(force=false){const grid=document.querySelector('.channel-grid');if(!grid)return;if(!force&&grid===lastGrid)return;if(inFlight)return;inFlight=true;try{const rows=await cfg('/channels');lastGrid=grid;for(const d of rows||[])info(d.channel,d)}catch(e){console.warn('connections-v20 decorate',e)}finally{inFlight=false}}
function schedule(force=false){clearTimeout(scheduled);scheduled=setTimeout(()=>decorate(force),60)}
window.saveChannel=async function(ch){try{const public_config={},secrets={};for(const k of FIELDS[ch]||[]){const el=document.querySelector(`#ch_${ch}_${k}`);if(el)public_config[k]=el.value.trim()}if(META.has(ch)&&!public_config.graph_version)public_config.graph_version='v23.0';for(const k of SECRETS[ch]||[]){const el=document.querySelector(`#ch_${ch}_${k}`),v=el?.value?.trim();if(v)secrets[k]=v}await cfg('/channels/'+ch,{method:'PUT',body:JSON.stringify({public_config,secrets})});toast('Настройки канала сохранены. Канал пока не активирован.');schedule(true)}catch(e){toast(e.message)}};
window.testChannelV14=async function(ch){try{const d=await cfg('/channels/'+ch+'/test',{method:'POST',body:'{}'});toast(`${ch}: credentials проверены, нужен E2E`);schedule(true);return d}catch(e){toast(e.message);schedule(true)}};
window.channelReadinessV20=async function(ch){try{const d=await cfg('/channels/'+ch+'/readiness',{method:'POST',body:'{}'});toast(d.ready?'Канал активирован':'E2E ещё не подтверждён');schedule(true)}catch(e){toast(e.message);schedule(true)}};
new MutationObserver(()=>{const grid=document.querySelector('.channel-grid');if(grid&&grid!==lastGrid)schedule(false)}).observe(document.documentElement,{subtree:true,childList:true});
document.addEventListener('DOMContentLoaded',()=>schedule(false));
})();
