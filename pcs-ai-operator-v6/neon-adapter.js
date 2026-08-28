(()=>{
'use strict';
const CORE='https://ep-young-smoke-axgy282p.apirest.c-4.us-east-2.aws.neon.tech/neondb/rest/v1';
const OPS='https://ep-small-cell-av1ecg0k.apirest.c-11.us-east-1.aws.neon.tech/neondb/rest/v1';
const nativeFetch=window.fetch.bind(window);
const enc=new TextEncoder();
const jsonResponse=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json;charset=utf-8','cache-control':'no-store'}});
const parseBody=async init=>{if(!init?.body)return{};if(typeof init.body==='string'){try{return JSON.parse(init.body)}catch{return{}}}try{return JSON.parse(await new Response(init.body).text())}catch{return{}}};
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const fromB64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const fromHex=s=>Uint8Array.from((s.match(/.{1,2}/g)||[]).map(x=>parseInt(x,16)));
async function rpc(base,name,args){
  const r=await nativeFetch(`${base}/rpc/${name}`,{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(args||{}),cache:'no-store'});
  let d; try{d=await r.json()}catch{d={error:`HTTP ${r.status}`}}
  if(!r.ok){const msg=d?.message||d?.error||d?.details||`HTTP ${r.status}`;throw new Error(msg)}
  return d;
}
async function login(password){
  const c=await rpc(CORE,'pcs_auth_challenge',{});
  const material=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:fromB64(c.salt),iterations:Number(c.iterations)},material,256);
  const hkey=await crypto.subtle.importKey('raw',bits,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const nonce=String(c.challenge).split('.')[1]||'';
  const signature=await crypto.subtle.sign('HMAC',hkey,fromHex(nonce));
  return rpc(CORE,'pcs_login',{challenge:c.challenge,response:hex(signature)});
}
const token=()=>localStorage.pcsToken||'';
const core=(action,payload={})=>rpc(CORE,'pcs_core',{p_token:token(),p_action:action,p_payload:payload});
const ops=(action,payload={})=>rpc(OPS,'pcs_ops',{p_token:token(),p_action:action,p_payload:payload});
const normalizeKnowledge=x=>({...x,status:String(x.status||'draft').toLowerCase(),visibility:x.auto_answer_allowed?'customer_safe':'approval_only',revision:1,valid_until:x.valid_at||null,answer_guidance:null});
const normalizeCatalog=x=>({
  id:x.id,public_id:x.public_id,title:x.title,city:x.city||'',
  category:x.entity_type==='VEHICLE'?'car_rent':x.entity_type==='PROPERTY'?'housing_rent':'service',entity_type:x.entity_type,
  status:String(x.availability_status||'REQUIRES_CONFIRMATION').toLowerCase(),availability_status:x.availability_status,
  publication_status:x.publication_status,moderation_status:x.moderation_status,
  price:x.client_price_thb==null?null:Number(x.client_price_thb),base_price:x.client_price_thb==null?null:Number(x.client_price_thb),
  final_price:x.client_price_thb==null?null:Number(x.client_price_thb),deposit:x.deposit_thb==null?null:Number(x.deposit_thb),
  currency:'THB',pricing_locked:false,deleted_at:null,media_items:x.image_url?[{public_url:x.image_url}]:[],image_url:x.image_url||null,
  publication_starts_at:x.publication_starts_at,publication_ends_at:x.publication_ends_at,updated_at:x.updated_at
});
function pathOf(url,prefix){const i=url.indexOf(prefix);return i<0?null:url.slice(i+prefix.length)||'/'}
function routeKind(url){
  const marks=[['/pcs-ui-api','ui'],['/pcs-catalog-admin','catalogAdmin'],['/pcs-ops-api','ops'],['/pcs-errors-api','errors'],['/pcs-media-api','media'],['/pcs-contracts-api','contracts'],['/pcs-knowledge-api','knowledge']];
  for(const [m,k] of marks){const p=pathOf(url,m);if(p!==null)return{k,path:p}}
  return null;
}
function appError(message,status=409){return jsonResponse({error:message},status)}
async function uiRoute(path,init){
  const method=String(init?.method||'GET').toUpperCase();
  const body=await parseBody(init);
  if(path==='/login'&&method==='POST')return jsonResponse(await login(body.password||''));
  if(path==='/session')return jsonResponse(await core('session'));
  if(path==='/crm'&&method==='GET')return jsonResponse(await core('clients'));
  let m=path.match(/^\/crm\/([^/]+)$/);
  if(m&&method==='GET')return jsonResponse(await core('client',{id:decodeURIComponent(m[1])}));
  if(m&&method==='PATCH')return jsonResponse(await core('contact_update',{id:decodeURIComponent(m[1]),...body}));
  m=path.match(/^\/crm\/([^/]+)\/tasks$/);
  if(m&&method==='POST')return jsonResponse(await core('task_create',{id:decodeURIComponent(m[1]),...body}));
  m=path.match(/^\/crm\/([^/]+)\/complete-task\/([^/]+)$/);
  if(m&&method==='POST')return jsonResponse(await core('task_complete',{id:decodeURIComponent(m[1]),task_id:decodeURIComponent(m[2])}));
  m=path.match(/^\/crm\/([^/]+)\/action$/);
  if(m&&method==='POST')return jsonResponse(await core('contact_action',{id:decodeURIComponent(m[1]),action:body.action}));
  if(/^\/crm\/[^/]+\/(send|followup|selected-media)$/.test(path))return appError('Telegram подключён для чтения и ответа, но server-side credential отправки ещё не перенесён в Neon. Сообщение не отправлено.',409);
  if(path==='/catalog'&&method==='GET')return jsonResponse((await ops('catalog')).map(normalizeCatalog));
  if(path==='/approvals'&&method==='GET')return jsonResponse(await core('approvals'));
  if(/^\/approvals\//.test(path))return appError('Очередь согласований доступна для просмотра. Отправка через Telegram будет включена после переноса server-side credential.',409);
  if(path==='/knowledge'&&method==='GET')return jsonResponse((await core('knowledge')).map(normalizeKnowledge));
  if(path==='/knowledge'&&method==='POST')return jsonResponse(await core('knowledge_save',{...body}));
  m=path.match(/^\/knowledge\/([^/]+)$/);
  if(m&&method==='PATCH')return jsonResponse(await core('knowledge_save',{id:decodeURIComponent(m[1]),...body}));
  if(path==='/status'&&method==='GET'){
    const [c,o]=await Promise.all([core('status'),ops('status')]);
    return jsonResponse({database:true,core_database:true,runtime_database:true,contacts:c.contacts,conversations:c.conversations,messages:c.messages,knowledge:c.knowledge,catalog:o.catalog,available:o.available,published:o.published,telegram_connections:c.telegram_connections,telegram_can_read:c.telegram_can_read,telegram_can_reply:c.telegram_can_reply});
  }
  if(path==='/settings'&&method==='GET'){
    const s=await core('status');
    return jsonResponse({configured:{telegram_bot_token:false,tokenrouter_key:false,openrouter_key:false},telegram_bot_username:null,telegram_webhook_url:null,telegram_business_connected:s.telegram_connections>0,telegram_can_read:s.telegram_can_read,telegram_can_reply:s.telegram_can_reply,tokenrouter_model:'',tokenrouter_fallback_model:'',openrouter_model:'',openrouter_fallback_model:'',auto_send:false});
  }
  if(path==='/settings'&&method==='PUT')return appError('Секреты больше не сохраняются через браузер. Telegram Business уже подключён; server-side credentials переносятся отдельно.',409);
  if(path==='/test/telegram'&&method==='POST'){
    const s=await core('status');
    if(!s.telegram_connections||!s.telegram_can_read||!s.telegram_can_reply)return appError('Telegram Business connection не готов',503);
    return jsonResponse({ok:true,can_read:true,can_reply:true});
  }
  if(/^\/test\/(tokenrouter|openrouter)$/.test(path))return appError('AI provider credential пока не перенесён в Neon-only runtime.',503);
  if(path==='/telegram/install-webhook'&&method==='POST')return appError('Нельзя переустановить webhook без server-side Bot Token. Текущая Telegram Business connection в базе активна.',409);
  return appError(`Neon adapter: маршрут ${method} ${path} ещё не перенесён`,404);
}
async function opsRoute(path,init){
  const method=String(init?.method||'GET').toUpperCase();
  if(path==='/reservations'&&method==='GET')return jsonResponse(await ops('bookings'));
  if(path==='/extras'&&method==='GET')return jsonResponse([]);
  if(path==='/duration-rules'&&method==='GET')return jsonResponse([]);
  if(path==='/seasonal-rules'&&method==='GET')return jsonResponse([]);
  if(path.startsWith('/quote?'))return appError('Тарифные правила в Neon пока не заполнены; система не будет угадывать цену.',409);
  if(path==='/status'&&method==='GET')return jsonResponse(await ops('status'));
  if(path==='/payment-settings'&&method==='GET')return jsonResponse({configured:false});
  return appError(`Операция ${method} ${path} ещё не перенесена в Neon runtime`,409);
}
async function catalogAdminRoute(init){
  const body=await parseBody(init);
  if(body.action==='rules'){
    const d=await ops('catalog_item',{id:body.id});
    return jsonResponse((d.pricing||[]).map(x=>({...x,name:x.notes||x.rule_type||'Тариф',date_from:x.effective_from?String(x.effective_from).slice(0,10):'',date_to:x.effective_to?String(x.effective_to).slice(0,10):'',multiplier:1})));
  }
  return appError('Редактирование цен/сезонов через старый catalog-admin отключено до переноса записей в новую модель pricing_rules.',409);
}
async function errorsRoute(path,init){
  const method=String(init?.method||'GET').toUpperCase();
  if((path==='/'||path==='')&&method==='GET')return jsonResponse(await core('errors'));
  return appError('Повтор задания пока доступен только после переноса очереди в Neon.',409);
}
window.__PCS_NEON_ADAPTER__={core:CORE,ops:OPS,version:'2026-08-28.1'};
try{Object.defineProperty(window,'PCS_API',{configurable:true,get(){return 'https://pcs-neon.local/pcs-ui-api'},set(){}})}catch{}
window.fetch=async function(input,init={}){
  const url=typeof input==='string'?input:input?.url||String(input);
  const r=routeKind(url);
  if(!r)return nativeFetch(input,init);
  try{
    if(r.k==='ui')return await uiRoute(r.path,init);
    if(r.k==='ops')return await opsRoute(r.path,init);
    if(r.k==='catalogAdmin')return await catalogAdminRoute(init);
    if(r.k==='errors')return await errorsRoute(r.path,init);
    return appError(`Старый ${r.k} endpoint отключён. Данные не отправлены в Supabase.`,410);
  }catch(e){
    console.error('[PCS Neon adapter]',r.k,r.path,e);
    return appError(e?.message||'Ошибка Neon Data API',503);
  }
};
})();