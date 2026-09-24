import { createClient } from 'jsr:@supabase/supabase-js@2';
import { neon } from 'npm:@neondatabase/serverless@1.0.1';
import { readOperationalAvailability } from './operational-availability.mjs';
import { findVehicleBooking, createVehicleBooking } from '../_shared/vehicle-booking.mjs';
import { rentalEnd, rentalDays, parseRentalRange } from '../_shared/rental-period.mjs';
import { processMessage } from '../_shared/message-processing.mjs';
import { specificVehicleIntent, specificVehicleModel } from './vehicle-model.mjs';
import { publicVehicleName, securityDepositLine, vehicleOffersReply, isBookingConfirmation, selectedVehicleReply, bookingPaymentReply } from './vehicle-offer.mjs';
import { offerPhotos } from './catalog-photo.mjs';
import { validateBookingFinalization, operationalBookingProjection } from './booking-finalize.mjs';
const sb=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
const V7='https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-business-runtime-v7';
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{'content-type':'application/json;charset=utf-8'}});
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const replyRuns=new WeakMap();
async function managedReply(m:any,c:any,work:any){
  if(!m.business_connection_id||!Number.isSafeInteger(m.message_id)||!Number.isSafeInteger(m.chat?.id))throw Error('message_identity_missing');
  return processMessage({db:sb,channel:'telegram',key:'runtime:'+JSON.stringify([m.business_connection_id,String(m.chat.id),String(m.message_id)]),
    handle:async(run:any)=>{replyRuns.set(m,run);try{return await work()}finally{replyRuns.delete(m)}},
    send:(out:any)=>tg('sendMessage',out.request),
    record:async(out:any,receipt:any)=>{m._pcs_offer=out.offer;await saveOut(m,c,receipt,out.text,out.source);if(out.source==='qualification_engine_v4'&&out.offer?.intent==='car_rent')await sendOfferMedia(m,c,out.offer)},
    review:(eventId:string)=>task(c.id,'Проверить доставку ответа · '+eventId,'Не удалось однозначно подтвердить доставку. Проверить переписку перед повторной отправкой. Событие Conversation Hub: '+eventId)
  });
}
async function managedSend(m:any,text:string,source:string,extra:any={}){
  const run=replyRuns.get(m);if(!run)throw Error('message_processing_context_missing');
  return run.send({text,source,offer:m._pcs_offer||null,request:{business_connection_id:m.business_connection_id,chat_id:String(m.chat.id),text,...extra}});
}
async function sec(n:string){const {data,error}=await sb.rpc('pcs_secret_get',{p_name:n});if(error)throw error;return data||''}
async function tg(method:string,p:any){const token=await sec('telegram_bot_token');if(!token)throw new Error('telegram_token_missing');const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(p)});const j=await r.json();if(!r.ok||!j.ok)throw new Error(j?.description||`Telegram ${r.status}`);return j.result}
async function markRead(m:any){if(!m?.business_connection_id||!m?.chat?.id||!m?.message_id)return;try{await tg('readBusinessMessage',{business_connection_id:m.business_connection_id,chat_id:String(m.chat.id),message_id:m.message_id})}catch(e){console.error('readBusinessMessage',e)}}
const clean=(s:any)=>String(s||'').replace(/[—–]/g,'-').replace(/\s{2,}/g,' ').trim();
const greetingLike=(s='')=>/(^|[.!?\s])(здравствуй(?:те)?|привет(?:ствую)?|доброе\s+(?:утро|день)|добрый\s+(?:день|вечер)|hello|hi|good\s+(?:morning|afternoon|evening))([.!?,\s]|$)/iu.test(s);
const emojiOnly=(s='')=>!!s.trim()&&/\p{Extended_Pictographic}/u.test(s)&&!/[\p{L}\p{N}]/u.test(s);
function emojiAction(s=''){if(/[👋]/u.test(s))return'Здравствуйте! Чем можем помочь?';if(/[🤝]/u.test(s))return'Спасибо за сотрудничество! Если понадобится помощь, мы на связи.';if(/[🤔❓❔]/u.test(s))return'Что хотите уточнить? Поможем разобраться.';if(/[😞😔😢😭😡😠🤬👎]/u.test(s))return'Мне жаль, что возникла проблема. Расскажите, что пошло не так — поможем решить.';if(/[🙌🙏👏]/u.test(s))return'Спасибо! Рады помочь. Если понадобится что-то ещё, напишите.';if(/[😂🤣😄😁]/u.test(s))return'Рады, что подняли настроение! Чем ещё можем помочь?';if(/[❤❤️😍🥰😘]/u.test(s))return'Спасибо за тёплый отклик! Мы на связи.';if(/[🔥🎉🥳]/u.test(s))return'Спасибо! Рады за вас. Если нужна помощь с дальнейшими планами, напишите.';return'Спасибо за сообщение! Чем можем помочь?'}
const ready=(t='')=>/(готов.{0,20}оплат|оплатить|оплата|предоплат|депозит|реквизит|куда.{0,20}плат|как.{0,20}оплат|payment|pay now|ready to pay|pagare|pagamento|pagar|paiement|bezahlen|zahlung|付款|支付|支払|決済|결제|입금|ชำระ|จ่าย|опла)/iu.test(t);
const SERVICE_CATALOG:any={housing_rent:'housing_rent',housing_buy:'housing_buy',car_rent:'car_rent',car_buy:'car_buy',bike_rent:'bike_rent',transfer:'transfer',tour:'tour',yacht:'yacht',cleaning:'cleaning',repair:'repair',internet:'internet',education:'education',medical:'medical',dentistry:'dentistry',legal:'legal',business_support:'business_support'};
const SENSITIVE=new Set(['visa','bank','legal','medical','dentistry','emergency','complaint','partnership']);
function cityFrom(s=''){const t=String(s||'').toLowerCase();if(/паттай|pattaya/u.test(t))return'Паттайя';if(/пхукет|phuket/u.test(t))return'Пхукет';if(/бангкок|bangkok/u.test(t))return'Бангкок';if(/самуи|samui/u.test(t))return'Самуи';if(/чианг\s*май|chiang\s*mai/u.test(t))return'Чиангмай';return''}
function budgetNum(s=''){const t=String(s||'');const m=t.match(/(?:бюджет|budget)\s*(?:до\s*)?([\d\s.,]{1,14})\s*(млн|миллион(?:а|ов)?|тыс(?:яч)?|k)?\s*(?:бат|thb|฿|bht|руб|rub|usd|eur)?|([\d\s.,]{1,14})\s*(млн|миллион(?:а|ов)?|тыс(?:яч)?|k)\s*(?:бат|thb|฿|bht|руб|rub|usd|eur)\b|([\d\s.,]{2,14})\s*(?:бат|thb|฿|bht|руб|rub|usd|eur)\b/iu);if(!m)return 0;const raw=String(m[1]||m[3]||m[5]||'').replace(/[^\d.,]/g,'').replace(',','.');const base=Number(raw);if(!Number.isFinite(base))return 0;const unit=String(m[2]||m[4]||'').toLowerCase();const mult=/млн|миллион/.test(unit)?1000000:/тыс|k/.test(unit)?1000:1;const value=Math.round(base*mult);return value>=100&&value<=100000000?value:0}
function budgetText(n:number){return n?`${new Intl.NumberFormat('ru-RU').format(n)} бат`:''}
function dateIso(d:Date){return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
const RENT_MONTHS:any={января:0,январь:0,january:0,jan:0,февраля:1,февраль:1,february:1,feb:1,марта:2,март:2,march:2,mar:2,апреля:3,апрель:3,april:3,apr:3,мая:4,май:4,may:4,июня:5,июнь:5,june:5,jun:5,июля:6,июль:6,july:6,jul:6,августа:7,август:7,august:7,aug:7,сентября:8,сентябрь:8,september:8,sep:8,октября:9,октябрь:9,october:9,oct:9,ноября:10,ноябрь:10,november:10,nov:10,декабря:11,декабрь:11,december:11,dec:11};
function rentalRangeFrom(s=''){return parseRentalRange(s)}
function startDateFrom(s=''){const txt=String(s||'').toLowerCase(),range=rentalRangeFrom(txt);if(range)return range.start;const monthMap:any=RENT_MONTHS;let m=txt.match(/(?:с|заезд|от|from|дата|date|на)\s*(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?/u)||txt.match(/\b(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?\b/u);if(m){let y=m[3]?Number(m[3]):new Date().getFullYear();if(y<100)y+=2000;return dateIso(new Date(y,Number(m[2])-1,Number(m[1]),12))}m=txt.match(/(?:с|заезд|от|from|дата|на)?\s*(\d{1,2})\s*(января|январь|февраля|февраль|марта|март|апреля|апрель|мая|май|июня|июнь|июля|июль|августа|август|сентября|сентябрь|октября|октябрь|ноября|ноябрь|декабря|декабрь)/u);if(m){let y=new Date().getFullYear();const mo=monthMap[m[2]];let d=new Date(y,mo,Number(m[1]),12);if(d.getTime()<Date.now()-7*86400000)d=new Date(y+1,mo,Number(m[1]),12);return dateIso(d)}return''}
function endDateFrom(start:string,duration:string){return rentalEnd(start,duration)}
function durationFrom(s=''){const t=String(s||'').toLowerCase(),range=rentalRangeFrom(t);if(range)return range.duration;if(/на\s+месяц|1\s*мес|месяц|one\s+month|for\s+a\s+month|monthly/u.test(t))return'на месяц';const m=t.match(/на\s*(\d+)\s*(дн|день|дня|дней|сут|суток|day|days)/u);if(m)return`${m[1]} дней`;const w=t.match(/на\s*(\d+)\s*(нед|недел|week|weeks)/u);if(w)return`${w[1]} недель`;return''}
function roomsFrom(s=''){const t=String(s||'').toLowerCase();const m=t.match(/(\d+)\s*(?:комнат|комн|room|rooms|bedroom|br|спальн)/u);if(m)return Number(m[1]);if(/one[-\s]?bedroom|1b\b/u.test(t))return 1;if(/two[-\s]?bedroom|2b\b/u.test(t))return 2;return 0}
function peopleFrom(s=''){const t=String(s||'').toLowerCase();const m=t.match(/(\d+)\s*(?:чел|человек|персон|people|pax|гост|пассажир)/u);return m?Number(m[1]):0}
function vehicleTypeFrom(s=''){const t=String(s||'').toLowerCase();if(/suv|кроссов|джип/u.test(t))return'SUV';if(/седан|sedan/u.test(t))return'седан';if(/минивен|minivan|van/u.test(t))return'минивен';if(/байк|скутер|scooter|motorbike/u.test(t))return'байк/скутер';return''}
function vehicleModelFrom(s=''){const t=String(s||''),specific=specificVehicleModel(t);if(specific)return specific;const m=t.match(/\b(yaris|ярис|vios|виос|jazz|джаз|city|сити|almera|альмера|juke|жук|corolla|королла|camry|камри)\b/iu);return m?clean(m[0]):''}
function serviceDetailFrom(intent:string,s=''){const t=String(s||'').toLowerCase();if(intent==='visa'){if(/dtv/u.test(t))return'DTV';if(/ltr/u.test(t))return'LTR';if(/ed|студ|учеб/u.test(t))return'ED visa';if(/пенсион/u.test(t))return'пенсионная виза';return''}if(intent==='bank'){if(/сч[её]т|account/u.test(t))return'открытие счёта';return''}if(intent==='medical'){if(/страх|insurance/u.test(t))return'страховка/медицина';if(/врач|doctor|клиник|hospital/u.test(t))return'врач/клиника';return''}if(intent==='dentistry'){if(/чистк|cleaning/u.test(t))return'чистка';if(/имплант|implant/u.test(t))return'имплантация';if(/зуб|боль|pain/u.test(t))return'стоматология';return''}if(intent==='legal'){if(/договор|contract/u.test(t))return'договор';if(/права|license|водит/u.test(t))return'права/документы';return''}return''}
function pointFrom(s='',kind:'from'|'to'){const t=String(s||'');const re=kind==='from'?/(?:из|откуда|from|pickup|забрать)\s+([^,.;\n]+)/iu:/(?:в|куда|to|drop.?off|до)\s+([^,.;\n]+)/iu;const m=t.match(re);return m?clean(m[1]):''}
function fallbackIntent(t=''){t=String(t||'').toLowerCase();if(/купить.*(квартир|дом|condo|apartment)|недвиж.*куп|buy.*(condo|apartment|house)/u.test(t))return'housing_buy';if(/купить.*(авто|машин)|car.*buy|buy.*car/u.test(t))return'car_buy';const specificIntent=specificVehicleIntent(t);if(specificIntent)return specificIntent;if(/машин|авто|car\b|vehicle|rent.*car|аренд.*авто/u.test(t))return'car_rent';if(/квартир|жиль|апартамент|condo|apartment|housing|accommodation|вилл|дом/u.test(t))return'housing_rent';if(/байк|скутер|bike\b|motorbike|scooter/u.test(t))return'bike_rent';if(/виз|visa|dtv|ltr|tm-?30/u.test(t))return'visa';if(/банк|bank|сч[её]т/u.test(t))return'bank';if(/медицин|врач|hospital|medical|doctor|клиник/u.test(t))return'medical';if(/стомат|зуб|dent/u.test(t))return'dentistry';if(/трансфер|transfer|такси|airport|аэропорт/u.test(t))return'transfer';if(/юрист|договор|legal|lawyer|контракт/u.test(t))return'legal';if(/школ|образован|school|education|садик/u.test(t))return'education';if(/уборк|cleaning|клининг/u.test(t))return'cleaning';if(/ремонт|repair|почин/u.test(t))return'repair';if(/интернет|wifi|router/u.test(t))return'internet';if(/экскурс|tour|trip/u.test(t))return'tour';if(/яхт|yacht|boat/u.test(t))return'yacht';if(/бизнес|company|регистрац.*компан/u.test(t))return'business_support';if(/жалоб|refund|complaint|возврат/u.test(t))return'complaint';if(/срочно|экстрен|emergency|urgent/u.test(t))return'emergency';return'other'}
async function contactFor(m:any){const chatId=Number(m.chat.id),bc=String(m.business_connection_id);const name=[m.from?.first_name,m.from?.last_name].filter(Boolean).join(' ')||m.from?.username||String(chatId);let {data:c,error}=await sb.from('pcs_contacts').select('*').eq('telegram_chat_id',chatId).maybeSingle();if(error)throw error;if(!c){const up=await sb.from('pcs_contacts').upsert({telegram_id:m.from?.id||chatId,telegram_chat_id:chatId,business_connection_id:bc,username:m.from?.username||null,name,preferred_channel:'telegram',language:m.from?.language_code||null,last_contact_at:new Date().toISOString()},{onConflict:'telegram_chat_id'}).select('*').single();if(up.error)throw up.error;c=up.data}return c}
async function saveIn(m:any,c:any,text:any,intent='other'){
  const lookup=()=>sb.from('pcs_messages').select('id,created_at,chat_id,raw').eq('business_connection_id',m.business_connection_id).eq('telegram_message_id',m.message_id).eq('direction','in').maybeSingle();
  const recover=(row:any)=>{
    if(String(row.chat_id)!==String(m.chat.id))throw Error('message_identity_collision');
    return replyRuns.get(m)?.eventId&&row.raw?._pcs_event_id===replyRuns.get(m).eventId?row:null;
  };
  const found=await lookup();if(found.error)throw found.error;if(found.data)return recover(found.data);
  const name=[m.from?.first_name,m.from?.last_name].filter(Boolean).join(' ')||m.from?.username||String(m.chat.id);
  const {data,error}=await sb.from('pcs_messages').insert({telegram_message_id:m.message_id,business_connection_id:m.business_connection_id,chat_id:m.chat.id,contact_id:c.id,direction:'in',text:text||null,status:'received',raw:{...m,_pcs_event_id:replyRuns.get(m)?.eventId||null},contact_name:name,intent}).select('id,created_at').single();
  if(error?.code==='23505'){const existing=await lookup();if(existing.error)throw existing.error;if(existing.data)return recover(existing.data)}
  if(error)throw error;return data;
}
async function saveOut(m:any,c:any,sent:any,text:string,source='qualification_engine_v4'){
  const {error}=await sb.from('pcs_messages').insert({telegram_message_id:sent.message_id,business_connection_id:m.business_connection_id,chat_id:m.chat.id,contact_id:c.id,direction:'out',text,status:'sent',raw:{...sent,source,...(m._pcs_offer?{pcs_offer:m._pcs_offer}:{})},contact_name:c.name||c.username||null});
  if(error?.code==='23505'){
    const existing=await sb.from('pcs_messages').select('text,chat_id,contact_id').eq('business_connection_id',m.business_connection_id).eq('telegram_message_id',sent.message_id).eq('direction','out').maybeSingle();
    if(existing.error)throw existing.error;
    if(existing.data?.text!==text||String(existing.data?.chat_id)!==String(m.chat.id)||existing.data?.contact_id!==c.id)throw Error('outbound_receipt_collision');
  }else if(error)throw error;
  const updated=await sb.from('pcs_contacts').update({last_contact_at:new Date().toISOString()}).eq('id',c.id);if(updated.error)throw updated.error;
}
async function sendOfferMedia(m:any,c:any,offer:any){
  const ids=(offer.items||[]).map((x:any)=>x.id).filter(Boolean);
  if(!ids.length)return {sent:false,no_media:true};
  const {data,error}=await sb.from('pcs_catalog_media').select('id,catalog_item_id,media_type,public_url,customer_visible,sort_order').in('catalog_item_id',ids).eq('customer_visible',true).eq('media_type','photo').order('sort_order',{ascending:true}).limit(40);
  if(error)throw error;
  const photos=offerPhotos(offer,data||[]);
  if(!photos.length)return {sent:false,no_media:true};
  const key='runtime-media:'+JSON.stringify([m.business_connection_id,String(m.chat.id),String(m.message_id)]);
  return processMessage({db:sb,channel:'telegram',key,
    handle:async(run:any)=>{
      const method=photos.length===1?'sendPhoto':'sendMediaGroup';
      const request=photos.length===1?{business_connection_id:m.business_connection_id,chat_id:String(m.chat.id),photo:photos[0].url,caption:photos[0].caption}:{business_connection_id:m.business_connection_id,chat_id:String(m.chat.id),media:photos.map((x:any)=>({type:'photo',media:x.url,...(x.caption?{caption:x.caption}:{})}))};
      await run.send({method,request,photos});
      return {sent:true,photo_count:photos.length};
    },
    send:(out:any)=>tg(out.method,out.request),
    record:async(out:any,receipt:any)=>{
      const sent=Array.isArray(receipt)?receipt:[receipt];
      if(sent.length!==out.photos.length)throw Error('photo_receipt_count_mismatch');
      const photoMessage={...m,_pcs_offer:null};
      for(let i=0;i<sent.length;i++)await saveOut(photoMessage,c,sent[i],out.photos[i].caption||'', 'catalog_photo_v1');
    },
    review:(eventId:string)=>task(c.id,'Проверить доставку фото · '+eventId,'Не удалось подтвердить отправку фотографий. Сверить Telegram перед повторной попыткой.')
  });
}
async function ctxFor(c:any){const {data:h,error}=await sb.from('pcs_messages').select('direction,text,created_at,intent').eq('contact_id',c.id).not('text','is',null).order('created_at',{ascending:false}).limit(40);if(error)throw error;const active=c.intent&&c.intent!=='other'?String(c.intent):'other';const seg:any[]=[];for(const x of h||[]){const mi=String(x.intent||'other');if(x.direction==='in'&&mi!=='other'&&active!=='other'&&mi!==active)break;seg.push(x)}const txt=seg.filter((x:any)=>x.direction==='in').map((x:any)=>x.text).filter(Boolean).join('\n');return {history:h||[],segment:seg,txt,intent:active!=='other'?active:fallbackIntent(txt),city:c.city||cityFrom(txt),budget:budgetNum(txt),duration:durationFrom(txt),start:startDateFrom(txt),rooms:roomsFrom(txt),people:peopleFrom(txt),vehicle:vehicleTypeFrom(txt),model:vehicleModelFrom(txt),from:pointFrom(txt,'from'),to:pointFrom(txt,'to')}}
async function task(contactId:string,title:string,comment:string,priority='HIGH'){
  const {data:e,error}=await sb.from('pcs_tasks').select('id').eq('contact_id',contactId).eq('title',title).is('completed_at',null).limit(1).maybeSingle();
  if(error)throw error;
  if(!e){const inserted=await sb.from('pcs_tasks').insert({contact_id:contactId,title,comment,priority,due_at:new Date().toISOString()});if(inserted.error)throw inserted.error}
}
function knownLine(p:any){const a=[];if(p.city)a.push(p.city);if(p.duration)a.push(p.duration);if(p.budget)a.push(`бюджет ${budgetText(p.budget)}`);if(p.start)a.push(`дата/заезд ${p.start}`);if(p.rooms)a.push(`${p.rooms} комнаты`);if(p.model)a.push(p.model);else if(p.vehicle)a.push(p.vehicle);if(p.people)a.push(`${p.people} чел.`);if(p.from)a.push(`откуда: ${p.from}`);if(p.to)a.push(`куда: ${p.to}`);if(p.detail)a.push(p.detail);return a.join(', ')}
const LABEL:any={housing_rent:'жильё',housing_buy:'недвижимость для покупки',car_rent:'авто',car_buy:'авто для покупки',bike_rent:'байк',visa:'визовый вопрос',bank:'банк',medical:'медицина',dentistry:'стоматология',transfer:'трансфер',legal:'юридический вопрос/документы',education:'образование',cleaning:'клининг',repair:'ремонт',internet:'интернет',tour:'экскурсия',yacht:'яхта',business_support:'бизнес-сопровождение',emergency:'срочный вопрос',complaint:'обращение'};
function requirements(intent:string,p:any){if(intent==='housing_rent')return [['city','город/район'],['duration','срок'],['start','дату заезда'],['budget','бюджет'],['rooms','количество комнат']];if(intent==='housing_buy')return [['city','город/район'],['budget','бюджет'],['rooms','тип/количество комнат']];if(intent==='car_rent'||intent==='bike_rent')return [['city','город'],['duration','срок'],['start','дату начала аренды']];if(intent==='car_buy')return [['city','город'],['budget','бюджет'],['vehicle','тип/модель авто']];if(intent==='transfer')return [['from','откуда забрать'],['to','куда ехать'],['start','дату/время'],['people','количество пассажиров']];if(intent==='tour'||intent==='yacht')return [['city','город/локацию'],['start','дату'],['people','количество человек'],['budget','ориентир по бюджету']];if(intent==='visa')return [['detail','тип визы или задачу'],['start','дедлайн/дату, к которой нужно решить вопрос']];if(intent==='bank')return [['city','город'],['detail','что нужно: счёт, карта, перевод или другое']];if(intent==='medical'||intent==='dentistry')return [['city','город'],['detail','какая услуга или проблема'],['start','когда удобно/срочность']];if(intent==='legal'||intent==='education'||intent==='cleaning'||intent==='repair'||intent==='internet'||intent==='business_support')return [['city','город'],['detail','что именно нужно'],['start','когда нужно']];return [['detail','что именно нужно']]}
function emptyCtx(ctx:any,c:any){return {...ctx,txt:'',budget:0,duration:'',start:'',rooms:0,people:0,vehicle:'',model:'',from:'',to:'',city:c.city||''}}
function applyExtract(intent:string,p:any,text:string,ctx:any){p.city=cityFrom(text)||ctx.city||'';const rental=['housing_rent','car_rent','bike_rent'].includes(intent),range=rental?rentalRangeFrom(text):null;p.duration=rental?(range?.duration||durationFrom(text)||ctx.duration||''):'';p.start=range?.start||startDateFrom(text)||ctx.start||'';p.budget=budgetNum(text)||ctx.budget||0;p.rooms=(intent==='housing_rent'||intent==='housing_buy')?(roomsFrom(text)||ctx.rooms||0):0;p.people=(intent==='transfer'||intent==='tour'||intent==='yacht')?(peopleFrom(text)||ctx.people||0):0;p.model=(intent==='car_rent'||intent==='car_buy')?(vehicleModelFrom(text)||ctx.model||''):'';p.vehicle=(intent==='car_rent'||intent==='car_buy'||intent==='bike_rent')?(vehicleTypeFrom(text)||ctx.vehicle||''):'';if(intent==='transfer'){p.from=pointFrom(text,'from')||ctx.from||'';p.to=pointFrom(text,'to')||ctx.to||''}else{p.from='';p.to=''}p.detail=serviceDetailFrom(intent,text)||serviceDetailFrom(intent,ctx.txt)||'';if((intent==='housing_rent'||intent==='housing_buy')&&/мебел|furnished|furniture|с мебель/iu.test(text+' '+ctx.txt))p.detail=clean([p.detail,'меблированная'].filter(Boolean).join(', '));p.end=range?.end||(p.start&&p.duration?endDateFrom(p.start,p.duration):'');return p}
function followupSignal(text:string,ctx:any){if(fallbackIntent(text)!=='other')return true;if(cityFrom(text)||durationFrom(text)||startDateFrom(text)||budgetNum(text)||roomsFrom(text)||peopleFrom(text)||vehicleTypeFrom(text)||vehicleModelFrom(text))return true;if(/мебел|furnished|furniture|с мебель/iu.test(text))return true;if(/^\s*\d{1,3}\s*$/u.test(text)&&ctx.intent&&ctx.intent!=='other')return true;return false}
let operationalDbPromise:Promise<any>|null=null;
async function operationalDb(){
  if(!operationalDbPromise)operationalDbPromise=(async()=>{
    const {data,error}=await sb.rpc('pcs_edge_runtime_config');
    if(error||!data?.business_neon_database_url)throw new Error('operational_database_unavailable');
    return neon(data.business_neon_database_url);
  })().catch(error=>{operationalDbPromise=null;throw error});
  return await operationalDbPromise;
}
async function operationalFree(itemId:string,start:string,end:string){
  try{return await readOperationalAvailability(await operationalDb(),itemId,start,end)}
  catch{console.error('operational_availability_unavailable');return false}
}
async function queueBookingConfirmation(id:string){
  const {error}=await sb.from('pcs_booking_confirmation_outbox').insert({request_id:id});
  if(error&&error.code!=='23505')throw error;
}
async function finalizeBookingRequest(id:string){
  if(!/^[0-9a-f-]{36}$/i.test(id))throw Error('invalid_booking_request_id');
  const {data:r,error:re}=await sb.from('pcs_booking_requests').select('*').eq('id',id).single();
  if(re||!r)throw Error('booking_request_not_found');
  if(r.status==='booked'&&r.reservation_id){
    const existing=await findVehicleBooking(await operationalDb(),'booking:telegram:'+r.contact_id+':'+r.offer_id);
    if(!existing||String(existing.id)!==String(r.reservation_id))throw Error('booking_operational_identity_mismatch');
    const current=operationalBookingProjection(existing.status);
    if(current.requestStatus!=='booked')throw Error('booking_operational_status_not_confirmed');
    await queueBookingConfirmation(id);
    return{request_id:id,reservation_id:r.reservation_id,public_id:existing.public_id,operational_status:current.operationalStatus,status:'booked',already_recorded:true};
  }
  if(r.status!=='ready_for_booking')throw Error('booking_request_not_verified');
  const {data:finance,error:fe}=await sb.from('pcs_finance_entries').select('id,contact_id,amount,currency,status,paid_at,payment_kind,metadata,reservation_id').eq('id',r.finance_entry_id).single();
  if(fe)throw fe;
  const {data:item,error:ie}=await sb.from('pcs_catalog_items').select('id,status,ownership_type,customer_visible,deleted_at').eq('id',r.catalog_item_id).single();
  if(ie)throw ie;
  const documentIds=[r.passport_media_intake_id,r.permit_media_intake_id].filter(Boolean);
  const {data:intakes,error:documentError}=documentIds.length?await sb.from('pcs_media_intake').select('id,contact_id,classification,review_status,extracted').in('id',documentIds):{data:[],error:null};
  if(documentError)throw documentError;
  validateBookingFinalization(r,finance,item,intakes);
  const {data:contact,error:ce}=await sb.from('pcs_contacts').select('id,name,phone,username,telegram_chat_id').eq('id',r.contact_id).single();
  if(ce||!contact)throw Error('booking_contact_missing');
  const key='booking:telegram:'+r.contact_id+':'+r.offer_id;
  const db=await operationalDb();
  let booking=await findVehicleBooking(db,key);
  if(!booking){
    if(item.status!=='available'||item.customer_visible!==true||item.deleted_at)throw Error('booking_vehicle_no_longer_available');
    const {data:conflict,error:conflictError}=await sb.rpc('pcs_reservation_conflicts',{p_item:r.catalog_item_id,p_start:r.start_date,p_end:r.end_date,p_exclude:null});
    if(conflictError||conflict!==false)throw Error('booking_supabase_dates_conflict');
    if(!await readOperationalAvailability(db,r.catalog_item_id,r.start_date,r.end_date))throw Error('booking_operational_dates_conflict');
    booking=await createVehicleBooking(db,{key,offerId:r.offer_id,itemId:r.catalog_item_id,clientId:r.contact_id,name:contact.name,contact:contact.phone||contact.username||String(contact.telegram_chat_id||''),start:r.start_date,end:r.end_date,total:r.rental_total,currency:r.currency});
  }
  if(!/^[0-9a-f-]{36}$/i.test(String(booking.id))||booking.item_id&&booking.item_id!==r.catalog_item_id)throw Error('booking_operational_identity_mismatch');
  const {operationalStatus:state,reservationStatus,requestStatus}=operationalBookingProjection(booking.status);
  const reservationId=String(booking.id);
  if(finance.reservation_id&&finance.reservation_id!==reservationId)throw Error('booking_payment_link_conflict');
  const {error:projectionError}=await sb.from('pcs_reservations').upsert({id:reservationId,contact_id:r.contact_id,catalog_item_id:r.catalog_item_id,source:'neon_contract_projection',status:reservationStatus,start_date:r.start_date,end_date:r.end_date,total_amount:r.rental_total,deposit_amount:r.booking_deposit_amount,currency:r.currency,payment_status:'partial',customer_confirmed_at:r.created_at,updated_at:new Date().toISOString()},{onConflict:'id'});
  if(projectionError)throw projectionError;
  const {error:financeError}=await sb.from('pcs_finance_entries').update({reservation_id:reservationId,updated_at:new Date().toISOString()}).eq('id',finance.id);
  if(financeError)throw financeError;
  const {error:updateError}=await sb.from('pcs_booking_requests').update({reservation_id:reservationId,status:requestStatus,updated_at:new Date().toISOString()}).eq('id',r.id).eq('status','ready_for_booking');
  if(updateError)throw updateError;
  if(requestStatus==='booked')await queueBookingConfirmation(id);
  await sb.from('pcs_audit_logs').insert({actor:'pcs-business-runtime-v8',action:'booking_operational_created',entity_type:'pcs_booking_requests',entity_id:r.id,payload:{reservation_id:reservationId,operational_status:state,request_status:requestStatus}});
  return{request_id:id,reservation_id:reservationId,public_id:booking.public_id,operational_status:state,status:requestStatus};
}
async function availableItems(intent:string,p:any){const cat=SERVICE_CATALOG[intent];if(!cat)return[];const {data,error}=await sb.from('pcs_catalog_items').select('id,title,description,city,location,status,monthly_price,daily_price,weekly_price,base_price,price,currency,customer_visible,deleted_at,unavailable_until,availability_note,metadata').eq('category',cat).eq('status','available').eq('customer_visible',true).is('deleted_at',null).limit(80);if(error)throw error;const out:any[]=[];for(const x of data||[]){const hay=[x.title,x.description,x.city,x.location,JSON.stringify(x.metadata||{})].join(' ').toLowerCase();if(p.city&&cityFrom(x.city||x.location||hay)!==cityFrom(p.city)&&!hay.includes(String(p.city).toLowerCase()))continue;if(p.model&&!hay.includes(String(p.model).toLowerCase()))continue;if(x.unavailable_until&&p.start&&new Date(x.unavailable_until)>new Date(p.start+'T00:00:00'))continue;let price=Number(x.monthly_price||x.daily_price||x.weekly_price||x.base_price||x.price||0);let quote:any=null;if(intent==='car_rent'){if(!p.start||!p.end)continue;try{const result=await sb.rpc('pcs_booking_quote',{p_item:x.id,p_start:p.start,p_end:p.end});quote=result.data;if(result.error||quote?.ok!==true||quote.manual_required||!Number.isFinite(Number(quote.total_before_extras))||Number(quote.total_before_extras)<=0)continue;price=Number(quote.total_before_extras)}catch{continue}if(p.budget&&price>p.budget)continue}else if(p.budget&&price&&intent.includes('rent')&&price>p.budget*1.25)continue;if(intent==='housing_rent'&&p.rooms&&!(new RegExp(`(^|\\D)${p.rooms}(\\D|$)|${p.rooms}\\s*(комн|room|bedroom|br)|${p.rooms}b`,'iu').test(hay)))continue;let free=true;if(p.start&&p.end){try{const {data:conf,error:conflictError}=await sb.rpc('pcs_reservation_conflicts',{p_item:x.id,p_start:p.start,p_end:p.end,p_exclude:null});free=!conflictError&&conf===false}catch{free=false}}if(free&&intent==='car_rent')free=await operationalFree(x.id,p.start,p.end);if(free)out.push({...x,display_price:price,rental_quote:quote})}return out.slice(0,3)}
function itemText(p:any,items:any[]){return items.map((x,i)=>`${i+1}. ${x.rental_quote?publicVehicleName(x.title):x.title}\n${x.location||x.city||''}\n${x.display_price?`${new Intl.NumberFormat('ru-RU').format(x.display_price)} ${x.currency||'THB'}`:'цену уточним'}${x.rental_quote?` за аренду ${p.start} — ${p.end} (без дополнительных услуг)`:(x.monthly_price?'/мес':'')}${x.rental_quote?securityDepositLine(x.metadata,x.currency||'THB'):''}${x.availability_note?`\n${x.availability_note}`:''}`).join('\n\n')}
function nextQuestion(key:string,label:string,p:any){if(key==='start'&&/этой\s+недел|на\s+неделе|this\s+week/iu.test(p.requestText||''))return'На какой день этой недели планируете?';const q:any={city:'В каком городе или районе ищете?',duration:'На какой срок?',start:'С какой даты?',budget:'Какой бюджет?',rooms:'Сколько комнат нужно?',people:'Сколько будет человек?',vehicle:'Какой тип или модель автомобиля нужна?',from:'Откуда вас забрать?',to:'Куда нужно ехать?',detail:'Какая именно задача?'};return q[key]||`Подскажите: ${label}?`}
function cityWhere(city=''){if(/бангкок|bangkok/iu.test(city))return' в Бангкоке';if(/паттай|pattaya/iu.test(city))return' в Паттайе';if(/пхукет|phuket/iu.test(city))return' на Пхукете';return city?` в ${city}`:''}
function needsReply(intent:string,p:any,miss:any[]){const lead:any={housing_rent:'Помогу подобрать жильё',housing_buy:'Помогу подобрать недвижимость',car_rent:'Помогу подобрать автомобиль',car_buy:'Помогу подобрать автомобиль',bike_rent:'Помогу подобрать байк',transfer:'Организуем трансфер',tour:'Подберём экскурсию',yacht:'Подберём яхту'};const [key,title]=miss[0]||[];return `${p.greet?'Здравствуйте! ':''}${lead[intent]||'Разберёмся'}${cityWhere(p.city)}. ${nextQuestion(key,title,p)}`}
function noItemsReply(intent:string,p:any){return `Проверим свободные варианты${cityWhere(p.city)} на ваши даты и вернёмся сюда с конкретными предложениями.`}
function foundItemsReply(intent:string,p:any,items:any[]){if(intent==='car_rent')return vehicleOffersReply({start:p.start,end:p.end,days:rentalDays(p.start,p.end)},items,p.city||'');return `Вот подходящие варианты. Наличие и итоговые условия подтвердим перед бронью:\n\n${itemText(p,items)}\n\nКакой вариант вам нравится?`}
async function sameRecentReply(contactId:string,text:string){const {data,error}=await sb.from('pcs_messages').select('text,created_at').eq('contact_id',contactId).eq('direction','out').not('text','is',null).order('created_at',{ascending:false}).limit(1).maybeSingle();if(error)throw error;if(!data||String(data.text)!==text)return false;return Date.now()-new Date(data.created_at).getTime()<90000}
function offeredIndex(text:string){const m=String(text||'').trim().match(/^(?:(?:вариант|выбираю|беру|номер)\s*)?([1-9])\s*[.!]?$/iu);return m?Number(m[1])-1:null}
async function handleOfferSelection(m:any){
  const message=String(m.text||m.caption||'');
  const index=offeredIndex(message),confirming=isBookingConfirmation(message);
  if(index===null&&!confirming)return null;
  const c=await contactFor(m);if(c.intent!=='car_rent')return null;
  const {data:last,error}=await sb.from('pcs_messages').select('id,raw,created_at').eq('contact_id',c.id).eq('direction','out').not('raw->pcs_offer','is',null).order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(error)throw error;let offer=last?.raw?.pcs_offer;
  if(!offer||offer.intent!=='car_rent'||!Array.isArray(offer.items))return null;
  return managedReply(m,c,async()=>{
    m._pcs_offer={...offer,id:offer.id||last.id,created_at:offer.created_at||last.created_at};
    const saved=await saveIn(m,c,message,'car_rent');if(!saved)return {duplicate:true};
    // A resumed response stays tied to the exact offer visible when it was received.
    offer=saved.raw?._pcs_offer||m._pcs_offer;
    const selectedIndex=confirming?Number(offer.selected_index):index;
    const selected=offer.items[selectedIndex],offerId=offer.id||last.id,key='booking:telegram:'+c.id+':'+offerId;
    if(!offerId)throw Error('offer_identity_missing');
    const db=await operationalDb();
    const existing=await findVehicleBooking(db,key);
    let reply='',booking:any=null;
    if(existing){
      booking=existing;
      reply=existing.status==='CANCELLED_BY_CLIENT'||existing.status==='CANCELLED_BY_PARTNER'?
        'Эта бронь уже отменена. Напишите даты аренды — подготовлю новое предложение.':
        'По этому предложению уже есть бронь '+existing.public_id+'. Вторую не создаю.';
    }else if(confirming&&!['awaiting_confirmation','awaiting_documents'].includes(offer.stage)){
      reply='Сначала выберите автомобиль из предложенных вариантов. Одного подтверждения без выбора недостаточно.';
    }else if(!selected){
      reply='Не нашёл такой вариант в предложении. Напишите номер от 1 до '+offer.items.length+'.';
    }else if(Date.now()-new Date((confirming&&offer.selected_at)||offer.created_at||last.created_at).getTime()>24*3600000){
      reply='Предложение устарело. Напишите даты ещё раз — проверю цену и наличие.';
    }else{
      const {data:item,error:itemError}=await sb.from('pcs_catalog_items').select('id,title,status,customer_visible,deleted_at,ownership_type,metadata').eq('id',selected.id).maybeSingle();
      if(itemError)throw itemError;
      const {data:conflict,error:conflictError}=await sb.rpc('pcs_reservation_conflicts',{p_item:selected.id,p_start:offer.start,p_end:offer.end,p_exclude:null});
      const {data:quote,error:quoteError}=await sb.rpc('pcs_booking_quote',{p_item:selected.id,p_start:offer.start,p_end:offer.end});
      if(!item||item.status!=='available'||!item.customer_visible||item.deleted_at||conflictError||conflict!==false||!(await operationalFree(selected.id,offer.start,offer.end))){
        reply='Пока не могу подтвердить доступность этой машины. Напишите даты ещё раз — подберу другой вариант.';
      }else if(quoteError||quote?.ok!==true||quote.manual_required||!Number.isFinite(Number(selected.total))||Number(selected.total)<=0||Number(quote.total_before_extras)!==Number(selected.total)||(quote.currency||'THB')!==selected.currency){
        reply='Цена изменилась или требует проверки. Подготовлю новое предложение — бронь не создаю.';
      }else if(item.ownership_type!=='pcs_owned'){
        await task(c.id,'Подтвердить выбор у партнёра','Клиент выбрал '+item.title+'. Нужны подтверждённые условия партнёра.');
        reply='Вы выбрали '+publicVehicleName(item.title)+'. Уточню доступность и условия у партнёра. Пока ничего не забронировано.';
      }else if(!confirming){
        const {error:updateError}=await sb.from('pcs_contacts').update({requested_catalog_item_id:selected.id,next_action:'Клиент выбрал автомобиль; ожидаем согласия на оформление с документами и предоплатой'}).eq('id',c.id);
        if(updateError)throw updateError;
        m._pcs_offer={...offer,id:offerId,stage:'awaiting_confirmation',selected_index:selectedIndex,selected_at:new Date().toISOString()};
        reply=selectedVehicleReply(offer,selected,item);
      }else{
        const {data:prior,error:priorError}=await sb.from('pcs_booking_requests').select('id,status,booking_deposit_amount').eq('contact_id',c.id).eq('offer_id',offerId).maybeSingle();
        if(priorError)throw priorError;
        let request=prior;
        if(!request){
          const {data:created,error:createError}=await sb.from('pcs_booking_requests').insert({contact_id:c.id,offer_id:offerId,catalog_item_id:selected.id,start_date:offer.start,end_date:offer.end,rental_total:selected.total,currency:selected.currency}).select('id,status,booking_deposit_amount').single();
          if(createError?.code==='23505'){
            const {data:again,error:againError}=await sb.from('pcs_booking_requests').select('id,status,booking_deposit_amount').eq('contact_id',c.id).eq('offer_id',offerId).single();
            if(againError)throw againError;
            request=again;
          }else if(createError)throw createError;
          else request=created;
        }
        if(!prior&&request?.status==='collecting'){
          await task(c.id,'Подготовить бронь собственного автомобиля','Заявка '+request.id+'. Клиент согласился перейти к оформлению '+publicVehicleName(item.title)+'. Проверить паспорт и именно МВУ; согласовать сумму бронировочной предоплаты для этой заявки, затем проверить поступление денег. Не подтверждать бронь по сообщению или чеку без проверки.','HIGH');
          await notifyAdmin('Новая заявка на '+publicVehicleName(item.title)+' ('+offer.start+' — '+offer.end+'). Укажите предоплату отдельно для этой заявки: /bdeposit '+request.id+' СУММА. Паспорт, МВУ и платёж требуют проверки.',{inline_keyboard:[[{text:'Открыть клиента',callback_data:'client:'+c.id}]]});
        }
        const {error:updateError}=await sb.from('pcs_contacts').update({requested_catalog_item_id:selected.id,next_action:'Заявка '+request.id+': проверить паспорт и МВУ, назначить предоплату и подтвердить поступление'}).eq('id',c.id);
        if(updateError)throw updateError;
        m._pcs_offer={...offer,id:offerId,stage:'awaiting_documents',selected_index:selectedIndex,selected_at:offer.selected_at,booking_request_id:request.id};
        reply=request.status==='booked'?'Бронь по этому запросу уже оформлена. Повторно её не создаю.':`Приняла заявку на ${publicVehicleName(item.title)}. Для оформления пришлите, пожалуйста, фото паспорта и международного водительского удостоверения (МВУ). После проверки документов сообщим точную сумму бронировочной предоплаты и реквизиты. Залог за сохранность автомобиля не равен предоплате. Бронь будет подтверждена только после проверки поступления оплаты; пока машина не забронирована.`;
      }
    }
    await managedSend(m,reply,'catalog_booking_v2');
    return {sent:true,booking_id:booking?.id||null,awaiting_confirmation:m._pcs_offer?.stage==='awaiting_confirmation'};
  });
}
async function handleEmoji(m:any){const text=String(m.text||m.caption||'').trim();if(!emojiOnly(text))return null;const c=await contactFor(m);return managedReply(m,c,async()=>{const saved=await saveIn(m,c,text,c.intent||'other');if(!saved)return {sent:false,duplicate:true};const reply=emojiAction(text);await managedSend(m,reply,'emoji_response_v2',{reply_parameters:{message_id:m.message_id,allow_sending_without_reply:true}});return {sent:true,emoji_reply:true,reply}});}
async function handleQualification(m:any){const text=String(m.text||m.caption||'').trim();if(!text)return null;const c=await contactFor(m);const ctx=await ctxFor(c);const explicit=fallbackIntent(text);const intent=explicit!=='other'?explicit:ctx.intent;const switched=explicit!=='other'&&ctx.intent!=='other'&&explicit!==ctx.intent;if(intent==='other'||(!followupSignal(text,ctx)&&explicit==='other'))return null;return managedReply(m,c,async()=>{const saved=await saveIn(m,c,text,intent);if(!saved)return {sent:false,duplicate:true,intent};const base=switched?emptyCtx(ctx,c):ctx;const p=applyExtract(intent,{intent},text,base);const savedAt=new Date(saved.created_at).getTime();p.greet=greetingLike(text)||(ctx.history||[]).some((x:any)=>x.direction==='in'&&greetingLike(String(x.text||''))&&savedAt-new Date(x.created_at).getTime()>=0&&savedAt-new Date(x.created_at).getTime()<=10000);p.requestText=[ctx.txt,text].filter(Boolean).join('\\n');const req=requirements(intent,p);const miss=req.filter(([k]:any)=>!p[k]);const patch:any={intent,city:p.city||c.city||null,budget:p.budget?budgetText(p.budget):(switched?null:c.budget),need:clean([LABEL[intent],knownLine(p)].filter(Boolean).join(': ')),summary:null,last_contact_at:new Date().toISOString()};if(switched){patch.selected_catalog_item_id=null;patch.requested_catalog_item_id=null}let reply='';if(miss.length){reply=needsReply(intent,p,miss);patch.next_action=`Уточнить: ${miss.map((x:any)=>x[1]).join(', ')}`;}else if(SENSITIVE.has(intent)){reply=noItemsReply(intent,p);patch.next_action='Проверить подтверждённые данные и ответить клиенту';await task(c.id,`Проверить ${LABEL[intent]||intent}`,`Параметры клиента: ${knownLine(p)}. Не отправлять неподтверждённые данные.`,'HIGH');}else{const items=await availableItems(intent,p);if(items.length){reply=foundItemsReply(intent,p,items);patch.next_action='Клиенту отправлены доступные варианты';if(intent==='car_rent'){patch.selected_catalog_item_id=null;patch.requested_catalog_item_id=null;m._pcs_offer={id:crypto.randomUUID(),created_at:new Date().toISOString(),intent,start:p.start,end:p.end,items:items.map((x:any)=>({id:x.id,title:x.title,total:x.display_price,currency:x.currency||'THB'}))}}}else{reply=noItemsReply(intent,p);patch.next_action='Уточнить свободные варианты';await task(c.id,`Уточнить варианты: ${LABEL[intent]||intent}`,`Параметры клиента: ${knownLine(p)}`,'HIGH');}}const {error:patchError}=await sb.from('pcs_contacts').update(patch).eq('id',c.id);if(patchError)throw patchError;await wait(1600);const {data:latestInbound,error:latestError}=await sb.from('pcs_messages').select('id').eq('contact_id',c.id).eq('direction','in').order('created_at',{ascending:false}).limit(1).maybeSingle();if(latestError)throw latestError;if(latestInbound?.id&&latestInbound.id!==saved.id)return {sent:false,superseded_by_newer_inbound:true,intent};if(await sameRecentReply(c.id,reply))return {sent:false,dedup_reply:true,intent,reply};await managedSend(m,reply,'qualification_engine_v4');return {sent:true,intent,reply,switched};});}
async function handleSticker(m:any){const c=await contactFor(m);return managedReply(m,c,async()=>{const saved=await saveIn(m,c,null,c.intent||'other');if(!saved)return {sent:false,duplicate:true};const ctx=await ctxFor(c);let reply='Здравствуйте. Чем помочь в Таиланде? Напишите, что нужно: жильё, авто/байк, визы, медицина, трансфер, документы, бизнес или другое.';if(ctx.intent&&ctx.intent!=='other'){const p=applyExtract(ctx.intent,{intent:ctx.intent},'',ctx);const miss=requirements(ctx.intent,p).filter(([k]:any)=>!p[k]);reply=miss.length?needsReply(ctx.intent,p,miss):noItemsReply(ctx.intent,p);}if(await sameRecentReply(c.id,reply))return {sent:false,dedup_reply:true};await managedSend(m,reply,'sticker_qualification_v3');return {sent:true,reply}});}
async function forward(req:Request,body:any){const h=new Headers({'content-type':'application/json'});const secret=req.headers.get('x-telegram-bot-api-secret-token');if(secret)h.set('x-telegram-bot-api-secret-token',secret);const r=await fetch(V7,{method:'POST',headers:h,body:JSON.stringify(body)});const tx=await r.text();if(!r.ok)throw new Error(`v7_${r.status}:${tx.slice(0,400)}`);return tx}
async function contextFor(m:any){const {data:c}=await sb.from('pcs_contacts').select('id,name,username,detected_language,language,selected_catalog_item_id,requested_catalog_item_id').eq('telegram_chat_id',m.chat.id).maybeSingle();if(!c)return null;const itemId=c.selected_catalog_item_id||c.requested_catalog_item_id;if(!itemId)return {c,item:null};const {data:item}=await sb.from('pcs_catalog_items').select('id,title,ownership_type,partner_name,partner_contact,handoff_mode,status,payment_requires_approval').eq('id',itemId).maybeSingle();return {c,item}}
async function adminIds(){const {data:a}=await sb.from('pcs_admin_chats').select('chat_id').eq('enabled',true);if(a?.length)return a.map((x:any)=>x.chat_id);const {data:f}=await sb.from('pcs_telegram_connections').select('user_chat_id').eq('enabled',true).not('user_chat_id','is',null).order('updated_at',{ascending:false}).limit(1).maybeSingle();return f?.user_chat_id?[f.user_chat_id]:[]}
async function notifyAdmin(text:string,buttons:any){for(const id of await adminIds()){try{await tg('sendMessage',{chat_id:String(id),text:clean(text),reply_markup:{inline_keyboard:buttons}})}catch(e){console.error('notify_admin',e)}}}
function paymentText(r:any){const details=[r.recipient_name?`Recipient: ${r.recipient_name}`:'',r.contact?`Contact: ${r.contact}`:'',r.payment_details||''].filter(Boolean).join('\n');return clean(`Для оплаты используйте подтверждённые реквизиты PCS:\n\n${details}\n\nПосле оплаты пришлите чек в этот чат.`)}
async function savePaymentOut(m:any,c:any,text:string){const sent=await tg('sendMessage',{business_connection_id:m.business_connection_id,chat_id:String(m.chat.id),text});await saveOut(m,c,sent,text,'payment_route_v4')}
async function handleActiveBookingPayment(m:any){const text=String(m?.text||m?.caption||'');if(!ready(text))return null;const c=await contactFor(m);const {data:r,error}=await sb.from('pcs_booking_requests').select('id,booking_deposit_amount,payment_status').eq('contact_id',c.id).eq('status','collecting').order('created_at',{ascending:false}).limit(1).maybeSingle();if(error)throw error;if(!r)return null;return managedReply(m,c,async()=>{const saved=await saveIn(m,c,text,'car_rent');if(!saved)return{booking_request_id:r.id,duplicate:true};const reply=bookingPaymentReply(r);await managedSend(m,reply,'booking_payment_pending_v1');await notifyAdmin(`Клиент спрашивает об оплате по заявке ${r.id}. Проверьте документы, индивидуальную сумму предоплаты и реквизиты.`,[[{text:'👤 Клиент',callback_data:`pcadmin:${c.id}`}]]);return{booking_request_id:r.id,reply}})}
async function handlePayment(m:any){const text=String(m?.text||m?.caption||'');if(!ready(text))return null;const ctx=await contextFor(m);if(!ctx?.c||!ctx.item)return null;const {c,item}=ctx;const {data:bookingRequest,error:bookingError}=await sb.from('pcs_booking_requests').select('id,payment_status').eq('contact_id',c.id).eq('status','collecting').order('created_at',{ascending:false}).limit(1).maybeSingle();if(bookingError)throw bookingError;if(bookingRequest){await notifyAdmin(`Клиент готов к оплате по заявке ${bookingRequest.id}. Сумма предоплаты назначается отдельно; общий платёжный маршрут не отправлять без этой суммы.`,[[{text:'👤 Клиент',callback_data:`pcadmin:${c.id}`}]]);return {booking_request_id:bookingRequest.id,manual_amount_required:true}}if(item.ownership_type==='pcs_owned'){const {data:route}=await sb.from('pcs_payment_routes').select('id,title,recipient_name,contact,payment_details').eq('route_type','pcs_payment').eq('active',true).order('updated_at',{ascending:false}).limit(1).maybeSingle();if(route?.payment_details){const out=paymentText(route);await savePaymentOut(m,c,out);await sb.from('pcs_contacts').update({payment_route:'pcs_payment',next_action:'Ждём чек или подтверждение оплаты',last_contact_at:new Date().toISOString()}).eq('id',c.id);return {owned:true,sent:true}}}await notifyAdmin(`Клиент готов к оплате, нужна ручная проверка\n\nКлиент: ${c.name||c.username||m.chat.id}\nУслуга: ${item.title}\nСообщение: ${text.slice(0,500)}`,[[{text:'👤 Клиент',callback_data:`pcadmin:${c.id}`}]]);return {review:true}}
Deno.serve(async(req:Request)=>{if(req.method==='OPTIONS')return new Response(null,{status:204});if(req.method!=='POST')return J({error:'not_found'},404);try{if(new URL(req.url).pathname.endsWith('/booking-finalize')){const expectedInternal=await sec('internal_retry_secret');if(!expectedInternal||req.headers.get('x-pcs-internal-secret')!==expectedInternal)return J({error:'unauthorized'},401);const body=await req.json();return J({ok:true,result:await finalizeBookingRequest(String(body?.request_id||''))})}const expected=await sec('telegram_webhook_secret');if(!expected||req.headers.get('x-telegram-bot-api-secret-token')!==expected)return J({error:'unauthorized'},401);const body=await req.json();const m=body?.business_message;await markRead(m);if(m?.sticker){const sticker=await handleSticker(m);return J({ok:true,sticker,telegram_first:true})}if(m&&(m.text||m.caption)){const selection=await handleOfferSelection(m);if(selection)return J({ok:true,selection,telegram_first:true});const emoji=await handleEmoji(m);if(emoji)return J({ok:true,emoji,telegram_first:true});const bookingPayment=await handleActiveBookingPayment(m);if(bookingPayment)return J({ok:true,booking_payment:bookingPayment,telegram_first:true});const q=await handleQualification(m);if(q)return J({ok:true,qualification:q,telegram_first:true})}const upstream=await forward(req,body);let payment=null;try{if(m)payment=await handlePayment(m)}catch(e){console.error('payment_flow',e)}return J({ok:true,upstream:!!upstream,payment,telegram_first:true})}catch(e){return J({ok:false,error:e instanceof Error?e.message:String(e)},500)}});
