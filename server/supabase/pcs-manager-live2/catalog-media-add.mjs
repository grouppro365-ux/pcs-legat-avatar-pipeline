import {CrmError} from './crm-policy.mjs';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export async function prepareMediaUpload(b){
 if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['request_id','item_id','filename','content_type','content_base64','media_type','sort_order'].includes(k))||!uuid(b.request_id)||!uuid(b.item_id)||typeof b.filename!=='string'||!b.filename||b.filename.length>500||!['image/jpeg','image/png','image/webp'].includes(b.content_type)||typeof b.content_base64!=='string')throw new CrmError('Некорректная загрузка. Повторите исходный файл с тем же идентификатором.',400);
 const data=b.content_base64.replace(/^data:[^,]+,/,'');
 if(!data||data.length>Math.ceil(10*1024*1024/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))throw new CrmError('Некорректный файл или размер больше 10 МБ',400);
 let bytes;try{bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0))}catch{throw new CrmError('Некорректный файл',400)}
 if(!bytes.length||bytes.length>10*1024*1024)throw new CrmError('Некорректный размер файла',400);
 const header=new TextEncoder().encode(JSON.stringify([b.filename,b.content_type])+'\n'),input=new Uint8Array(header.length+bytes.length);input.set(header);input.set(bytes,header.length);
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',input)),x=>x.toString(16).padStart(2,'0')).join('');
 const item_id=b.item_id.toLowerCase(),request_id=b.request_id.toLowerCase(),ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[b.content_type];
 return {item_id,request_id,storage_key:`${item_id}/${request_id}-${digest}.${ext}`,filename:b.filename,content_type:b.content_type,content_base64:data};
}
export function mediaInsertQuery(p,expected_version,url){
 return {params:[p.item_id,p.request_id,p.storage_key,url,expected_version],query:`with parent as materialized (
 select id from catalog_items where id=$1::uuid and updated_at::text=$5 and (select count(*) from catalog_media where item_id=$1::uuid)<30 and not exists(select 1 from audit_events where action='catalog_media_add' and patch->>'photo_id'=$2) for update
 ),saved as (
 insert into catalog_media(id,item_id,media_type,storage_key,public_url,sort_order,status,created_at,updated_at)
 select $2::uuid,p.id,'image',$3,$4,(select count(*)::int from catalog_media where item_id=p.id),'APPROVED',now(),now() from parent p
 on conflict(id) do nothing returning id,item_id,public_url
 ),touched as (
 update catalog_items c set updated_at=clock_timestamp() from parent p where c.id=p.id and exists(select 1 from saved) returning c.id
 ),audited as (
 insert into audit_events(actor_role,action,entity_type,entity_id,patch,reason,result)
 select 'ADMIN','catalog_media_add','catalog_items',s.item_id::text,jsonb_build_object('photo_id',s.id,'upload_fingerprint',$3),'Explicit PCS photo upload','SUCCESS' from saved s where exists(select 1 from touched) returning entity_id
 ) select s.id,s.public_url url from saved s where exists(select 1 from audited)`};
}
async function existing(sql,p){
 const rows=await sql.query('select id,item_id,storage_key,public_url from catalog_media where id=$1::uuid',[p.request_id]);if(!rows.length){const completed=await sql.query("select entity_id from audit_events where action='catalog_media_add' and patch->>'photo_id'=$1 order by created_at desc limit 1",[p.request_id]);if(completed.length)throw new CrmError('Эта загрузка уже завершалась, а фото позже удалили. Обновите галерею; старый запрос не восстановит фото.',409);return null;}const x=rows[0];
 if(String(x.item_id)!==p.item_id||x.storage_key!==p.storage_key||!x.public_url)throw new CrmError('Этот идентификатор загрузки уже используется для другого файла.',409);
 return {ok:true,id:x.id,url:x.public_url,replayed:true};
}
export async function addCatalogMedia(sql,upload,b){
 const p=await prepareMediaUpload(b),prior=await existing(sql,p);if(prior)return prior;
 const parents=await sql.query('select updated_at::text edit_version,(select count(*) from catalog_media where item_id=c.id)::int media_count from catalog_items c where id=$1::uuid',[p.item_id]);
 if(!parents.length)throw new CrmError('Карточка не найдена',404);if(Number(parents[0].media_count)>=30)throw new CrmError('Лимит 30 фото достигнут',400);
 const object=await upload(p);if(typeof object?.url!=='string'||!object.url.startsWith('https://'))throw new CrmError('Storage не подтвердил загрузку файла',503);
 const q=mediaInsertQuery(p,parents[0].edit_version,object.url),rows=await sql.query(q.query,q.params);if(rows.length)return {ok:true,...rows[0],replayed:false};
 const replay=await existing(sql,p);if(replay)return replay;throw new CrmError('Карточка изменилась или достигнут лимит. Повторите тот же файл с тем же идентификатором.',409);
}
