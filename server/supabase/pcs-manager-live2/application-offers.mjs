import {CrmError} from './crm-policy.mjs';
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
export function applicationOffersQuery(id,source='partner',rawPage='0'){
 if(!uuid(id)||!['partner','quotes'].includes(source)||typeof rawPage!=='string'||!/^\d{1,5}$/.test(rawPage)||Number(rawPage)>5000)throw new CrmError('Некорректные параметры предложений',400);
 const page=Number(rawPage),query=source==='partner'
 ? `select o.id,o.application_id,o.partner_id,o.catalog_item_id,o.status,o.client_price_thb::text,o.deposit_thb::text,o.currency_code,o.terms,o.client_comment,o.expires_at,o.submitted_at,o.reviewed_at,o.accepted_at,c.title item_title,(a.selected_partner_offer_id=o.id) selected_in_application,(o.expires_at<=now()) deadline_passed from pcs_partner_offers o join applications a on a.id=o.application_id left join catalog_items c on c.id=o.catalog_item_id where o.application_id=$1 order by o.created_at desc,o.id desc limit 51 offset $2`
 : `select q.id,q.application_id,q.version,q.currency,q.client_total::text,q.deposit::text,q.payment_recipient,q.immutable_at from quote_snapshots q where q.application_id=$1 order by q.version desc,q.id desc limit 51 offset $2`;
 return {id,source,page,query,params:[id,page*50]};
}
export async function readApplicationOffers(biz,id,source,rawPage){
 const q=applicationOffersQuery(id,source,rawPage),application=(await biz.query('select id,public_id,selected_partner_offer_id from applications where id=$1 limit 1',[id]))[0];
 if(!application)throw new CrmError('Заявка не найдена',404);
 const rows=await biz.query(q.query,q.params);return {application,source:q.source,page:q.page,rows:rows.slice(0,50),truncated:rows.length>50};
}
