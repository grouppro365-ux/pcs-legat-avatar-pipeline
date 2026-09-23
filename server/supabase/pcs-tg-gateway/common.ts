import { createClient } from 'jsr:@supabase/supabase-js@2';
export const sb=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
export const RUNTIME='https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-business-runtime-v8';
export const MEDIA='https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-media-intake-v1';
export const WEBAPP='https://pcs-ai-operator-live-grouppro365-2288s-projects.vercel.app/';
export const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{'content-type':'application/json;charset=utf-8'}});
export const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
export async function sec(n:string){const {data,error}=await sb.rpc('pcs_secret_get',{p_name:n});if(error)throw error;return data||''}
export async function tg(method:string,p:any){const token=await sec('telegram_bot_token');if(!token)throw new Error('telegram_token_missing');const c=new AbortController(),tm=setTimeout(()=>c.abort(),20000);try{const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(p),signal:c.signal});const j=await r.json();if(!r.ok||!j.ok)throw new Error(j?.description||`Telegram ${r.status}`);return j.result}finally{clearTimeout(tm)}}
export async function isAdmin(chatId:any){const {data}=await sb.from('pcs_admin_chats').select('chat_id').eq('chat_id',Number(chatId)).eq('enabled',true).maybeSingle();return !!data}
export async function state(chatId:any){const {data}=await sb.from('pcs_admin_chat_state').select('mode,context').eq('chat_id',Number(chatId)).maybeSingle();return data||{mode:null,context:{}}}
export async function setState(chatId:any,mode:string|null,context:any={}){await sb.from('pcs_admin_chat_state').upsert({chat_id:Number(chatId),mode,context,updated_at:new Date().toISOString()},{onConflict:'chat_id'})}
export function adminKeyboard(){return {keyboard:[[{text:'🏠 Главная'},{text:'📨 Входящие'}],[{text:'👥 Клиенты'},{text:'📅 Брони'}],[{text:'🚗 Каталог'},{text:'🗓 Календарь'}],[{text:'💳 Финансы'},{text:'📚 База знаний'}],[{text:'⚙️ Подключения'},{text:'📊 Состояние'}],[{text:'📱 Открыть приложение',web_app:{url:WEBAPP}}]],resize_keyboard:true,one_time_keyboard:false,input_field_placeholder:'Сообщение или выберите раздел'}}
export const MENU_TEXTS=new Set(['🏠 Главная','📨 Входящие','👥 Клиенты','📅 Брони','🚗 Каталог','🗓 Календарь','💳 Финансы','📚 База знаний','⚙️ Подключения','📊 Состояние']);
export async function send(chatId:any,text:string,kb:any=null){return tg('sendMessage',{chat_id:String(chatId),text,...(kb?{reply_markup:kb}:{})})}
export const short=(s:any,n=90)=>{s=String(s??'').replace(/\s+/g,' ').trim();return s.length>n?s.slice(0,n-1)+'…':s};
export const st=(s:any)=>({NEW:'Новый',QUALIFYING:'Уточняем',QUALIFIED:'Квалифицирован',OFFER_SENT:'Предложение отправлено',WAITING_CLIENT:'Ждём клиента',IN_PROGRESS:'В работе',BOOKED:'Забронировано',PAID:'Оплачено',COMPLETED:'Завершено',LOST:'Потерян',requested:'Запрос',hold:'Предварительно',confirmed:'Подтверждено',active:'Активно',cancelled:'Отменено',available:'Доступно',checking:'На проверке',booked:'Забронировано',unavailable:'Недоступно',pending:'На проверке',paid:'Оплачено',unpaid:'Не оплачено'})[String(s)]||String(s||'—');
