import {catalogCreateQuery} from '../server/supabase/pcs-manager-live2/catalog-edit.mjs';
const id='20000000-0000-4000-8000-000000000002',body={request_id:id,title:"QA owner's service",description:'Terms',client_price_thb:'660.25'};
const literal=v=>"'"+String(v).replaceAll("'","''")+"'";
function statement(b=body){const q=catalogCreateQuery(b);return q.query.replace(/\$(\d+)\b/g,(_,n)=>literal(q.params[Number(n)-1])).replace('select i.id,i.public_id,1::int version,false replayed from inserted i','select to_jsonb(receipt) into result from (select i.id,i.public_id,1::int version,false replayed from inserted i')+') receipt';}
console.log(`do $qa$ declare result jsonb;begin begin
set local timezone='UTC';set local search_path=pg_temp,public;
create temp table catalog_items(like public.catalog_items including all) on commit drop;
create temp table catalog_revisions(like public.catalog_revisions including all) on commit drop;
alter table catalog_revisions add constraint qa_first_fail check(item_id<>'${id}') not valid;
begin ${statement()};raise exception 'revision failure ignored';exception when check_violation then null;end;
if exists(select 1 from catalog_items) or exists(select 1 from catalog_revisions) then raise exception 'partial creation';end if;
alter table catalog_revisions drop constraint qa_first_fail;
${statement()};
if result is null or result->>'replayed'<>'false' or (select client_price_thb from catalog_items)<>660.25 or (select publication_status from catalog_items)<>'DRAFT' or (select status from catalog_revisions)<>'DRAFT' then raise exception 'create assertion';end if;
${statement()};
if result->>'replayed'<>'true' or (select count(*) from catalog_items)<>1 or (select count(*) from catalog_revisions)<>1 then raise exception 'retry duplicate';end if;
${statement({...body,title:'Another draft'})};
if result is not null or (select title from catalog_items)<>'QA owner''s service' then raise exception 'request collision accepted';end if;
update catalog_items set title='Later edited',version=2,updated_at=clock_timestamp();
${statement()};
if result->>'replayed'<>'true' or (select title from catalog_items)<>'Later edited' or (select version from catalog_items)<>2 then raise exception 'retry overwrites newer record';end if;
raise exception using errcode='Z0001',message='QA rollback';exception when sqlstate 'Z0001' then null;end;end $qa$;`);
