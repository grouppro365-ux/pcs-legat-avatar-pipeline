// Prints a database assertion query. Execute only against the verified PCS operational schema.
// All synthetic writes are rolled back inside an exception subtransaction.
import {contactUpdateQuery,taskCreateQuery,taskCompleteQuery} from '../server/supabase/pcs-manager-live2/crm-policy.mjs';
const cid='pcs-qa-crm-20261003',tid='pcs-qa-task-20261003';
const literal=v=>v===null?'null':"'"+String(v).replaceAll("'","''")+"'";
function block(q,versionVariable=false){
 const sql=q.query.replace(/\$(\d+)/g,(_,n)=>versionVariable&&Number(n)===3?'v_version':literal(q.params[Number(n)-1]));
 const i=Math.max(sql.indexOf(' select changed.*'),sql.indexOf(' select created.*'));
 return sql.slice(0,i)+', result as ('+sql.slice(i+1)+') select count(*) into v_count from result;';
}
const change=block(contactUpdateQuery(cid,{expected_version:'2026-10-03 00:00:00',name:'QA updated'},'pcs-qa-audit-edit'),true);
const create=block(taskCreateQuery(cid,{id:tid,title:'QA task',comment:null,due_at:null},'pcs-qa-audit-task'));
const wrong=block(taskCompleteQuery('pcs-qa-wrong-contact',tid,'pcs-qa-audit-wrong'));
const complete=block(taskCompleteQuery(cid,tid,'pcs-qa-audit-done'));
const auditFailure=block(contactUpdateQuery(cid,{expected_version:'2026-10-03 00:00:00',name:'must rollback'},'pcs-qa-audit-task'),true);
const query=`do $qa$ declare v_version text; v_count int; begin begin
insert into contacts(id,telegram_user_id,name) values('${cid}',-900000000031,'QA before');
select updated_at::text into v_version from contacts where id='${cid}';
${change}
if v_count<>1 or (select name from contacts where id='${cid}')<>'QA updated' then raise exception 'edit assertion';end if;
${change}
if v_count<>0 then raise exception 'stale edit assertion';end if;
${create}
if v_count<>1 then raise exception 'create assertion';end if;
${create}
if v_count<>1 or (select count(*) from audit_logs where id='pcs-qa-audit-task')<>1 then raise exception 'retry assertion';end if;
${wrong}
if v_count<>0 or (select completed_at from tasks where id='${tid}') is not null then raise exception 'ownership assertion';end if;
${complete}
if v_count<>1 then raise exception 'complete assertion';end if;
${complete}
if v_count<>1 or (select count(*) from audit_logs where id='pcs-qa-audit-done')<>1 then raise exception 'complete retry assertion';end if;
select updated_at::text into v_version from contacts where id='${cid}';
begin ${auditFailure} raise exception 'audit failure expected';exception when unique_violation then null;end;
if (select name from contacts where id='${cid}')<>'QA updated' then raise exception 'audit rollback assertion';end if;
raise exception using errcode='Z0001',message='rollback successful QA';
exception when sqlstate 'Z0001' then null;end;end $qa$;`;
process.stdout.write(JSON.stringify({query}));
