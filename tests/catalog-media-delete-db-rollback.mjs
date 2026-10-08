import {mediaDeleteQuery} from '../server/supabase/pcs-manager-live2/catalog-media-delete.mjs';
const item='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const ids=[1,2,3,4].map(x=>'20000000-0000-4000-8000-'+String(x).padStart(12,'0'));
const literal=v=>"'"+String(v).replaceAll("'","''")+"'";
const version=`select md5(coalesce(jsonb_agg(to_jsonb(m) order by sort_order,created_at,id)::text,'[]')) into expected from catalog_media m where item_id='${item}'`;
function statement(selected=ids.slice(0,2)){
 const q=mediaDeleteQuery({item_id:item,ids:selected,expected_version:'a'.repeat(32),expected_item_version:'2026-10-08 10:00:00.123456+00'});
 return q.query.replace(/\$(\d+)\b/g,(_,n)=>n==='4'?'parent_expected':n==='2'?'expected':n==='3'?'array['+q.params[2].map(literal).join(',')+']':literal(q.params[0]))
 .replace(/select '[^']+'::uuid id,jsonb_agg\(d.id::text order by d.id\) deleted from deleted d/,`select jsonb_build_object('id','${item}','deleted',jsonb_agg(d.id::text order by d.id)) into result from deleted d`);
}
console.log(`do $qa$ declare expected text;parent_expected text;result jsonb;begin begin
set local timezone='UTC';set local search_path=pg_temp,public;
create temp table catalog_items(like public.catalog_items including all) on commit drop;
create temp table catalog_media(like public.catalog_media including all) on commit drop;
create temp table audit_events(like public.audit_events including all) on commit drop;
insert into catalog_items(id,public_id,entity_type,title,version,client_price_thb,updated_at) values('${item}','QA-MEDIA-LOCK','VEHICLE','Original',1,660,'2026-10-08 10:00:00.123456+00');
select updated_at::text into parent_expected from catalog_items where id='${item}';
insert into catalog_media(id,item_id,storage_key,public_url,sort_order) values
${ids.map((id,i)=>`('${id}','${i===3?other:item}','QA-${i}','https://example.invalid/qa-${i}.jpg',${i})`).join(',')};
${version};
alter table audit_events add constraint qa_audit_fail check(action<>'catalog_media_delete') not valid;
begin ${statement()};raise exception 'audit failure ignored';exception when check_violation then null;end;
if (select count(*) from catalog_media)<>4 or (select count(*) from audit_events)<>0 then raise exception 'partial delete on audit error';end if;
if (select updated_at::text from catalog_items where id='${item}')<>parent_expected then raise exception 'parent changed on audit failure';end if;
alter table audit_events drop constraint qa_audit_fail;
update catalog_items set updated_at=clock_timestamp() where id='${item}';
${statement()};if result is not null then raise exception 'stale parent accepted';end if;
select updated_at::text into parent_expected from catalog_items where id='${item}';
${statement([ids[0],ids[3]])};
if result is not null or (select count(*) from catalog_media)<>4 then raise exception 'foreign photo accepted';end if;
update catalog_media set sort_order=30 where id='${ids[0]}';
${statement()};
if result is not null or (select count(*) from catalog_media)<>4 then raise exception 'stale gallery accepted';end if;
${version};
${statement()};
if result is null or jsonb_array_length(result->'deleted')<>2 or (select count(*) from catalog_media)<>2 or (select count(*) from audit_events)<>1 then raise exception 'batch receipt mismatch';end if;
if not exists(select 1 from catalog_media where id='${ids[2]}') or not exists(select 1 from catalog_media where id='${ids[3]}') then raise exception 'unselected photo deleted';end if;
${statement()};
if result is not null or (select count(*) from audit_events)<>1 then raise exception 'retry accepted';end if;
if (select updated_at::text from catalog_items where id='${item}')=parent_expected or (select title from catalog_items where id='${item}')<>'Original' or (select client_price_thb from catalog_items where id='${item}')<>660 then raise exception 'parent receipt mismatch';end if;
raise exception using errcode='Z0001',message='QA rollback';exception when sqlstate 'Z0001' then null;end;end $qa$;`);
