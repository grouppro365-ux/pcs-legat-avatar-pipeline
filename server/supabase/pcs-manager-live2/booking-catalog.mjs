import {CrmError} from './crm-policy.mjs';
const rentalCategory=`lower(coalesce((select payload->'ui'->>'category' from catalog_revisions where item_id=catalog_items.id and payload ? 'ui' order by version desc limit 1),(select payload->'legacy'->>'category' from catalog_revisions where item_id=catalog_items.id and payload ? 'legacy' order by version desc limit 1),(select payload->'legacy_extra'->>'category' from catalog_revisions where item_id=catalog_items.id and payload ? 'legacy_extra' order by version desc limit 1),'car_rent'))='car_rent'`;
export const bookableVehicle=`${rentalCategory} and entity_type='VEHICLE' and availability_status='AVAILABLE' and client_price_thb>0 and publication_status='PUBLISHED' and moderation_status='APPROVED' and (publication_starts_at is null or publication_starts_at<=now()) and (publication_ends_at is null or publication_ends_at>now())`;
export async function requireBookableVehicle(biz,itemId){
 const rows=await biz.query(`select id from catalog_items where id=$1::uuid and ${bookableVehicle} limit 1`,[itemId]);
 if(!rows.length)throw new CrmError('Выберите доступный опубликованный автомобиль для аренды с подтверждённым тарифом.',409);
}
