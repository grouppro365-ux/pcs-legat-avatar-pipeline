import {applicationFollowupQuery,applicationQueueQuery} from '../server/supabase/pcs-manager-live2/application-workspace.mjs';
const id='90000000-0000-4000-8000-000000000035',b={id,expected_version:'a'.repeat(32),follow_up_at:'2026-10-08T12:00:00.000Z',follow_up_note:'QA followup'};
const literal=v=>v===null?'null':Array.isArray(v)?'ARRAY['+v.map(literal).join(',')+']':"'"+String(v).replaceAll("'","''")+"'";
function statement(input){const x=applicationFollowupQuery(input);return x.query.replace(/\$(\d+)/g,(_,n)=>n==='2'?'v_version':literal(x.params[Number(n)-1])).replace(' ) select a.id,',' ) select count(*) into v_count from (select a.id,')+') result;';}
const edit=statement(b),clear=statement({...b,follow_up_at:null,follow_up_note:''}),queue=applicationQueueQuery('followup','0','QA');
const query=`do $qa$ declare v_version text;v_count int;v_audit int;begin
 create temp table applications (like public.applications including defaults including constraints) on commit drop;
 create temp table audit_events (like public.audit_events including defaults) on commit drop;
 create temp table catalog_items(id uuid,title text) on commit drop;
 insert into applications(id,public_id,client_name,category,operational_status) values('${id}','APP-QA-WORKSPACE','QA Workspace','general','NEW');
 select md5(to_jsonb(a)::text) into v_version from applications a where id='${id}';
 ${edit}
 if v_count<>1 or (select follow_up_note from applications where id='${id}')<>'QA followup' or (select follow_up_at from applications where id='${id}')<>'2026-10-08T12:00:00Z'::timestamptz then raise exception 'schedule assertion';end if;
 if (select count(*) from audit_events where action='application_follow_up_updated')<>1 then raise exception 'audit assertion';end if;
 ${edit}
 if v_count<>0 then raise exception 'stale assertion';end if;
 select md5(to_jsonb(a)::text) into v_version from applications a where id='${id}';
 ${edit}
 if v_count<>1 or (select count(*) from audit_events)<>1 then raise exception 'no-op assertion';end if;
 alter table audit_events add constraint qa_audit_fail check(action<>'application_follow_up_updated') not valid;
 begin ${clear} raise exception 'audit failure expected';exception when check_violation then null;end;
 if (select follow_up_note from applications where id='${id}')<>'QA followup' or (select md5(to_jsonb(a)::text) from applications a where id='${id}')<>v_version then raise exception 'audit rollback assertion';end if;
 alter table audit_events drop constraint qa_audit_fail;
 ${clear}
 if v_count<>1 or (select follow_up_at from applications where id='${id}') is not null or (select follow_up_note from applications where id='${id}') is not null then raise exception 'clear assertion';end if;
 update applications set operational_status='COMPLETED' where id='${id}';
 select md5(to_jsonb(a)::text) into v_version from applications a where id='${id}';
 ${edit}
 if v_count<>0 then raise exception 'terminal assertion';end if;
end $qa$;`;
process.stdout.write(JSON.stringify({query}));
