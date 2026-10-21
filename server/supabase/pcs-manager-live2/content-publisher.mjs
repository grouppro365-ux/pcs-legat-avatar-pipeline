import {verifyContentPublication} from './content-publication-verify.mjs';
import {CrmError} from './crm-policy.mjs';
import {publicationTelegramApi,GrammyError} from './telegram-api.mjs';
import {readPublicationBotToken,inspectTelegramTargetWithToken} from './content-targets.mjs';
const idPattern=/^[1-9][0-9]{0,14}$/;
// One immutable claimed job is delivered at most once. Transport ambiguity is terminal.
export async function deliverTelegramPublication(base,key,job,transport=fetch){
 let token;
 try{
  if(typeof job.body!=='string'||!job.body.trim()||[...job.body].length>4096)throw Error('body_invalid');
  token=await readPublicationBotToken(base,key,transport);
  const current=await inspectTelegramTargetWithToken(token,{username:job.username},transport);
  if(current.chat_id!==job.chat_id||current.bot_id!==job.bot_id||current.username!==job.username)throw Error('target_changed');
 }catch{return {outcome:'REJECTED',reason:'target_preflight_failed'};}
 try{
  const m=await publicationTelegramApi(token,transport,15).raw.sendMessage({chat_id:job.chat_id,text:job.body});
  if(!Number.isSafeInteger(m?.message_id)||!idPattern.test(String(m.message_id))||!Number.isSafeInteger(m?.chat?.id)||String(m.chat.id)!==job.chat_id||m.chat.type!=='channel'||String(m.chat.username||'').toLowerCase()!==job.username||m.text!==job.body||!Number.isSafeInteger(m.date)||m.date<1||m.date>Date.now()/1000+300||Number.isFinite(Date.parse(job.claimed_at))&&m.date<Date.parse(job.claimed_at)/1000-300)return {outcome:'UNKNOWN',reason:'receipt_invalid'};
  return {outcome:'SENT',chat_id:job.chat_id,text:job.body,message_id:String(m.message_id),date:m.date};
 }catch(error){
  if(error instanceof GrammyError&&Number.isInteger(error.error_code)&&error.error_code>=400&&error.error_code<500&&error.error_code!==408)return {outcome:'REJECTED',reason:'provider_rejected'};
  return {outcome:'UNKNOWN',reason:'transport_unknown'};
 }
}
export async function scheduleContentPublication(biz,action,input,actor,permissions){
 const rows=await biz.query('select pcs.content_publication_action($1,$2::jsonb,$3,$4::jsonb) result',[action==='schedule-publication'?'schedule':'cancel',JSON.stringify(input),String(actor),JSON.stringify(permissions)]);
 const result=rows[0]?.result;if(!result?.ok||result.id!==input.id||!result.job)throw new CrmError('Не получено подтверждение плана публикации. Повторите ту же команду.',502);return result;
}
export async function dispatchContentPublication(biz,deliver,verify){
 const prepared=(await biz.query('select pcs.content_claim_publication() result',[]))[0]?.result;
 if(!prepared||!Object.hasOwn(prepared,'job'))throw Error('publication_claim_invalid');
 if(!prepared.job)return {claimed:0,sent:0,rejected:0,unknown:0};
 const job=prepared.job;
 if(typeof job.id!=='string'||typeof job.claim_id!=='string')throw Error('publication_claim_invalid');
 let result;try{result=await deliver(job);}catch{result={outcome:'UNKNOWN',reason:'transport_unknown'};}
 // Completion is separate from delivery. A failed save must never repeat sendMessage.
 try{
  const completed=(await biz.query('select pcs.content_complete_publication($1::uuid,$2::uuid,$3::jsonb) result',[job.id,job.claim_id,JSON.stringify(result)]))[0]?.result;
  if(!completed?.ok)throw Error('publication_completion_invalid');
  let observation;if(result.outcome==='SENT'&&verify){try{observation=await verify(job);}catch{observation={outcome:'VERIFICATION_UNAVAILABLE'};}}
  return {claimed:1,...(observation?{verification:observation}:{}),sent:result.outcome==='SENT'?1:0,rejected:result.outcome==='REJECTED'?1:0,unknown:result.outcome==='UNKNOWN'?1:0,receipt_saved:true};
 }catch{return {claimed:1,sent:0,rejected:0,unknown:1,receipt_saved:false};}
}

export async function verifyDispatchedPublication(biz,job,options){
 const rows=await biz.query("select id,version from pcs.content_posts where id=$1::uuid and status='PUBLICATION_SENT' and approved_revision=$2",[job.post_id,job.revision]);
 if(!rows[0])throw Error('publication_verification_snapshot_unavailable');
 const result=await verifyContentPublication(biz,{id:rows[0].id,expected_version:rows[0].version,request_id:crypto.randomUUID()},'pcs-manager-admin',['*'],options);
 return {outcome:result.verification?.outcome||'VERIFICATION_UNAVAILABLE'};
}
