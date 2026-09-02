(()=>{
'use strict';

/*
  PCS browser adapter.
  The UI keeps its existing routes, but all live browser traffic now goes
  through the server-side PCS manager API. The browser no longer talks
  directly to Neon Data API and never receives database credentials.
*/
const MANAGER='https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-manager-live2';
const SETTINGS='https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-admin-config-v15';
const nativeFetch=window.fetch.bind(window);
const jsonResponse=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json;charset=utf-8','cache-control':'no-store'}});
const parseBody=async init=>{if(!init?.body)return{};if(typeof init.body==='string'){try{return JSON.parse(init.body)}catch{return{}}}try{return JSON.parse(await new Response(init.body).text())}catch{return{}}};
const currentToken=()=>localStorage.pcsToken||'';

async function manager(op,{method='GET',body=null,id=null,auth=true}={}){
  const u=new URL(MANAGER);
  u.searchParams.set('op',op);
  if(id!=null)u.searchParams.set('id',String(id));
  const headers={'accept':'application/json'};
  if(body!=null)headers['content-type']='application/json';
  if(auth&&currentToken())headers.authorization='Bearer '+currentToken();
  const r=await nativeFetch(u.toString(),{
    method,
    headers,
    body:body==null?undefined:JSON.stringify(body),
    cache:'no-store'
  });
  const text=await r.text();
  let d={};
  try{d=text?JSON.parse(text):{}}catch{d={error:text||`HTTP ${r.status}`}}
  if(!r.ok)throw new Error(d?.error||d?.message||`HTTP ${r.status}`);
  return d;
}

async function settingsApi(path,{method='GET',body=null}={}){
  const headers={'accept':'application/json'};
  if(body!=null)headers['content-type']='application/json';
  if(currentToken())headers.authorization='Bearer '+currentToken();
  const r=await nativeFetch(SETTINGS+'/'+String(path||'').replace(/^\/+/,''),{
    method,headers,body:body==null?undefined:JSON.stringify(body),cache:'no-store'
  });
  const text=await r.text();let d={};
  try{d=text?JSON.parse(text):{}}catch{d={error:text||`HTTP ${r.status}`}}
  if(!r.ok)throw new Error(d?.error||d?.message||`HTTP ${r.status}`);
  return d;
}

const normalizeCatalog=x=>({
  ...x,
  id:x.id,
  public_id:x.public_id,
  title:x.title||x.name||'Позиция',
  city:x.city||'',
  category:x.category||(x.entity_type==='VEHICLE'?'car_rent':x.entity_type==='PROPERTY'?'housing_rent':'service'),
  status:String(x.status||x.availability_status||'REQUIRES_CONFIRMATION').toLowerCase(),
  price:x.price??x.client_price_thb??null,
  base_price:x.base_price??x.client_price_thb??null,
  final_price:x.final_price??x.client_price_thb??null,
  deposit:x.deposit??x.deposit_thb??null,
  currency:x.currency||'THB',
  media_items:x.media_items||(x.image_url?[{public_url:x.image_url}]:[])
});

function pathOf(url,prefix){const i=url.indexOf(prefix);return i<0?null:url.slice(i+prefix.length)||'/'}
function routeKind(url){
  const marks=[
    ['/pcs-ui-api','ui'],
    ['/pcs-catalog-admin','catalogAdmin'],
    ['/pcs-ops-api','ops'],
    ['/pcs-errors-api','errors'],
    ['/pcs-media-api','media'],
    ['/pcs-contracts-api','contracts'],
    ['/pcs-knowledge-api','knowledge'],
    ['/pcs-connections-api','connections']
  ];
  for(const [m,k] of marks){const p=pathOf(url,m);if(p!==null)return{k,path:p}}
  return null;
}
function appError(message,status=409){return jsonResponse({error:message},status)}

async function uiRoute(path,init){
  const method=String(init?.method||'GET').toUpperCase();
  const body=await parseBody(init);

  if(path==='/login'&&method==='POST')return jsonResponse(await manager('login',{method:'POST',body:{password:body.password||''},auth:false}));
  if(path==='/session')return jsonResponse(await manager('session'));
  if(path==='/dashboard')return jsonResponse(await manager('dashboard'));
  if(path==='/crm'&&method==='GET')return jsonResponse(await manager('clients'));

  let m=path.match(/^\/crm\/([^/]+)$/);
  if(m&&method==='GET')return jsonResponse(await manager('client',{id:decodeURIComponent(m[1])}));
  if(m&&method==='PATCH')return appError('Редактирование карточки временно недоступно в Mini App. Данные не потеряны.',409);

  m=path.match(/^\/crm\/([^/]+)\/(send|followup)$/);
  if(m&&method==='POST'){
    const text=body.text||body.message||body.answer||'';
    if(!String(text).trim())return appError('Введите текст сообщения',400);
    return jsonResponse(await manager('send',{id:decodeURIComponent(m[1]),method:'POST',body:{text:String(text)}}));
  }
  if(/^\/crm\/[^/]+\/selected-media$/.test(path))return appError('Отправка выбранного медиа ещё не подключена к стабильному Mini App.',409);
  if(/^\/crm\/[^/]+\/(tasks|complete-task|action)/.test(path))return appError('Изменение CRM из этого экрана пока ограничено безопасным режимом.',409);

  if(path==='/catalog'&&method==='GET')return jsonResponse((await manager('catalog')).map(normalizeCatalog));
  if(path==='/approvals'&&method==='GET')return jsonResponse(await manager('approvals'));
  if(/^\/approvals\//.test(path))return appError('Действие с согласованием пока недоступно в стабильном Mini App.',409);
  if(path==='/knowledge'&&method==='GET')return jsonResponse([]);
  if(path==='/knowledge'&&method!=='GET')return appError('Редактор базы знаний пока доступен только в основной панели.',409);

  if(path==='/status'&&method==='GET'){
    const s=await manager('status');
    return jsonResponse({
      ...s,
      database:Boolean(s.operator_database||s.business_database||s.database),
      core_database:Boolean(s.operator_database||s.core_database),
      runtime_database:Boolean(s.business_database||s.runtime_database),
      telegram_business_connected:Boolean(s.connection||s.telegram_business_connected),
      telegram_can_read:Boolean(s.connection?.can_read??s.telegram_can_read),
      telegram_can_reply:Boolean(s.connection?.can_reply??s.telegram_can_reply)
    });
  }
  if(path==='/settings'&&method==='GET'){
    return jsonResponse(await settingsApi('settings'));
  }
  if(path==='/settings'&&method==='PUT')return jsonResponse(await settingsApi('settings',{method:'PUT',body}));
  if(path==='/test/telegram'&&method==='POST')return jsonResponse(await manager('telegram-test'));
  m=path.match(/^\/test\/(tokenrouter|openrouter)$/);
  if(m&&method==='POST')return jsonResponse(await settingsApi('test/'+m[1],{method:'POST',body:{}}));
  if(path==='/telegram/install-webhook'&&method==='POST')return appError('Webhook управляется сервером PCS.',409);

  return appError(`Маршрут ${method} ${path} пока не подключён к стабильному Mini App`,404);
}

async function opsRoute(path,init){
  const method=String(init?.method||'GET').toUpperCase();
  if(path==='/reservations'&&method==='GET')return jsonResponse(await manager('applications'));
  if(path==='/extras'&&method==='GET')return jsonResponse(await manager('services'));
  if(path==='/duration-rules'&&method==='GET')return jsonResponse(await manager('durations'));
  if(path==='/seasonal-rules'&&method==='GET')return jsonResponse(await manager('seasons'));
  if(path==='/status'&&method==='GET')return jsonResponse(await manager('status'));
  if(path==='/payment-settings'&&method==='GET')return jsonResponse({configured:false});
  if(path.startsWith('/quote?'))return appError('Расчёт тарифа пока доступен после подтверждения правил цены.',409);
  return appError(`Операция ${method} ${path} пока не подключена к стабильному Mini App`,409);
}

async function catalogAdminRoute(init){
  const body=await parseBody(init);
  if(body.action==='rules')return jsonResponse([]);
  return appError('Редактирование каталога из Mini App временно ограничено.',409);
}

async function errorsRoute(path,init){
  const method=String(init?.method||'GET').toUpperCase();
  if((path==='/'||path==='')&&method==='GET')return jsonResponse(await manager('errors'));
  return appError('Повтор задания пока выполняется из основной панели.',409);
}

window.__PCS_BACKEND_ADAPTER__={api:MANAGER,settingsApi:SETTINGS,version:'2026-09-02.1'};
try{Object.defineProperty(window,'PCS_API',{configurable:true,get(){return 'https://pcs-stable.local/pcs-ui-api'},set(){}})}catch{}

window.fetch=async function(input,init={}){
  const url=typeof input==='string'?input:input?.url||String(input);
  const r=routeKind(url);
  if(!r)return nativeFetch(input,init);
  try{
    if(r.k==='ui')return await uiRoute(r.path,init);
    if(r.k==='ops')return await opsRoute(r.path,init);
    if(r.k==='catalogAdmin')return await catalogAdminRoute(init);
    if(r.k==='errors')return await errorsRoute(r.path,init);
    if(r.k==='knowledge'&&String(init?.method||'GET').toUpperCase()==='GET')return jsonResponse([]);
    return appError(`${r.k}: этот модуль ещё не подключён к стабильному Mini App`,410);
  }catch(e){
    console.error('[PCS backend adapter]',r.k,r.path,e);
    return appError(e?.message||'Ошибка PCS backend',503);
  }
};
})();
