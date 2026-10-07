import {catalogEditQuery} from '../server/supabase/pcs-manager-live2/catalog-edit.mjs';
const id='10000000-0000-4000-8000-000000000001',version='2026-10-07 13:00:00.123456+00';
const b={id,expected_version:version,publication_status:'ARCHIVED',availability_status:'UNAVAILABLE'};
const literal=v=>"'"+String(v).replaceAll("'","''")+"'";
function statement(){const q=catalogEditQuery(b);return q.query.replace(/\$(\d+)\b/g,(_,n)=>literal(q.params[Number(n)-1])).replace('select s.id,s.version,s.updated_at::text edit_version from saved s','select to_jsonb(s) into result from saved s');}
console.log(`do $qa$ declare result jsonb;begin begin
set local timezone='UTC';set local search_path=pg_temp,public;
create temp table catalog_items(like public.catalog_items including all) on commit drop;
create temp table catalog_revisions(like public.catalog_revisions including all) on commit drop;
insert into catalog_items(id,public_id,entity_type,title,version,client_price_thb,updated_at) values('${id}','QA-ROLLBACK','SERVICE','Old title',1,660,'${version}');
insert into catalog_revisions(item_id,version,status,payload) values('${id}',1,'DRAFT','{"legacy":{"conditions":"Insurance"},"ui":{"conditions":"Insurance"},"other":{"retain":true}}');
alter table catalog_revisions add constraint qa_revision_fail check(version<>2) not valid;
begin ${statement()};raise exception 'revision failure ignored';exception when check_violation then null;end;
if (select title from catalog_items where id='${id}')<>'Old title' or (select count(*) from catalog_revisions)<>1 then raise exception 'partial write';end if;
alter table catalog_revisions drop constraint qa_revision_fail;
${statement()};
if result is null or (select version from catalog_items where id='${id}')<>2 or (select client_price_thb from catalog_items where id='${id}')<>660 or (select publication_status from catalog_items where id='${id}')<>'ARCHIVED' or (select availability_status from catalog_items where id='${id}')<>'UNAVAILABLE' then raise exception 'update/price assertion';end if;
if (select payload->'ui'->>'conditions' from catalog_revisions where version=2)<>'Insurance' or (select payload->'other'->>'retain' from catalog_revisions where version=2)<>'true' then raise exception 'payload lost';end if;
${statement()};
if result is not null or (select count(*) from catalog_revisions)<>2 then raise exception 'stale accepted';end if;
raise exception using errcode='Z0001',message='QA rollback';exception when sqlstate 'Z0001' then null;end;end $qa$;`);
