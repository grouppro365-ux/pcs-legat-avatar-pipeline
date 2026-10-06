import {prospectSourceEditQuery} from '../server/supabase/pcs-manager-live2/prospect-source-edit.mjs';
const id='10000000-0000-4000-8000-000000000001',version='2026-10-06 15:00:00.123456+00';
const literal=v=>v===null?'null':typeof v==='boolean'?String(v):"'"+String(v).replaceAll("'","''")+"'";
function statement(body,current=false){const q=prospectSourceEditQuery(body);return q.query.replace(/\$(\d+)\b/g,(_,n)=>current&&n==='2'?'qa_version':literal(q.params[Number(n)-1])).replace('select s.* from saved s','select to_jsonb(s) into qa_result from saved s');}
const pause={id,expected_version:version,enabled:false,competitor:true,rules:"No ads; operator's rule"},resume={...pause,enabled:true,competitor:false,rules:''};
const query=`do $qa$ declare qa_result jsonb;qa_version text;begin
begin
set local timezone='UTC';
set local search_path=pg_temp,public;
create temp table pcs_prospect_sources(like public.pcs_prospect_sources including all) on commit drop;
create temp table audit_logs(like public.audit_logs including all) on commit drop;
insert into pg_temp.pcs_prospect_sources(id,username,topic,enabled,cursor_id,pending_before,pending_top,lease_id,lease_until,updated_at,next_scan_at)
values('${id}','qa_source','property',true,42,10,100,'qa-lease',now()+interval '5 minutes','${version}',now()+interval '1 day');
${statement(pause)};
if qa_result->>'enabled'<>'false' or qa_result->>'topic'<>'competitor' or qa_result->>'rules'<>'No ads; operator''s rule' then raise exception 'pause result assertion';end if;
if exists(select 1 from pg_temp.pcs_prospect_sources where lease_id is not null or lease_until is not null or cursor_id<>42 or pending_before<>10 or pending_top<>100 or next_scan_at<now()) then raise exception 'pause cursor lease assertion';end if;
qa_version:=qa_result->>'edit_version';
${statement(pause)};
if qa_result is not null or (select count(*) from pg_temp.audit_logs)<>1 then raise exception 'stale version accepted';end if;
alter table pg_temp.audit_logs add constraint qa_audit_failure check(action<>'prospect_source_updated') not valid;
begin
${statement(resume,true)};
raise exception 'audit failure ignored';exception when check_violation then null;end;
if (select updated_at::text from pg_temp.pcs_prospect_sources where id='${id}')<>qa_version or (select enabled from pg_temp.pcs_prospect_sources where id='${id}') then raise exception 'audit rollback assertion';end if;
alter table pg_temp.audit_logs drop constraint qa_audit_failure;
${statement(resume,true)};
if qa_result->>'enabled'<>'true' or qa_result->>'topic'<>'community' or qa_result->>'rules' is not null or (select count(*) from pg_temp.audit_logs)<>2 then raise exception 'resume assertion';end if;
raise exception 'qa_rollback' using errcode='Z0001';
exception when sqlstate 'Z0001' then null;end;
end $qa$;`;
process.stdout.write(JSON.stringify({query}));
