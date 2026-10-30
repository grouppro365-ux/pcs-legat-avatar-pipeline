import {CrmError} from './crm-policy.mjs';
import {readTelegramPublicationWidget} from './content-publication-verify.mjs';
const MAX=9223372036854775807n;
export function parseTelegramViews(display){
 if(typeof display!=='string'||display.length>24)return null;
 const exact=/^(0|[1-9][0-9]{0,18})$/.exec(display);
 if(exact){if(BigInt(display)>MAX)return null;return {display,exact:display,estimate:null,approximate:false};}
 const compact=/^(0|[1-9][0-9]{0,18})(?:\.([0-9]{1,2}))?([KM])$/.exec(display);
 if(!compact)return null;
 const digits=compact[2]||'',scale=compact[3]==='K'?1000n:1000000n;
 const estimate=(BigInt(compact[1])*10n**BigInt(digits.length)+BigInt(digits||'0'))*scale/(10n**BigInt(digits.length));
 if(estimate>MAX)return null;
 return {display,exact:null,estimate:String(estimate),approximate:true};
}
export function widgetViews(block){
 const spans=[...String(block).matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span\s*>/gi)].filter(m=>{
  const classes=m[1].match(/(?:^|\s)class\s*=\s*(["'])(.*?)\1/i)?.[2];
  return classes?.split(/\s+/).includes('tgme_widget_message_views');
 });
 if(spans.length!==1)return {views:null,reason:spans.length?'counter_ambiguous':'counter_missing'};
 // No guessed units, grouping separators, markup, or fallback to neighbouring posts.
 const display=spans[0][2].trim();
 const views=parseTelegramViews(display);
 return {views,reason:views?'counter_observed':'counter_unreadable'};
}
export async function observeTelegramPerformance(snapshot,options){
 if(typeof snapshot?.snapshot_signature!=='string'||!/^[a-f0-9]{32}$/.test(snapshot.snapshot_signature))throw new CrmError('Не получен актуальный снимок материала',502);
 const {evidence,block}=await readTelegramPublicationWidget(snapshot,options);
 let observation={views:null,reason:evidence.outcome==='TEXT_MISMATCH'?'text_mismatch':evidence.reason};
 if(evidence.outcome==='TEXT_MATCH')observation=widgetViews(block);
 return {...evidence,method:'public_telegram_views_v1',outcome:observation.views?'OBSERVED':'UNAVAILABLE',reason:observation.reason,views:observation.views,snapshot_signature:snapshot.snapshot_signature};
}
export async function observeContentPerformance(biz,b,actor,permissions,options){
 const params=[JSON.stringify(b),String(actor),JSON.stringify(permissions)],query='select pcs.content_observe_performance($1::jsonb,$2,$3::jsonb,$4::jsonb) result';
 try{
  const prepare=(await biz.query(query,[...params,null]))[0]?.result;
  if(prepare?.observation_required!==true){if(prepare?.ok!==true)throw new CrmError('Не получено подтверждение наблюдения',502);return prepare;}
  const observation=await observeTelegramPerformance(prepare.snapshot,options);
  const result=(await biz.query(query,[...params,JSON.stringify(observation)]))[0]?.result;
  if(result?.ok!==true||typeof result.id!=='string'||result.id.toLowerCase()!==String(b.id).toLowerCase()||!result.observation)throw new CrmError('Не получено подтверждение сохранения наблюдения. Повторите ту же команду.',502);
  return result;
 }catch(error){if(error.code==='42883')throw new CrmError('Наблюдение просмотров ещё не подключено. Обновите приложение позже.',503);throw error;}
}
