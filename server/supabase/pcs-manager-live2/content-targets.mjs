import {CrmError} from './crm-policy.mjs';
import {publicationTelegramApi} from './telegram-api.mjs';
const usernamePattern=/^[a-z][a-z0-9_]{3,31}$/;
const positive=value=>Number.isSafeInteger(value)&&value>0;
// Read-only capability inspection using the existing PCS bot; no send method exists here.
export async function readPublicationBotToken(base,key,transport=fetch){
 try{
  const secretResponse=await transport(base+'/rest/v1/rpc/pcs_secret_get',{method:'POST',headers:{apikey:key,authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({p_name:'telegram_bot_token'}),signal:AbortSignal.timeout(10000),redirect:'error'});
  if(!secretResponse.ok)throw Error('config_missing');const token=await secretResponse.json();
  if(typeof token!=='string'||!/^\d{5,20}:[A-Za-z0-9_-]{20,200}$/.test(token))throw Error('config_missing');
  return token;
 }catch{throw new CrmError('Не удалось прочитать настройки существующего PCS-бота.',503);}
}
export async function inspectTelegramTargetWithToken(token,snapshot,transport=fetch){
 if(!usernamePattern.test(snapshot?.username||''))throw new CrmError('Укажите публичное имя Telegram-канала',400);
 try{
  const api=publicationTelegramApi(token,transport);
  const read=(method,body={})=>method==='getMe'?api.raw.getMe():api.raw[method](body);
  const bot=await read('getMe');if(!positive(bot.id)||bot.is_bot!==true)throw Error('invalid_bot');
  const chat=await read('getChat',{chat_id:'@'+snapshot.username});
  if(chat.type!=='channel'||!Number.isSafeInteger(chat.id)||chat.id>=0||typeof chat.username!=='string'||chat.username.toLowerCase()!==snapshot.username||typeof chat.title!=='string'||!chat.title.trim()||chat.title.length>256)throw Error('invalid_channel');
  const member=await read('getChatMember',{chat_id:String(chat.id),user_id:bot.id});
  if(member.user?.id!==bot.id||member.status!=='administrator'||member.can_post_messages!==true)throw Error('post_right_missing');
  return {username:snapshot.username,chat_id:String(chat.id),bot_id:String(bot.id),title:chat.title.trim(),can_post_messages:true};
 }catch{throw new CrmError('Не удалось подтвердить канал и право бота на публикацию. Проверьте публичное имя канала и права существующего PCS-бота, затем повторите проверку.',409);}
}
export async function inspectTelegramTarget(base,key,snapshot,transport=fetch){
 if(!usernamePattern.test(snapshot?.username||''))throw new CrmError('Укажите публичное имя Telegram-канала',400);
 let token;try{token=await readPublicationBotToken(base,key,transport);}catch{throw new CrmError('Не удалось подтвердить канал и право бота на публикацию. Проверьте настройки существующего PCS-бота.',409);}
 return inspectTelegramTargetWithToken(token,snapshot,transport);
}

export async function verifyContentTarget(biz,input,actor,permissions,inspect){
 const args=[JSON.stringify(input),String(actor),JSON.stringify(permissions)],sql='select pcs.content_target_action($1::jsonb,$2,$3::jsonb,$4::jsonb) result';
 const prepared=(await biz.query(sql,[...args,null]))[0]?.result;
 if(prepared?.verification_required!==true){if(prepared?.ok!==true||!prepared.target)throw new CrmError('Не получено подтверждение канала',502);return prepared;}
 if(!inspect||prepared.snapshot?.username!==input.username||prepared.snapshot?.brand_id!==input.brand_id)throw new CrmError('Проверка канала недоступна. Назначение не сохранено.',503);
 const observation=await inspect(prepared.snapshot);
 const result=(await biz.query(sql,[...args,JSON.stringify(observation)]))[0]?.result;
 if(result?.ok!==true||!result.target||result.target.brand_id!==input.brand_id||result.target.username!==input.username)throw new CrmError('Не получено подтверждение сохранения канала. Повторите ту же команду.',502);
 return result;
}
