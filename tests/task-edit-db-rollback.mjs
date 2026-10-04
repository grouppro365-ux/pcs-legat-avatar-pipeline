import {taskUpdateQuery} from '../server/supabase/pcs-manager-live2/task-edit.mjs';
const cid='pcs-qa-taskedit-20261004',tid=cid+'-task',aid=cid+'-audit',base={task_id:tid,expected_version:'2026-10-04 12:00:00.123456',title:'QA updated',priority:'URGENT',due_at:'2026-10-05T12:00:00.000Z',assignee:'QA operator'};
const literal=v=>v===null?'null':"'"+String(v).replaceAll("'","''")+"'";
function stmt(q){return q.query.replace(/\$(\d+)/g,(_,n)=>n==='4'?'v_version':literal(q.params[Number(n)-1])).replace(/select changed\.\*,changed.updated_at::text edit_version from changed where exists\(select 1 from audited\)$/,'select count(*) into v_count from changed where exists(select 1 from audited)')+';'}
const edit=stmt(taskUpdateQuery(cid,base,aid)),wrong=stmt(taskUpdateQuery(cid+'-other',base,aid+'-wrong')),collision=stmt(taskUpdateQuery(cid,{...base,title:'Must rollback'},aid));
const query=`do $qa$ declare v_version text;v_count int;begin begin
insert into contacts(id,telegram_user_id,name) values('${cid}',-900000000074,'QA task edit');
insert into tasks(id,contact_id,title,comment) values('${tid}','${cid}','QA before','Preserve comment');
select updated_at::text into v_version from tasks where id='${tid}';
${wrong}
if v_count<>0 then raise exception 'ownership assertion';end if;
${edit}
if v_count<>1 or (select title from tasks where id='${tid}')<>'QA updated' or (select comment from tasks where id='${tid}')<>'Preserve comment' or (select due_at from tasks where id='${tid}')<>'2026-10-05 12:00:00'::timestamp or (select priority::text from tasks where id='${tid}')<>'URGENT' then raise exception 'partial edit assertion';end if;
${edit}
if v_count<>0 or (select count(*) from audit_logs where id='${aid}')<>1 then raise exception 'stale edit assertion';end if;
select updated_at::text into v_version from tasks where id='${tid}';
begin ${collision} raise exception 'audit failure expected';exception when unique_violation then null;end;
if (select title from tasks where id='${tid}')<>'QA updated' or (select updated_at::text from tasks where id='${tid}')<>v_version then raise exception 'audit rollback assertion';end if;
update tasks set completed_at=now() where id='${tid}';
${stmt(taskUpdateQuery(cid,{...base,due_at:null},aid+'-completed'))}
if v_count<>0 then raise exception 'completed cannot edit assertion';end if;
raise exception using errcode='Z0001',message='QA rollback';exception when sqlstate 'Z0001' then null;end;end $qa$;`;
process.stdout.write(JSON.stringify({query}));
