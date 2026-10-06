import {dataQualityQuery} from '../server/supabase/pcs-manager-live2/data-quality.mjs';
const query=v=>dataQualityQuery(v).query.replaceAll('$1','0');
const sql=`do $qa$ declare r jsonb;begin
create temp table contacts(like public.contacts including defaults including constraints) on commit drop;
insert into contacts(id,name,status,telegram_user_id,phone,next_action,next_action_at) values
('qa-a','QA A','NEW',123456789,'+66 (812) 345-678','Call',(now() at time zone 'UTC')-interval '1 hour'),
('qa-b','QA B','QUALIFIED',123456789,'+66812345678','Confirm',null),
('qa-c','QA C','COMPLETED',-1,'66812345678','Past terminal',(now() at time zone 'UTC')-interval '1 hour'),
('qa-d','QA D','NEW',0,'+66 812345678 ext1',' ',null),
('qa-e','QA E','LOST',0,'+66 812345678 ext1','Terminal missing',null),
('qa-f','QA F','NEW',-2,'123','Future',(now() at time zone 'UTC')+interval '1 day'),
('qa-g','QA G','SPAM',-3,'123','Spam',(now() at time zone 'UTC')-interval '1 hour');
select jsonb_agg(t) into r from (${query('telegram')})t;
if coalesce(jsonb_array_length(r),0)<>2 or r->0->>'duplicate_count'<>'2' then raise exception 'telegram quality assertion';end if;
select jsonb_agg(t) into r from (${query('phone')})t;
if coalesce(jsonb_array_length(r),0)<>2 or r->0->>'match_key'<>'+66812345678' then raise exception 'phone quality assertion';end if;
select jsonb_agg(t) into r from (${query('overdue')})t;
if coalesce(jsonb_array_length(r),0)<>1 or r->0->>'id'<>'qa-a' or r->0->>'next_action_at' not like '%+00:00' then raise exception 'overdue quality assertion';end if;
select jsonb_agg(t) into r from (${query('missing_date')})t;
if coalesce(jsonb_array_length(r),0)<>1 or r->0->>'id'<>'qa-b' then raise exception 'missing date assertion';end if;
insert into contacts(id,name,status,telegram_user_id) select 'qa-batch-'||n,'Batch','NEW',7777777 from generate_series(1,55)n;
select jsonb_agg(t) into r from (${query('telegram')})t;
if coalesce(jsonb_array_length(r),0)<>51 or r->0->>'duplicate_count'<>'55' then raise exception 'lookahead assertion';end if;
end $qa$;`;
process.stdout.write(JSON.stringify({query:sql}));
