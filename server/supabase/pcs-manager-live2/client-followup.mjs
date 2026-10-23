import {CrmError} from './crm-policy.mjs';
import {uuid} from './portal-workflow.mjs';
import {channelConnectionFingerprint} from './connection-snapshot.mjs';
import {dispatchPaymentInstructions,claimPaymentInstructions,finishPaymentInstructions} from './payment-instructions-send.mjs';
const may=permissions=>Array.isArray(permissions)&&(permissions.includes('*')||permissions.includes('applications.assign')&&permissions.includes('clients.manage'));
export function clientFollowupInput(action,b){
 const keys=action==='schedule'?['id','request_id','expected_version','channel','text','scheduled_at','confirmed']:['id','request_id','expected_version','job_id'];
 if(!['schedule','cancel'].includes(action)||!b||Array.isArray(b)||Object.keys(b).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(b,k))||!uuid(b.id)||!uuid(b.request_id)||!/^[a-f0-9]{32}$/.test(b.expected_version||''))throw new CrmError('Обновите заявку и проверьте поля повторного сообщения',400);
 if(action==='schedule'){
  if(b.confirmed!==true||!['telegram','line','whatsapp','instagram','facebook'].includes(b.channel)||typeof b.text!=='string'||!b.text||b.text!==b.text.trim()||b.text.length>(b.channel==='telegram'?4000:1800)||typeof b.scheduled_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(b.scheduled_at)||!Number.isFinite(Date.parse(b.scheduled_at))||new Date(b.scheduled_at).toISOString()!==b.scheduled_at)throw new CrmError('Укажите канал, точный текст, дату и подтвердите отправку',400);
 }else if(!uuid(b.job_id))throw new CrmError('Обновите запланированное сообщение',400);
 return {...b};
}
export function clientFollowupRoute(contact,channel){
 const field={telegram:'telegram_chat_id',line:'line_contact',whatsapp:'whatsapp',instagram:'instagram',facebook:'facebook'}[channel],value=contact?.[field];
 if(!field||!['string','number'].includes(typeof value)||!String(value)||String(value).length>512)throw Error('client_followup_route_missing');
 const route={target:String(value)};
 if(channel==='telegram'){if(!/^-?[1-9][0-9]{0,19}$/.test(route.target)||typeof contact.business_connection_id!=='string'||!contact.business_connection_id||contact.business_connection_id.length>256)throw Error('client_followup_route_missing');route.business_connection_id=contact.business_connection_id;}
 return route;
}
async function readConnection(db,channel){const r=await db.from('pcs_channel_connections').select('channel,enabled,status,updated_at,public_config').eq('channel',channel).maybeSingle();if(r.error)throw Error('client_followup_connection_unavailable');return channelConnectionFingerprint(r.data,channel);}
async function readRoute(db,id,channel){const r=await db.from('pcs_contacts').select('id,telegram_chat_id,business_connection_id,line_contact,whatsapp,instagram,facebook').eq('id',id).single();if(r.error||!r.data)throw Error('client_followup_route_missing');const route=clientFollowupRoute(r.data,channel);if(channel!=='telegram')route.connection_fingerprint=await readConnection(db,channel);return route;}
async function latestInbound(db,id){const r=await db.from('pcs_messages').select('id').eq('contact_id',id).eq('direction','in').order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1);if(r.error||!Array.isArray(r.data)||r.data.length>1||r.data[0]&&!uuid(r.data[0].id))throw Error('client_followup_inbox_unavailable');return r.data[0]?.id||null;}
export async function saveClientFollowup(biz,db,action,body,actor,permissions){
 if(!may(permissions))throw new CrmError('Нет права планировать сообщение клиенту',403);
 const input=clientFollowupInput(action,body);
 if(action==='schedule'){
  const prior=(await biz.query("select payload->'body' body from pcs.client_followup_commands where request_id=$1::uuid",[input.request_id]))[0];
  if(prior?.body&&Object.hasOwn(prior.body,'inbound_id')){input.inbound_id=prior.body.inbound_id;input.route=prior.body.route;}
  else{const current=(await biz.query('select c.source_contact_id contact_id from applications a join client_profiles c on c.id=a.client_profile_id where a.id=$1::uuid and md5(to_jsonb(a)::text)=$2 and c.blocked is not true and c.merged_into_id is null',[input.id,input.expected_version]))[0];if(!uuid(current?.contact_id))throw new CrmError('Заявка или связь клиента изменилась. Обновите карточку.',409);
   try{input.route=await readRoute(db,current.contact_id,input.channel);input.inbound_id=await latestInbound(db,current.contact_id);}catch{throw new CrmError('Не удалось проверить адрес или последнее сообщение клиента. Отправка не запланирована.',503);}}
 }
 try{const result=(await biz.query('select pcs.client_followup_action($1,$2::jsonb,$3,$4::jsonb) result',[action,JSON.stringify(input),actor,JSON.stringify(permissions)]))[0]?.result;if(!result?.ok||result.id!==input.id||!uuid(result.job?.id))throw new CrmError('Не получено подтверждение плана. Повторите ту же команду.',502);return result;}
 catch(e){if(e instanceof CrmError)throw e;if(e.code==='42501')throw new CrmError('Нет права планировать сообщение клиенту',403);if(/client_followup_/.test(e.message))throw new CrmError(e.code==='22023'?'Проверьте дату, текст и подтверждение отправки':'Заявка, адрес или состояние отправки изменились. Обновите карточку.',e.code==='22023'?400:409);throw e;}
}
export const claimClientFollowup=claimPaymentInstructions.replaceAll('PAYMENT_INSTRUCTIONS_READY','CLIENT_FOLLOWUP_READY');
export const finishClientFollowup=finishPaymentInstructions.replaceAll('payment.instructions_review','client.followup_review').replaceAll('Проверить отправку реквизитов','Проверить повторное сообщение клиенту').replaceAll('payment-send-review:','client-followup-review:').replaceAll('payment_instructions_delivery','client_followup_delivery');
export const currentClientFollowup=`select a.id from applications a join client_profiles c on c.id=a.client_profile_id where a.id=$1::uuid and a.client_profile_id=$2::uuid and md5(to_jsonb(a)::text)=$3 and c.source_contact_id=$4::uuid and c.blocked is not true and c.merged_into_id is null and a.operational_status not in ('COMPLETED','CANCELLED','CANCELLED_BY_CLIENT','CANCELLED_BY_PARTNER','REJECTED','EXPIRED','FAILED')`;
const sameRoute=(a,b)=>a?.target===b?.target&&a?.business_connection_id===b?.business_connection_id&&a?.connection_fingerprint===b?.connection_fingerprint;
async function stillAuthorized(biz,actor){if(actor==='pcs-manager-admin')return true;if(!uuid(actor))return false;return may((await biz.query('select pcs.staff_context($1::uuid) context',[actor]))[0]?.context?.permissions);}
export async function dispatchClientFollowup(biz,db,transport){
 const active=new Map();
 return dispatchPaymentInstructions(biz,db,async(out,contact)=>{const p=active.get(out.contact_id+':'+out.channel);const route=clientFollowupRoute(contact,out.channel);if(out.channel!=='telegram')route.connection_fingerprint=await readConnection(db,out.channel);if(!p||!sameRoute(route,p.route)||!await stillAuthorized(biz,p.actor)||await latestInbound(db,p.contact_id)!==(p.inbound_id||null)||(await biz.query(currentClientFollowup,[p.application_id,p.client_profile_id,p.revision,p.contact_id])).length!==1)throw Error('client_followup_changed_before_transport');return transport(out.channel==='telegram'?out:{...out,expected_connection_fingerprint:p.route.connection_fingerprint},contact);},
 {enqueue:'select 1',claim:claimClientFollowup,current:currentClientFollowup,finish:finishClientFollowup,
 acceptedReceipt:async job=>{const p=job.payload,r=await db.from('pcs_channel_events').select('status,payload').eq('channel',p.channel).eq('external_event_id','operator:'+p.contact_id+':'+job.id).maybeSingle();if(r.error)throw Error('client_followup_receipt_unavailable');if(!r.data)return false;const e=r.data;
  if(['sent','processed'].includes(e.status)){const o=e.payload?.outgoing,receipt=e.payload?.receipt;if(o?.contact_id!==p.contact_id||o?.request_id!==job.id||o?.channel!==p.channel||o?.text!==p.delivery_text||!receipt?.message_id)throw Error('client_followup_receipt_invalid');if(e.status==='sent')await biz.query("insert into notifications(event_key,entity_type,entity_id,title,body,status,dedupe_key) values('client.followup_history_review','applications',$1,'Проверить историю отправленного сообщения','Доставка подтверждена сохранённым ответом канала. Проверьте историю; повторная отправка не требуется.','PENDING',$2) on conflict(dedupe_key) do nothing",[p.application_id,'client-followup-history:'+job.id]);return true;}
  if(['delivery_uncertain','sending','recording','processing'].includes(e.status))throw Error('client_followup_delivery_unknown');return false;},
 text:()=>{throw Error('client_followup_frozen_text_missing');},preflight:async p=>{if(!await stillAuthorized(biz,p.actor)||!sameRoute(await readRoute(db,p.contact_id,p.channel),p.route)||await latestInbound(db,p.contact_id)!==(p.inbound_id||null))return false;active.set(p.contact_id+':'+p.channel,p);return true;}});
}
