import {CrmError} from './crm-policy.mjs';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export function galleryMutationParams(b){
 if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['item_id','ids','expected_version','expected_item_version'].includes(k))||!uuid(b.item_id)||!Array.isArray(b.ids)||b.ids.length<1||b.ids.length>30||b.ids.some(x=>!uuid(x))||new Set(b.ids.map(x=>x.toLowerCase())).size!==b.ids.length||typeof b.expected_version!=='string'||!/^[0-9a-f]{32}$/.test(b.expected_version)||typeof b.expected_item_version!=='string'||b.expected_item_version.length>80||!Number.isFinite(Date.parse(b.expected_item_version)))throw new CrmError('Обновите галерею перед изменением фотографий.',400);
 return [b.item_id.toLowerCase(),b.expected_version,b.ids.map(x=>x.toLowerCase()),b.expected_item_version];
}
export function mediaDeleteQuery(b){
 const params=galleryMutationParams(b);
 return {query:`with parent as materialized (
 select id from catalog_items where id=$1::uuid and updated_at::text=$4 for update
 ),locked as materialized (
 select m.* from catalog_media m where m.item_id=$1::uuid and exists(select 1 from parent) order by m.id for update
 ),candidate as (
 select $1::uuid item_id from locked
 having md5(coalesce(jsonb_agg(to_jsonb(locked) order by sort_order,created_at,id)::text,'[]'))=$2
 and count(*) filter(where id=any($3::uuid[]))=cardinality($3::uuid[])
 ),deleted as (
 delete from catalog_media m using candidate c where m.item_id=c.item_id and m.id=any($3::uuid[]) returning m.id
 ),touched as (
 update catalog_items c set updated_at=clock_timestamp() from parent p where c.id=p.id and exists(select 1 from deleted) returning c.id
 ),audited as (
 insert into audit_events(actor_role,action,entity_type,entity_id,patch,reason,result)
 select 'ADMIN','catalog_media_delete','catalog_items',$1::text,jsonb_build_object('deleted_photo_ids',jsonb_agg(id::text order by id)),'Explicit PCS gallery deletion','SUCCESS'
 from deleted having exists(select 1 from touched) and count(*)=cardinality($3::uuid[]) returning entity_id
 ) select $1::uuid id,jsonb_agg(d.id::text order by d.id) deleted from deleted d
 having count(*)=cardinality($3::uuid[]) and exists(select 1 from audited)`,params};
}
export async function deleteCatalogMedia(sql,b){const q=mediaDeleteQuery(b),rows=await sql.query(q.query,q.params);if(!rows.length)throw new CrmError('Галерея изменилась. Ничего не удалено; обновите фотографии перед повтором.',409);return {ok:true,...rows[0]};}
