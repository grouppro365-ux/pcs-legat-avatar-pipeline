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
const CATALOG_ADMIN='https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-catalog-admin';
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
  // The booking form must retain the actual tariff metadata returned by the
  // manager.  Reducing a daily rental to only client_price_thb made every
  // otherwise available car fail the direct-rental eligibility check.
  base_price_period:x.base_price_period??x.price_period??x.rate_period??null,
  price_period:x.price_period??x.base_price_period??x.rate_period??null,
  rate_period:x.rate_period??x.base_price_period??x.price_period??null,
  daily_price:x.daily_price??null,
  weekly_price:x.weekly_price??null,
  monthly_price:x.monthly_price??null,
  deposit:x.deposit??x.deposit_thb??null,
  currency:x.currency||'THB',
  media_items:x.media_items||(x.image_url?[{public_url:x.image_url}]:[])
});
const directBookable=x=>String(x?.status||x?.availability_status||'REQUIRES_CONFIRMATION').toLowerCase()==='available';
const hasDailyTariff=x=>['day','daily'].includes(String(x?.base_price_period??x?.price_period??x?.rate_period??'').toLowerCase())||Number(x?.daily_price)>0;
const directRental=x=>directBookable(x)&&String(x?.category||'').toLowerCase()==='car_rent'&&hasDailyTariff(x);
const cancelledReservation=x=>['cancelled','cancelled_by_client','declined','completed'].includes(String(x?.operational_status||x?.status||'').toLowerCase());
const datesOverlap=(aStart,aEnd,bStart,bEnd)=>aStart<bEnd&&bStart<aEnd;
const bookingStatusToServer={requested:'NEW',hold:'AWAITING_PARTNER_CONFIRMATION',confirmed:'CONFIRMED',active:'SERVICE_IN_PROGRESS',completed:'COMPLETED',cancelled:'CANCELLED_BY_CLIENT'};
const bookingStatusFromServer=s=>({NEW:'requested',AWAITING_PARTNER_CONFIRMATION:'hold',CONFIRMED:'confirmed',SERVICE_IN_PROGRESS:'active',COMPLETED:'completed',CANCELLED_BY_CLIENT:'cancelled',CANCELLED_BY_PARTNER:'cancelled',REJECTED:'cancelled',EXPIRED:'cancelled',FAILED:'cancelled'})[String(s||'NEW').toUpperCase()]||'requested';

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
  if(path==='/reservations'&&method==='GET')return jsonResponse((await manager('applications')).filter(x=>x.category==='booking'||(x.qualification_data?.start_date&&x.qualification_data?.end_date)).map(x=>({...x,status:bookingStatusFromServer(x.operational_status),start_date:x.qualification_data?.start_date||'',end_date:x.qualification_data?.end_date||'',total_amount:x.qualification_data?.total_amount??null,deposit_amount:x.qualification_data?.deposit_amount??null,currency:x.qualification_data?.currency||'THB',payment_status:Number(x.qualification_data?.deposit_amount||0)>0?'partial':'unpaid',pcs_catalog_items:{title:x.item_title||'Объект'},pcs_contacts:{name:x.client_name||x.client_contact||'Без клиента'}})));
  if(path==='/reservations'&&method==='POST'){
    const b=await parseBody(init);
    if(!b.catalog_item_id)return appError('Выберите объект из каталога.',400);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(b.start_date||''))||!/^\d{4}-\d{2}-\d{2}$/.test(String(b.end_date||''))||String(b.end_date)<=String(b.start_date))return appError('Дата возврата должна быть позже даты начала аренды.',400);
    const [catalog,applications,clients]=await Promise.all([manager('catalog'),manager('applications'),manager('clients')]);
    const item=catalog.find(x=>String(x.id)===String(b.catalog_item_id));
    if(!item)return appError('Объект не найден в каталоге. Обновите экран и повторите попытку.',404);
    if(!directRental(item))return appError('Для прямой брони доступен только автомобиль со статусом «Доступно» и посуточным тарифом.',409);
    const conflict=applications.find(x=>String(x.item_id||x.catalog_item_id||'')===String(b.catalog_item_id)&&!cancelledReservation(x)&&x.qualification_data?.start_date&&x.qualification_data?.end_date&&datesOverlap(String(b.start_date),String(b.end_date),String(x.qualification_data.start_date),String(x.qualification_data.end_date)));
    if(conflict)return appError('На выбранные даты уже есть активная бронь или холд. Проверьте календарь.',409);
    const status=bookingStatusToServer[b.status||'hold'];if(!status)return appError('Неизвестный статус брони.',400);
    const client=clients.find(x=>String(x.id)===String(b.contact_id||''));
    return jsonResponse(await manager('application-save',{method:'POST',body:{item_id:b.catalog_item_id||null,client_name:client?.name||client?.username||null,client_contact:client?.phone||client?.username||null,category:'booking',operational_status:status,priority:'NORMAL',internal_notes:b.notes||null,qualification_data:{start_date:b.start_date,end_date:b.end_date,total_amount:b.total_amount,deposit_amount:b.deposit_amount,currency:b.currency||'THB',contact_id:b.contact_id||null},photo:b.photo||null}}));
  }
  const reservationMatch=path.match(/^\/reservations\/([^/]+)$/);
  if(reservationMatch&&method==='PATCH'){
    const b=await parseBody(init),status=bookingStatusToServer[b.status],id=decodeURIComponent(reservationMatch[1]);
    if(!status)return appError('Неизвестный статус брони.',400);
    const existing=(await manager('applications')).find(x=>String(x.id)===id);
    if(!existing)return appError('Бронь не найдена.',404);
    await manager('application-status',{method:'POST',body:{id,status}});
    const updated=(await manager('applications')).find(x=>String(x.id)===id);
    if(updated?.operational_status!==status)return appError('Сервер не подтвердил изменение статуса.',502);
    return jsonResponse({ok:true,id});
  }
  if(path==='/extras'&&method==='GET')return jsonResponse(await manager('services'));
  if(path==='/duration-rules'&&method==='GET')return jsonResponse(await manager('durations'));
  if(path==='/seasonal-rules'&&method==='GET')return jsonResponse(await manager('seasons'));
  if(path==='/status'&&method==='GET')return jsonResponse(await manager('status'));
  if(path==='/payment-settings'&&method==='GET')return jsonResponse({configured:false});
  if(path.startsWith('/quote?'))return appError('Расчёт тарифа пока доступен после подтверждения правил цены.',409);
  return appError(`Операция ${method} ${path} пока не подключена к стабильному Mini App`,409);
}

async function catalogAdminProxy(body){
  const headers={'accept':'application/json','content-type':'application/json'};
  if(currentToken())headers.authorization='Bearer '+currentToken();
  const r=await nativeFetch(CATALOG_ADMIN,{method:'POST',headers,body:JSON.stringify(body),cache:'no-store'});
  const text=await r.text();let data={};
  try{data=text?JSON.parse(text):{}}catch{data={error:text||`HTTP ${r.status}`}}
  if(!r.ok)throw new Error(data?.error||data?.message||`HTTP ${r.status}`);
  return data;
}

async function saveCatalogPricing(body){
  const id=String(body.id||'');
  const price=Number(body.base_price);
  if(!id)throw new Error('Не выбрана карточка каталога');
  if(!Number.isFinite(price)||price<0)throw new Error('Укажите корректную цену');

  const detail=await manager('catalog-detail',{id});
  const item=detail.item||{};
  const hasDeposit=body.deposit_thb!==undefined&&body.deposit_thb!==null&&body.deposit_thb!=='';
  const deposit=hasDeposit?Number(body.deposit_thb):Number(item.deposit_thb??0);
  if(!Number.isFinite(deposit)||deposit<0)throw new Error('Укажите корректный депозит');
  const revision=detail.revision?.ui||detail.revision?.legacy||detail.revision?.legacy_extra||{};
  const saved=await manager('catalog-save',{method:'POST',body:{
    id,
    entity_type:item.entity_type,
    title:item.title,
    city:item.city,
    publication_status:item.publication_status,
    moderation_status:item.moderation_status,
    availability_status:item.availability_status,
    client_price_thb:price,
    deposit_thb:deposit,
    internal_net_thb:item.internal_net_thb,
    description:revision.description||'',
    category:revision.category||'',
    conditions:revision.conditions||'',
    source:revision.source||''
  }});
  const verified=await manager('catalog-detail',{id});
  if(Number(verified.item?.client_price_thb)!==price||Number(verified.item?.deposit_thb)!==deposit)throw new Error('Сервер не подтвердил сохранение цены и депозита');
  return {ok:true,item:{...saved.item,...verified.item,base_price:price,price,deposit:deposit,deposit_thb:deposit}};
}

async function catalogAdminRoute(init){
  const body=await parseBody(init);
  if(body.action==='pricing')return jsonResponse(await saveCatalogPricing(body));
  if(['delete','rules','upsert_rule','delete_rule'].includes(String(body.action||'')))return jsonResponse(await catalogAdminProxy(body));
  return appError('Это действие каталога пока не поддерживается в Mini App.',409);
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
