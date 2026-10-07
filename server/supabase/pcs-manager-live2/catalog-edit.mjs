import {CrmError} from './crm-policy.mjs';
const textLimits={entity_type:100,title:500,city:200,publication_status:100,moderation_status:100,availability_status:100,description:20000,category:100,conditions:10000,source:2000};
const moneyKeys=['client_price_thb','deposit_thb','internal_net_thb'];
export function catalogEditQuery(b){
 const allowed=new Set(['id','expected_version',...Object.keys(textLimits),...moneyKeys]);
 if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!allowed.has(k))||typeof b.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.id)||typeof b.expected_version!=='string'||b.expected_version.length>100||!Number.isFinite(Date.parse(b.expected_version)))throw new CrmError('Обновите карточку перед сохранением.',400);
 const patch={},ui={};
 for(const [k,max]of Object.entries(textLimits))if(Object.hasOwn(b,k)){
  if((b[k]===null&&k==='city'))patch[k]=null;
  else {if(typeof b[k]!=='string'||b[k].length>max||(['title','entity_type','publication_status','moderation_status','availability_status'].includes(k)&&!b[k].trim()))throw new CrmError('Некорректное поле карточки: '+k,400);patch[k]=b[k];}
  if(['description','category','conditions','source'].includes(k)){ui[k]=patch[k];delete patch[k];}
 }
 for(const k of moneyKeys)if(Object.hasOwn(b,k)){
  const v=b[k];if(v===null||v===''){patch[k]=null;continue;}
  if(!['string','number'].includes(typeof v)||(typeof v==='number'&&!Number.isFinite(v))||!/^\d{1,12}(?:\.\d{1,2})?$/.test(String(v)))throw new CrmError('Некорректная сумма: '+k,400);
  patch[k]=String(v);
 }
 return {query:`with candidate as materialized(select * from catalog_items where id=$1::uuid and updated_at::text=$2 for update), saved as (
 update catalog_items c set
 entity_type=case when $3::jsonb ? 'entity_type' then $3::jsonb->>'entity_type' else c.entity_type end,
 title=case when $3::jsonb ? 'title' then $3::jsonb->>'title' else c.title end,
 city=case when $3::jsonb ? 'city' then $3::jsonb->>'city' else c.city end,
 publication_status=case when $3::jsonb ? 'publication_status' then $3::jsonb->>'publication_status' else c.publication_status end,
 moderation_status=case when $3::jsonb ? 'moderation_status' then $3::jsonb->>'moderation_status' else c.moderation_status end,
 availability_status=case when $3::jsonb ? 'availability_status' then $3::jsonb->>'availability_status' else c.availability_status end,
 client_price_thb=case when $3::jsonb ? 'client_price_thb' then ($3::jsonb->>'client_price_thb')::numeric else c.client_price_thb end,
 deposit_thb=case when $3::jsonb ? 'deposit_thb' then ($3::jsonb->>'deposit_thb')::numeric else c.deposit_thb end,
 internal_net_thb=case when $3::jsonb ? 'internal_net_thb' then ($3::jsonb->>'internal_net_thb')::numeric else c.internal_net_thb end,
 version=c.version+1,updated_at=clock_timestamp() from candidate old where c.id=old.id returning c.*
 ), revision as (
 insert into catalog_revisions(id,item_id,version,parent_version,status,payload,created_at,decided_at)
 select $5::uuid,s.id,s.version,s.version-1,'APPROVED',coalesce(r.payload,'{}'::jsonb)||jsonb_build_object('ui',coalesce(r.payload->'ui','{}'::jsonb)||$4::jsonb),now(),now() from saved s
 left join lateral(select payload from catalog_revisions where item_id=s.id order by version desc limit 1) r on true returning item_id
 ) select s.id,s.version,s.updated_at::text edit_version from saved s where exists(select 1 from revision r where r.item_id=s.id)`,params:[b.id,b.expected_version,JSON.stringify(patch),JSON.stringify(ui),crypto.randomUUID()]};
}
export async function updateCatalog(sql,b){const q=catalogEditQuery(b),rows=await sql.query(q.query,q.params);if(!rows.length)throw new CrmError('Карточка уже изменена. Черновик сохранён; обновите карточку перед повтором.',409);return {ok:true,...rows[0]};}

export function catalogCreateQuery(b){
 if(!b||typeof b!=='object'||Array.isArray(b)||typeof b.request_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.request_id)||Object.hasOwn(b,'id')||Object.hasOwn(b,'expected_version'))throw new CrmError('Для создания нужен идентификатор запроса. Повторите тот же запрос при сбое.',400);
 if(!b.title||b.publication_status&&b.publication_status!=='DRAFT'||b.moderation_status&&b.moderation_status!=='DRAFT')throw new CrmError('Новая карточка создаётся как черновик с названием.',400);
 const {request_id,...input}=b;
 const normalized={entity_type:'SERVICE',city:null,publication_status:'DRAFT',moderation_status:'DRAFT',availability_status:'REQUIRES_CONFIRMATION',description:'',category:'',conditions:'',source:'',client_price_thb:null,deposit_thb:null,internal_net_thb:null,...input};
 const valid=catalogEditQuery({...normalized,id:request_id,expected_version:'2000-01-01T00:00:00Z'});
 const patch=JSON.parse(valid.params[2]),ui=JSON.parse(valid.params[3]);
 const fingerprint={request_id:request_id.toLowerCase(),data:patch,ui};
 const payload={ui,_pcs_create_request:fingerprint};
 return {query:`with inserted as (
 insert into catalog_items(id,public_id,entity_type,title,city,publication_status,moderation_status,availability_status,version,client_price_thb,deposit_thb,internal_net_thb,created_at,updated_at)
 values($1::uuid,$2,$3::jsonb->>'entity_type',$3::jsonb->>'title',$3::jsonb->>'city','DRAFT','DRAFT',$3::jsonb->>'availability_status',1,($3::jsonb->>'client_price_thb')::numeric,($3::jsonb->>'deposit_thb')::numeric,($3::jsonb->>'internal_net_thb')::numeric,now(),clock_timestamp())
 on conflict(id) do nothing returning id,public_id
 ), first_revision as (
 insert into catalog_revisions(id,item_id,version,status,payload,created_at)
 select $5::uuid,i.id,1,'DRAFT',$4::jsonb,now() from inserted i returning item_id
 ) select i.id,i.public_id,1::int version,false replayed from inserted i where exists(select 1 from first_revision r where r.item_id=i.id)
 union all select c.id,c.public_id,1::int version,true replayed from catalog_items c join catalog_revisions r on r.item_id=c.id and r.version=1
 where c.id=$1::uuid and r.payload->'_pcs_create_request'=$4::jsonb->'_pcs_create_request' and not exists(select 1 from inserted)`,params:[request_id.toLowerCase(),'PCS-'+request_id.toUpperCase(),JSON.stringify(patch),JSON.stringify(payload),crypto.randomUUID()]};
}
export async function createCatalog(sql,b){const q=catalogCreateQuery(b),rows=await sql.query(q.query,q.params);if(!rows.length)throw new CrmError('Этот идентификатор уже используется или запись ещё сохраняется. Повторите исходный запрос; для другого черновика нужен новый идентификатор.',409);return {ok:true,...rows[0]};}

export async function archiveCatalog(sql,b){
 if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['id','expected_version'].includes(k)))throw new CrmError('Обновите карточку перед архивированием.',400);
 const saved=await updateCatalog(sql,{id:b.id,expected_version:b.expected_version,publication_status:'ARCHIVED',availability_status:'UNAVAILABLE'});
 return {...saved,publication_status:'ARCHIVED',availability_status:'UNAVAILABLE'};
}
