import {mediaInsertQuery} from '../server/supabase/pcs-manager-live2/catalog-media-add.mjs';
const item='10000000-0000-4000-8000-000000000001',id='20000000-0000-4000-8000-000000000001',version='2026-10-08 10:00:00.123456+00';
const literal=v=>"'"+String(v).replaceAll("'","''")+"'";
function statement(){const q=mediaInsertQuery({item_id:item,request_id:id,storage_key:item+'/'+id+'-hash.jpg'},version,'https://example.invalid/photo.jpg');return q.query.replace(/\$(\d+)\b/g,(_,n)=>literal(q.params[Number(n)-1])).replace('select s.id,s.public_url url from saved s',"select jsonb_build_object('id',s.id,'url',s.public_url) into result from saved s")}
console.log(`do $qa$ declare result jsonb;begin begin
set local timezone='UTC';set local search_path=pg_temp,public;
create temp table catalog_items(like public.catalog_items including all) on commit drop;
create temp table catalog_media(like public.catalog_media including all) on commit drop;
create temp table audit_events(like public.audit_events including all) on commit drop;
insert into catalog_items(id,public_id,entity_type,title,version,client_price_thb,updated_at) values('${item}','QA-UPLOAD','VEHICLE','Original',1,660,'${version}');
alter table audit_events add constraint qa_audit_fail check(action<>'catalog_media_add') not valid;
begin ${statement()};raise exception 'audit failure ignored';exception when check_violation then null;end;
if (select count(*) from catalog_media)<>0 or (select count(*) from audit_events)<>0 or (select updated_at::text from catalog_items where id='${item}')<>'${version}' then raise exception 'partial insert on audit error';end if;
alter table audit_events drop constraint qa_audit_fail;
update catalog_items set updated_at=clock_timestamp() where id='${item}';
${statement()};if result is not null or (select count(*) from catalog_media)<>0 then raise exception 'stale parent accepted';end if;
update catalog_items set updated_at='${version}' where id='${item}';
insert into catalog_media(item_id,storage_key) select '${item}','QA-limit-'||n from generate_series(1,30) n;
${statement()};if result is not null or (select count(*) from catalog_media)<>30 then raise exception 'capacity accepted';end if;
delete from catalog_media;
${statement()};
if result is null or result->>'id'<>'${id}' or (select count(*) from catalog_media)<>1 or (select count(*) from audit_events)<>1 or (select updated_at::text from catalog_items where id='${item}')='${version}' or (select title from catalog_items where id='${item}')<>'Original' or (select client_price_thb from catalog_items where id='${item}')<>660 then raise exception 'insert receipt mismatch';end if;
${statement()};if result is not null or (select count(*) from catalog_media)<>1 or (select count(*) from audit_events)<>1 then raise exception 'duplicate insert';end if;
delete from catalog_media;update catalog_items set updated_at='${version}' where id='${item}';
${statement()};if result is not null or (select count(*) from catalog_media)<>0 or (select count(*) from audit_events)<>1 then raise exception 'deleted photo recreated';end if;
if not exists(select 1 from audit_events where patch->>'photo_id'='${id}' and patch->>'upload_fingerprint'='${item}/${id}-hash.jpg') then raise exception 'missing durable upload marker';end if;
raise exception using errcode='Z0001',message='QA rollback';exception when sqlstate 'Z0001' then null;end;end $qa$;`);
