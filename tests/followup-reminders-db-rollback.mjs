import {followupReminderQuery} from '../server/supabase/pcs-manager-live2/followup-reminders.mjs';
import {terminalApplicationStatuses} from '../server/supabase/pcs-manager-live2/operations-read.mjs';
const id='90000000-0000-4000-8000-000000000036';
const run=followupReminderQuery.replace('$1','ARRAY['+terminalApplicationStatuses.map(x=>"'"+x+"'").join(',')+']').replace('select count(*)::int created from created','select count(*)::int into v_count from created')+';';
const query=`do $qa$ declare v_count int;v_total int;begin
 create temp table applications(like public.applications including defaults including constraints) on commit drop;
 create temp table notifications(like public.notifications including defaults including constraints including indexes) on commit drop;
 create temp table audit_events(like public.audit_events including defaults) on commit drop;
 insert into applications(id,public_id,category,operational_status,follow_up_at) values('${id}','APP-QA-REMINDER','general','NEW',now()-interval '1 hour'),(gen_random_uuid(),'APP-QA-FUTURE','general','NEW',now()+interval '1 day'),(gen_random_uuid(),'APP-QA-CLOSED','general','COMPLETED',now()-interval '1 day');
 ${run}
 if v_count<>1 or (select count(*) from notifications)<>1 or (select count(*) from audit_events)<>1 then raise exception 'due assertion';end if;
 if exists(select 1 from notifications where recipient_user_id is not null or recipient_partner_id is not null or channel<>'IN_APP' or sent_at is not null or read_at is not null) then raise exception 'scope assertion';end if;
 ${run}
 if v_count<>0 then raise exception 'dedupe assertion';end if;
 update applications set follow_up_at=now()-interval '2 hours' where id='${id}';
 ${run}
 if v_count<>1 or (select count(*) from notifications)<>2 then raise exception 'reschedule assertion';end if;
 update applications set follow_up_at=now()-interval '3 hours' where id='${id}';
 alter table audit_events add constraint qa_reminder_audit_fail check(action<>'followup_reminder_created') not valid;
 begin ${run} raise exception 'audit failure expected';exception when check_violation then null;end;
 if (select count(*) from notifications)<>2 then raise exception 'atomic rollback assertion';end if;
 alter table audit_events drop constraint qa_reminder_audit_fail;
 update applications set follow_up_at=null where id='${id}';
 ${run}
 if v_count<>0 then raise exception 'clear assertion';end if;
 insert into applications(id,public_id,category,operational_status,follow_up_at) select gen_random_uuid(),'APP-QA-BATCH-'||n,'general','NEW',now()-interval '1 day' from generate_series(1,55) n;
 ${run}
 if v_count<>50 then raise exception 'batch bound assertion';end if;
 ${run}
 if v_count<>5 then raise exception 'batch continuation assertion';end if;
 ${run}
 if v_count<>0 or (select count(*) from notifications)<>57 or (select count(*) from audit_events)<>57 then raise exception 'final dedupe assertion';end if;
end $qa$;`;
process.stdout.write(JSON.stringify({query}));
