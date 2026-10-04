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

async function manager(op,{method='GET',body=null,id=null,params=null,auth=true}={}){
  const u=new URL(MANAGER);
  u.searchParams.set('op',op);
  if(id!=null)u.searchParams.set('id',String(id));
  if(params)for(const [key,value] of Object.entries(params))u.searchParams.set(key,String(value));
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
  if(!r.ok){const e=new Error(d?.error||d?.message||`HTTP ${r.status}`);e.code=d?.code;e.status=r.status;throw e;}
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
const positiveCatalogPrice=x=>[x?.daily_price,x?.final_price,x?.price,x?.base_price,x?.client_price_thb].map(Number).find(n=>Number.isFinite(n)&&n>0)||0;
const hasDailyTariff=x=>['day','daily'].includes(String(x?.base_price_period??x?.price_period??x?.rate_period??'').toLowerCase())||positiveCatalogPrice(x)>0;
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
  if(path.startsWith('/search')&&method==='GET'){const u=new URL(path,'https://pcs.invalid');if(u.pathname==='/search')return jsonResponse(await manager('search',{params:{q:u.searchParams.get('q')||'',scope:u.searchParams.get('scope')||'all',page:u.searchParams.get('page')||'0'}}));}
  if(path==='/session')return jsonResponse(await manager('session'));
  if(path==='/dashboard')return jsonResponse(await manager('dashboard'));
  if(path==='/crm'&&method==='GET')return jsonResponse(await manager('clients'));
  if(path.startsWith('/crm-tasks')&&method==='GET'){const u=new URL(path,'https://pcs.invalid');if(u.pathname==='/crm-tasks')return jsonResponse(await manager('tasks',{params:{view:u.searchParams.get('view')||'open',page:u.searchParams.get('page')||'0'}}));}

  let m=path.match(/^\/crm\/([^/]+)$/);
  if(m&&method==='GET')return jsonResponse(await manager('client',{id:decodeURIComponent(m[1])}));
  if(m&&method==='PATCH')return jsonResponse(await manager('client-save',{id:decodeURIComponent(m[1]),method:'POST',body}));

  m=path.match(/^\/crm\/([^/]+)\/(send|followup)$/);
  if(m&&method==='POST'){
    const text=body.text||body.message||body.answer||'';
    if(!String(text).trim())return appError('Введите текст сообщения',400);
    return jsonResponse(await manager('send',{id:decodeURIComponent(m[1]),method:'POST',body:{text:String(text),request_id:body.request_id}}));
  }
  m=path.match(/^\/crm\/([^/]+)\/tasks\/([^/]+)$/);
  if(m&&method==='GET')return jsonResponse(await manager('task',{id:decodeURIComponent(m[1]),params:{task_id:decodeURIComponent(m[2])}}));
  if(m&&method==='PATCH'){if(Object.hasOwn(body,'task_id')&&body.task_id!==decodeURIComponent(m[2]))return appError('Номер задачи не совпадает',400);return jsonResponse(await manager('task-update',{id:decodeURIComponent(m[1]),method:'POST',body:{...body,task_id:decodeURIComponent(m[2])}}));}
  m=path.match(/^\/crm\/([^/]+)\/tasks$/);
  if(m&&method==='POST')return jsonResponse(await manager('task-create',{id:decodeURIComponent(m[1]),method:'POST',body}));
  m=path.match(/^\/crm\/([^/]+)\/complete-task\/([^/]+)$/);
  if(m&&method==='POST')return jsonResponse(await manager('task-complete',{id:decodeURIComponent(m[1]),method:'POST',body:{task_id:decodeURIComponent(m[2])}}));
  if(/^\/crm\/[^/]+\/selected-media$/.test(path))return appError('Отправка выбранного медиа ещё не подключена к стабильному Mini App.',409);
  if(/^\/crm\/[^/]+\/(tasks|complete-task|action)/.test(path))return appError('Изменение CRM из этого экрана пока ограничено безопасным режимом.',409);

  if(path==='/catalog'&&method==='GET')return jsonResponse((await manager('catalog')).map(normalizeCatalog));
  m=path.match(/^\/catalog\/([^/]+)\/media(?:\/([^/]+))?$/);
  if(m){
    const id=decodeURIComponent(m[1]),mid=m[2]?decodeURIComponent(m[2]):null;
    const detail=await manager('catalog-detail',{id});
    if(!detail.item||String(detail.item.id)!==id)return appError('Запись не найдена',404);
    const gallery=detail.media||[];
    if(mid==='order'&&method==='POST'){
      const ids=Array.isArray(body.ids)?body.ids:[];
      if(ids.length!==gallery.length||new Set(ids).size!==ids.length||ids.some(value=>!gallery.some(photo=>String(photo.id)===String(value))))return appError('Список фото изменился. Обновите галерею.',409);
      return jsonResponse(await manager('media-order',{method:'POST',body:{ids}}));
    }
    if(method==='GET'&&!mid)return jsonResponse(gallery);
    if(method==='POST'&&!mid){
      if(gallery.length>=30)return appError('Лимит 30 фото достигнут',400);
      if(!['image/jpeg','image/png','image/webp'].includes(body.content_type))return appError('Разрешены JPG, PNG и WEBP',400);
      const data=String(body.content_base64||'').replace(/^data:[^,]+,/,'');
      if(!data||data.length>Math.ceil(10*1024*1024/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))return appError('Некорректный файл или размер больше 10 МБ',400);
      return jsonResponse(await manager('media-add',{method:'POST',body:{item_id:id,
        filename:body.filename||'image.jpg',content_type:body.content_type,content_base64:data,
        media_type:'image',sort_order:gallery.length}}));
    }
    if(method==='DELETE'){
      const ids=[...new Set(mid?[mid]:(Array.isArray(body.ids)?body.ids:[]))];
      if(!ids.length||ids.some(value=>!gallery.some(photo=>String(photo.id)===String(value))))return appError('Выберите фото именно этой записи',400);
      const deleted=[];
      for(const photoId of ids){
        try{await manager('media-delete',{method:'POST',body:{id:photoId}});deleted.push(photoId)}
        catch(e){return jsonResponse({error:'Удалена только часть фото. Обновите список перед повтором.',deleted},409)}
      }
      return jsonResponse({ok:true,deleted});
    }
  }
  m=path.match(/^\/catalog\/([^/]+)$/);
  if(m&&method==='GET')return jsonResponse(await manager('catalog-detail',{id:decodeURIComponent(m[1])}));
  if(m&&method==='PATCH'){
    const id=decodeURIComponent(m[1]);
    const detail=await manager('catalog-detail',{id});
    const item=detail.item;
    if(!item||String(item.id)!==id)return appError('Запись не найдена',404);
    const revision=item.revision?.ui||item.revision?.legacy||item.revision?.legacy_extra||{};
    const payload={id,entity_type:item.entity_type,title:item.title,city:item.city,
      publication_status:item.publication_status,moderation_status:item.moderation_status,
      availability_status:item.availability_status,client_price_thb:item.client_price_thb,
      deposit_thb:item.deposit_thb,internal_net_thb:item.internal_net_thb,
      description:revision.description||'',category:revision.category||'',
      conditions:revision.conditions||'',source:revision.source||''};
    for(const key of ['title','city','description','conditions','source']){
      if(Object.prototype.hasOwnProperty.call(body,key))payload[key]=String(body[key]??'').trim();
    }
    if(!payload.title)return appError('Укажите название',400);
    await manager('catalog-save',{method:'POST',body:payload});
    const verified=await manager('catalog-detail',{id});
    const saved=verified.item;
    const savedRevision=saved?.revision?.ui||{};
    if(!saved||['title','city'].some(key=>saved[key]!==payload[key])||
      ['description','conditions','source'].some(key=>(savedRevision[key]||'')!==payload[key])){
      return appError('Сервер не подтвердил сохранение. Обновите запись перед повтором.',409);
    }
    return jsonResponse({ok:true,item:normalizeCatalog({...saved,media_items:verified.media||[]})});
  }
  if(path.startsWith('/approvals')&&method==='GET'){const u=new URL(path,'https://pcs.invalid');if(u.pathname==='/approvals')return jsonResponse(await manager('approvals',{params:{page:u.searchParams.get('page')||'0'}}));}
  const approvalRoute=path.match(/^\/approvals\/([A-Za-z0-9_-]{1,128})\/(send|reject)$/);
  if(approvalRoute){
    if(method!=='POST')return appError('Метод не поддерживается.',405);
    return jsonResponse(await manager('approval-action',{method:'POST',body:{id:approvalRoute[1],action:approvalRoute[2],expected_version:body.expected_version,...(approvalRoute[2]==='send'?{text:body.text}:{})}}));
  }
  if(/^\/approvals\//.test(path))return appError('Согласование не найдено.',404);
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
  if(path.startsWith('/finance')&&method==='GET'){const u=new URL(path,'https://pcs.invalid');if(u.pathname==='/finance')return jsonResponse(await manager('finance',{params:{source:u.searchParams.get('source')||'ledger',status:u.searchParams.get('status')||'all',page:u.searchParams.get('page')||'0'}}));}
  const reservationRows=()=>manager('applications').then(rows=>rows.filter(x=>x.category==='booking'||(x.qualification_data?.start_date&&x.qualification_data?.end_date)).map(x=>({...x,status:bookingStatusFromServer(x.operational_status),start_date:x.qualification_data?.start_date||'',end_date:x.qualification_data?.end_date||'',total_amount:x.qualification_data?.total_amount??null,deposit_amount:x.qualification_data?.deposit_amount??null,currency:x.qualification_data?.currency||'THB',payment_status:Number(x.qualification_data?.deposit_amount||0)>0?'partial':'unpaid',pcs_catalog_items:{title:x.item_title||'Объект'},pcs_contacts:{name:x.client_name||x.client_contact||'Без клиента'}})));
  if(path==='/reservations'&&method==='GET')return jsonResponse(await reservationRows());
  if(path.startsWith('/calendar?')&&method==='GET'){
    const query=new URL(path,'https://pcs.local').searchParams,from=query.get('from')||'',to=query.get('to')||'',validDate=x=>/^\d{4}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(Date.parse(x))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
    if(!validDate(from)||!validDate(to)||to<from)return appError('Укажите корректный период календаря.',400);
    return jsonResponse((await reservationRows()).filter(x=>x.start_date&&x.end_date&&x.start_date<=to&&x.end_date>=from&&!cancelledReservation(x)));
  }
  if(path==='/reservations'&&method==='POST'){
    const b=await parseBody(init);
    if(!b.catalog_item_id)return appError('Выберите объект из каталога.',400);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(b.start_date||''))||!/^\d{4}-\d{2}-\d{2}$/.test(String(b.end_date||''))||String(b.end_date)<=String(b.start_date))return appError('Дата возврата должна быть позже даты начала аренды.',400);
    const [catalog,applications,clients]=await Promise.all([manager('catalog'),manager('applications'),manager('clients')]);
    const rawItem=catalog.find(x=>String(x.id)===String(b.catalog_item_id));
    if(!rawItem)return appError('Объект не найден в каталоге. Обновите экран и повторите попытку.',404);
    // The manager can return entity_type=VEHICLE without a legacy category.
    // Apply the same catalog normalization used by the booking form before
    // validating the direct-rental policy.
    const item=normalizeCatalog(rawItem);
    if(!directRental(item))return appError('Для прямой брони доступен только автомобиль со статусом «Доступно» и посуточным тарифом.',409);
    const conflict=applications.find(x=>String(x.item_id||x.catalog_item_id||'')===String(b.catalog_item_id)&&!cancelledReservation(x)&&x.qualification_data?.start_date&&x.qualification_data?.end_date&&datesOverlap(String(b.start_date),String(b.end_date),String(x.qualification_data.start_date),String(x.qualification_data.end_date)));
    if(conflict)return appError('На выбранные даты уже есть активная бронь или холд. Проверьте календарь.',409);
    const status=bookingStatusToServer[b.status||'hold'];if(!status)return appError('Неизвестный статус брони.',400);
    const client=clients.find(x=>String(x.id)===String(b.contact_id||''));
    return jsonResponse(await manager('application-save',{method:'POST',body:{item_id:b.catalog_item_id||null,client_name:client?.name||client?.username||null,client_contact:client?.phone||client?.username||null,category:'booking',operational_status:status,priority:'NORMAL',internal_notes:b.notes||null,qualification_data:{start_date:b.start_date,end_date:b.end_date,total_amount:b.total_amount,deposit_amount:b.deposit_amount,currency:b.currency||'THB',contact_id:b.contact_id||null},photo:b.photo||null}}));
  }
  const reservationMatch=path.match(/^\/reservations\/([^/]+)$/);
  if(reservationMatch&&method==='PATCH'){
    const b=await parseBody(init),id=decodeURIComponent(reservationMatch[1]);
    const existing=await manager('application-detail',{id});
    if(String(existing.category||'')!=='booking')return appError('Это не бронь.',409);
    if(Object.keys(b).length===1&&b.status){
      const status=bookingStatusToServer[b.status];
      if(!status)return appError('Неизвестный статус брони.',400);
      await manager('application-status',{method:'POST',body:{id,status}});
      const updated=await manager('application-detail',{id});
      if(updated?.operational_status!==status)return appError('Сервер не подтвердил изменение статуса.',502);
      return jsonResponse({ok:true,id});
    }
    if(['SERVICE_IN_PROGRESS','COMPLETED','CANCELLED_BY_CLIENT','CANCELLED_BY_PARTNER'].includes(String(existing.operational_status||'')))return appError('Активную, завершённую или отменённую бронь нельзя менять здесь.',409);
    const item=String(b.catalog_item_id||''),start=String(b.start_date||''),end=String(b.end_date||''),currency=String(b.currency||'THB');
    const validDate=x=>/^\d{4}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(Date.parse(x))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
    const total=Number(b.total_amount),deposit=Number(b.deposit_amount);
    if(!item||!validDate(start)||!validDate(end)||end<=start)return appError('Выберите автомобиль и корректные даты; возврат должен быть позже выдачи.',400);
    if(!Number.isFinite(total)||total<0||!Number.isFinite(deposit)||deposit<0||(total>0&&deposit>total))return appError('Проверьте стоимость и предоплату.',400);
    if(!['THB','USD','RUB'].includes(currency))return appError('Неизвестная валюта.',400);
    const prior=existing.qualification_data||{},changedTerms=item!==String(existing.item_id||'')||start!==String(prior.start_date||'')||end!==String(prior.end_date||'');
    if(changedTerms){
      const catalog=(await manager('catalog')).find(x=>String(x.id)===item);
      if(!catalog||!directRental(normalizeCatalog(catalog)))return appError('Этот автомобиль нельзя выбрать для прямой аренды.',409);
      const checked=await manager('application-conflict',{params:{item,exclude:id,start,end}});
      if(checked.conflict)return appError('На выбранные даты уже есть активная бронь или холд.',409);
    }
    const contactId=String(b.contact_id||'');
    const client=contactId?(await manager('clients')).find(x=>String(x.id)===contactId):null;
    if(contactId&&!client)return appError('Клиент не найден. Обновите список.',404);
    const expectedStatus=changedTerms?'AWAITING_PARTNER_CONFIRMATION':existing.operational_status;
    const expectedData={...prior,start_date:start,end_date:end,total_amount:total,deposit_amount:deposit,currency,contact_id:contactId||null};
    await manager('application-save',{method:'POST',body:{id,item_id:item,client_name:client?.name||client?.username||existing.client_name||null,client_contact:client?.phone||client?.username||existing.client_contact||null,category:'booking',city:existing.city||null,operational_status:expectedStatus,priority:existing.priority||'NORMAL',client_visible_notes:existing.client_visible_notes||null,internal_notes:String(b.notes||''),qualification_data:expectedData}});
    const updated=await manager('application-detail',{id}),data=updated.qualification_data||{};
    if(String(updated.item_id)!==item||String(data.start_date)!==start||String(data.end_date)!==end||Number(data.total_amount)!==total||Number(data.deposit_amount)!==deposit||String(updated.operational_status)!==expectedStatus)return appError('Сервер не подтвердил сохранение брони.',502);
    return jsonResponse({ok:true,id,status:bookingStatusFromServer(expectedStatus)});
  }
  if(path==='/extras'&&method==='GET')return jsonResponse((await manager('services')).map(x=>({...normalizeCatalog(x),name:x.name||x.title||'Услуга'})));
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
  if(method==='GET'){const u=new URL(path||'/','https://pcs.invalid');if(u.pathname==='/')return jsonResponse(await manager('errors',{params:{source:u.searchParams.get('source')||'runtime',page:u.searchParams.get('page')||'0'}}));}
  return appError('Повтор требует проверки обработчика. Отправка с неизвестной доставкой не повторяется автоматически.',409);
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
    return jsonResponse({error:e?.message||'Ошибка PCS backend',code:e?.code},e?.status||503);
  }
};
})();

