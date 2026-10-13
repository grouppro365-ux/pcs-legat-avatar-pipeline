import { CrmError, readCrmBody } from './crm-policy.mjs';
export const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
export async function tokenHash(token){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export function portalCommand(b){
 if(!b||!uuid(b.request_id)||!['request','submit-offer','select-offer','confirm','decline','payment'].includes(b.action)||!b.payload||Array.isArray(b.payload)||typeof b.payload!=='object')throw new CrmError('Некорректное действие кабинета',400);
 const allow={request:['need','city'],'submit-offer':['application_id','expected_version','price','deposit','terms','catalog_item_id','start_date','end_date'],'select-offer':['application_id','expected_version','offer_id'],confirm:['application_id','expected_version'],decline:['application_id','expected_version'],payment:['application_id','expected_version','amount','reference']};
 if(Object.keys(b).some(k=>!['action','request_id','payload'].includes(k))||Object.keys(b.payload).some(k=>!allow[b.action].includes(k)))throw new CrmError('Поле не поддерживается',400);
 if(b.action!=='request'&&(!uuid(b.payload.application_id)||typeof b.payload.expected_version!=='string'||b.payload.expected_version.length>100))throw new CrmError('Обновите заявку',400);
 if(b.action==='submit-offer'){
  const p=b.payload;if(p.catalog_item_id){if(!uuid(p.catalog_item_id)||!/^\d{4}-\d{2}-\d{2}$/.test(p.start_date||'')||!/^\d{4}-\d{2}-\d{2}$/.test(p.end_date||''))throw new CrmError('Выберите автомобиль и обе даты аренды',400);}
  else if(p.start_date||p.end_date)throw new CrmError('Выберите автомобиль для указанных дат',400);
 }
 if(b.action==='select-offer'&&!uuid(b.payload.offer_id))throw new CrmError('Некорректное предложение',400);
 for(const k of Object.keys(b.payload))if(typeof b.payload[k]!=='string'||b.payload[k].length>4000)throw new CrmError('Некорректное поле',400);
 return b;
}
export function portalDatabaseError(e){
 if(/vehicle_offer_/.test(String(e?.message||'')))return new CrmError('Проверьте автомобиль и даты предложения. Обновите кабинет.',400);
 if(!/portal_|partner_offer_|partner_decision_|client_confirmation_|application_(?:client|partner)_forbidden/.test(String(e?.message||'')))return null;
 const code=e.code||e.sqlState;
 if(code==='42501')return new CrmError('Ссылка недействительна, отозвана или действие недоступно',403);
 if(code==='40001'||code==='23505')return new CrmError('Данные изменились. Обновите кабинет перед повтором.',409);
 if(code==='P0002')return new CrmError('Запись не найдена',404);
 return new CrmError('Действие недоступно на этом этапе. Проверьте сумму и данные.',400);
}
export async function portalRoute(req,biz){
 const token=(req.headers.get('authorization')||'').replace(/^Bearer /,'');
 if(!/^[a-f0-9]{64}$/.test(token))throw new CrmError('Требуется персональная ссылка кабинета',401);
 const hash=await tokenHash(token);
 if(req.method==='GET')return (await biz.query('select pcs.portal_home($1) result',[hash]))[0].result;
 if(req.method!=='POST')throw new CrmError('Метод не поддерживается',405);
 const b=portalCommand(await readCrmBody(req));
 return (await biz.query('select pcs.portal_action($1,$2,$3::uuid,$4::jsonb) result',[hash,b.action,b.request_id,JSON.stringify(b.payload)]))[0].result;
}
export async function readWorkflow(biz,id){
 if(!uuid(id))throw new CrmError('Некорректная заявка',400);
 const application=(await biz.query('select id,public_id,client_profile_id,assigned_partner_id,operational_status,client_payment_status,selected_partner_offer_id,updated_at::text edit_version from applications where id=$1',[id]))[0];
 if(!application)throw new CrmError('Заявка не найдена',404);
 const [partners,offers,payments,instructions,access]=await Promise.all([
  biz.query("select id,public_name from partners where status='ACTIVE' order by public_name,id limit 500",[]),
  biz.query(`select id,status,partner_id,catalog_item_id,public_snapshot->>'title' item_title,availability_snapshot#>>'{booking,start_date}' start_date,availability_snapshot#>>'{booking,end_date}' end_date,client_price_thb::text,deposit_thb::text,terms,expires_at,updated_at::text edit_version from pcs_partner_offers where application_id=$1 order by created_at desc limit 100`,[id]),
  biz.query('select id,amount_thb::text,reference,status,review_note,updated_at::text edit_version from pcs.application_payment_claims where application_id=$1 order by created_at desc limit 100',[id]),
  biz.query('select recipient,instructions from pcs.application_payment_instructions where application_id=$1',[id]),
  biz.query('select id,role,expires_at,revoked_at from pcs.portal_access where (client_profile_id=$1::uuid and $1::uuid is not null) or (partner_id=$2::uuid and $2::uuid is not null) order by created_at desc limit 100',[application.client_profile_id,application.assigned_partner_id])
 ]);
 return {application,partners,offers,payments,instructions:instructions[0]||null,access};
}
export async function adminWorkflow(biz,b){
 if(typeof b.action!=='string')throw new CrmError('Некорректное действие',400);
 const allow={'issue-access':['role','profile_id'],'revoke-access':['access_id'],'assign-partner':['application_id','expected_version','partner_id'],'review-offer':['application_id','expected_version','offer_id','offer_version','decision'],'payment-instructions':['application_id','expected_version','instructions'],'review-payment':['application_id','expected_version','claim_id','claim_version','decision','note']};
 if(!allow[b.action]||Object.keys(b).some(k=>k!=='action'&&!allow[b.action].includes(k)))throw new CrmError('Действие не поддерживается',400);
 for(const k of allow[b.action])if(typeof b[k]!=='string'||b[k].length>4000||(k.endsWith('_id')&&!uuid(b[k])))throw new CrmError('Проверьте поля действия',400);
 const payload={...b};delete payload.action;
 let token;
 if(b.action==='issue-access'){token=[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');payload.hash=await tokenHash(token);}
 const result=(await biz.query('select pcs.portal_admin_action($1,$2::jsonb) result',[b.action,JSON.stringify(payload)]))[0].result;
 if(token)result.url='https://pcs-ai-operator-live.vercel.app/pcs-ai-operator-v6/cabinet.html#'+token;
 return result;
}
