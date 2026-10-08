import {CrmError} from './crm-policy.mjs';
import {galleryMutationParams} from './catalog-media-delete.mjs';
export function mediaOrderQuery(b){
 const params=galleryMutationParams(b);
 return {params,query:`with locked as materialized (
 select m.* from catalog_media m where m.item_id=$1::uuid order by m.id for update
 ),candidate as (
 select $1::uuid item_id from locked
 having md5(coalesce(jsonb_agg(to_jsonb(locked) order by sort_order,created_at,id)::text,'[]'))=$2
 and count(*)=cardinality($3::uuid[]) and count(*) filter(where id=any($3::uuid[]))=cardinality($3::uuid[])
 ),ordered as (
 update catalog_media m set sort_order=w.position-1,updated_at=statement_timestamp()
 from candidate c,unnest($3::uuid[]) with ordinality w(id,position)
 where m.item_id=c.item_id and m.id=w.id returning m.id,m.sort_order
 ),audited as (
 insert into audit_events(actor_role,action,entity_type,entity_id,patch,reason,result)
 select 'ADMIN','catalog_media_order','catalog_items',$1::text,
 jsonb_build_object('before',jsonb_build_object('photo_order',(select jsonb_agg(id::text order by sort_order,created_at,id) from locked)),'after',jsonb_build_object('photo_order',jsonb_agg(id::text order by sort_order))),
 'Explicit PCS cover selection','SUCCESS' from ordered having count(*)=cardinality($3::uuid[]) returning entity_id
 ) select $1::uuid id,jsonb_agg(id::text order by sort_order) ids from ordered
 having count(*)=cardinality($3::uuid[]) and exists(select 1 from audited)`};
}
export async function orderCatalogMedia(sql,b){const q=mediaOrderQuery(b),rows=await sql.query(q.query,q.params);if(!rows.length)throw new CrmError('Галерея изменилась. Порядок фото не изменён; обновите галерею перед повтором.',409);return {ok:true,...rows[0]};}
