import {prospectRejectQuery} from '../server/supabase/pcs-manager-live2/prospect-request-review.mjs';
import {saveReviewClassifications} from '../server/supabase/pcs-manager-live2/prospect-engine.mjs';
const id='11111111-1111-4111-8111-111111111111',other='33333333-3333-4333-8333-333333333333',request_id='22222222-2222-4222-8222-222222222222',version='2026-10-08 10:00:00.123456+00';
const literal=x=>"'"+String(x).replaceAll("'","''")+"'";
function statement(record=id){const q=prospectRejectQuery({id:record,request_id,expected_version:version,reason:'Seller advertisement'});return q.query.replace(/\$(\d+)\b/g,(_,n)=>literal(q.params[Number(n)-1])).replace('select s.* from saved s','select to_jsonb(s) into result from saved s');}
const workerInput=`jsonb_build_array(jsonb_build_object('id','${id}','message_text','Seller ad','expected_updated_at',result->>'edit_version','decision','qualified','direction','PROPERTY_PURCHASE','reason','AI result','evidence','Seller','facts','{}'::jsonb,'outreach_status','blocked_identity'))`;
const worker=saveReviewClassifications.replace(/\$(\d+)\b/g,(_,n)=>n==='1'?workerInput:literal(n==='2'?'QA-model':n==='3'?'QA-version':'qa-worker-run')).replace('select id,decision from saved','select count(*) into worker_count from saved');
console.log(`do $qa$ declare result jsonb;worker_count int;begin begin
set local timezone='UTC';set local search_path=pg_temp,public;
create temp table pcs_prospect_requests(like public.pcs_prospect_requests including all) on commit drop;
create temp table audit_logs(like public.audit_logs including all) on commit drop;
insert into pcs_prospect_requests(id,source_id,telegram_message_id,message_url,message_text,decision,direction,reason,qualification_version,updated_at,contact_id,author_verified) values('${id}','qa-source',1,'https://t.me/qa_source/1','Seller ad','qualified','PROPERTY_PURCHASE','AI result','QA','${version}','qa-existing-contact',true);
alter table audit_logs add constraint qa_audit_fail check(action<>'prospect_request_rejected') not valid;
begin ${statement()};raise exception 'audit failure ignored';exception when check_violation then null;end;
if (select decision from pcs_prospect_requests where id='${id}')<>'qualified' or (select updated_at::text from pcs_prospect_requests where id='${id}')<>'${version}' or (select count(*) from audit_logs)<>0 then raise exception 'partial rejection on audit error';end if;
alter table audit_logs drop constraint qa_audit_fail;
update pcs_prospect_requests set updated_at=clock_timestamp() where id='${id}';
${statement()};if result is not null then raise exception 'stale version accepted';end if;
update pcs_prospect_requests set updated_at='${version}' where id='${id}';
${statement(other)};if result is not null or (select count(*) from audit_logs)<>0 then raise exception 'missing record mutated';end if;
${statement()};
if result->>'decision'<>'rejected' or result->>'direction' is not null or result->>'outreach_status'<>'not_applicable' or result->>'reason'<>'Seller advertisement' or (select count(*) from audit_logs)<>1 then raise exception 'wrong rejection receipt';end if;
if (select message_text from pcs_prospect_requests where id='${id}')<>'Seller ad' or (select contact_id from pcs_prospect_requests where id='${id}')<>'qa-existing-contact' or not (select author_verified from pcs_prospect_requests where id='${id}') then raise exception 'identity/message changed';end if;
if not exists(select 1 from audit_logs where id='${request_id}' and payload->'receipt'=result and payload->'input'->>'reason'='Seller advertisement' and payload->'before'->>'decision'='qualified') then raise exception 'replay marker missing';end if;
${worker};if worker_count<>0 or (select decision from pcs_prospect_requests where id='${id}')<>'rejected' or (select count(*) from audit_logs)<>1 then raise exception 'worker overwrote manual rejection';end if;
${statement()};if result is not null or (select count(*) from audit_logs)<>1 then raise exception 'duplicate mutation';end if;
raise exception using errcode='Z0001',message='QA rollback';exception when sqlstate 'Z0001' then null;end;end $qa$;`);
