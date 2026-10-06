import {readFileSync} from 'node:fs';
const dispatch=readFileSync(new URL('../server/sql/pcs_generation_dispatch_auth.sql',import.meta.url),'utf8').replaceAll('public.pcs_dispatch_generation_postprocess_v9','pg_temp.pcs_dispatch_generation_postprocess_v9').replaceAll('public.pcs_secret_get','pg_temp.pcs_secret_get').replaceAll('net.http_post','pg_temp.http_post');
const query=`begin;
create temp table qa_generations(id uuid,status text,policy_decision text,policy_reason text,intent text) on commit drop;
create temp table qa_calls(url text,headers jsonb,body jsonb) on commit drop;
create function pg_temp.pcs_secret_get(text) returns text language sql as $$select 'test-only-secret'::text$$;
create function pg_temp.http_post(url text,headers jsonb,body jsonb) returns bigint language plpgsql as $$begin insert into pg_temp.qa_calls values(url,headers,body);return 1;end$$;
${dispatch}
create trigger qa_dispatch after insert on qa_generations for each row execute function pg_temp.pcs_dispatch_generation_postprocess_v9();
insert into qa_generations values
('10000000-0000-4000-8000-000000000001','approval_required','auto','postprocess_v9','visa'),
('10000000-0000-4000-8000-000000000002','approval_required','auto','postprocess_v9','car_rent'),
('10000000-0000-4000-8000-000000000003','sent','auto','postprocess_v9','car_rent'),
('10000000-0000-4000-8000-000000000004','approval_required','approval','postprocess_v9','car_rent'),
('10000000-0000-4000-8000-000000000005','approval_required','auto','other_policy','car_rent');
do $qa$ begin
if (select count(*) from pg_temp.qa_calls)<>2 then raise exception 'dispatch eligibility changed';end if;
if exists(select 1 from pg_temp.qa_calls where headers->>'x-pcs-internal-secret'<>'test-only-secret' or headers->>'content-type'<>'application/json') then raise exception 'missing dispatch authentication';end if;
if not exists(select 1 from pg_temp.qa_calls where url like '%pcs-generation-postprocess-v9' and body->>'generation_id'='10000000-0000-4000-8000-000000000001') then raise exception 'sensitive route changed';end if;
if not exists(select 1 from pg_temp.qa_calls where url like '%pcs-generation-humanize-v10' and body->>'generation_id'='10000000-0000-4000-8000-000000000002') then raise exception 'humanize route changed';end if;
end $qa$;
rollback;`;
process.stdout.write(JSON.stringify({query}));
