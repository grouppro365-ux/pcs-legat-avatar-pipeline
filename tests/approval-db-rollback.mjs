import {approvalClaimQuery,approvalRejectQuery,approvalReceiptQuery} from '../server/supabase/pcs-manager-live2/approval-policy.mjs';
const cid='pcs-qa-approval-20261004',cv=cid+'-cv',conn=cid+'-conn',gid=cid+'-generation',source=cid+'-source',audit=cid+'-audit';
const literal=v=>"'"+String(v).replaceAll("'","''")+"'";
const b={id:gid,expected_version:'variable',text:'QA reviewed'};
function stmt(item,version=true){
 let q=item.query.replace(/\$(\d+)/g,(_,n)=>version&&n==='2'?'v_version':literal(item.params[Number(n)-1]));
 return q.replace(/select i\.\*,cv\.chat_id::text chat_id from inserted i join conversations cv on cv.id=i.conversation_id$/, 'select count(*) into v_count from inserted').replace(/select id from (changed|written)$/, 'select count(*) into v_count from $1')+';';
}
const claim=stmt(approvalClaimQuery(b)),reject=stmt(approvalRejectQuery(b,audit)),finish=stmt(approvalReceiptQuery(gid,123,audit),false);
const other={...b,id:gid+'-reject'};
const query=`do $qa$ declare v_version text;v_count int;begin begin
insert into contacts(id,telegram_user_id,name) values('${cid}',-900000000051,'QA');
insert into telegram_connections(id,connection_id,business_user_id,user_chat_id,rights,enabled,connected_at) values('${conn}','${conn}',900000000051,900000000051,'{"can_reply":true}',true,now());
insert into conversations(id,connection_id,chat_id,contact_id) values('${cv}','${conn}',900000000051,'${cid}');
insert into messages(id,conversation_id,business_connection_id,direction,text) values('${source}','${cv}','${conn}','IN','QA source');
insert into ai_generations(id,conversation_id,source_message_id,provider,model,intent,confidence,risk,requires_human,answer,policy_decision,policy_reason,status) values('${gid}','${cv}','${source}','QA','QA','QA',1,'QA',true,'QA reviewed','QA','QA','APPROVAL_REQUIRED');
select updated_at::text into v_version from ai_generations where id='${gid}';
update telegram_connections set enabled=false where id='${conn}';
${claim}
if v_count<>0 then raise exception 'disabled connection assertion';end if;
update telegram_connections set enabled=true where id='${conn}';
${claim}
if v_count<>1 then raise exception 'claim assertion';end if;
${claim}
if v_count<>0 then raise exception 'stale concurrent claim assertion';end if;
${reject}
if v_count<>0 then raise exception 'stale rejection assertion';end if;
select updated_at::text into v_version from ai_generations where id='${gid}';
${reject}
if v_count<>0 then raise exception 'held delivery rejection assertion';end if;
update messages set status='FAILED',raw=jsonb_set(raw,'{approval_send,stage}','"rejected"') where id='approval:${gid}';
${claim}
if v_count<>1 then raise exception 'known rejected retry assertion';end if;
insert into audit_logs(id,actor,action) values('${audit}','QA','QA');
begin ${finish} raise exception 'audit collision expected';exception when unique_violation then null;end;
if (select status from messages where id='approval:${gid}')<>'PROCESSING' or (select status from ai_generations where id='${gid}')<>'APPROVAL_REQUIRED' then raise exception 'receipt rollback assertion';end if;
delete from audit_logs where id='${audit}';
${finish}
if v_count<>1 or (select status from ai_generations where id='${gid}')<>'SENT' then raise exception 'receipt assertion';end if;
${finish}
if v_count<>0 or (select count(*) from audit_logs where id='${audit}')<>1 then raise exception 'repeat receipt assertion';end if;
insert into ai_generations(id,conversation_id,source_message_id,provider,model,intent,confidence,risk,requires_human,answer,policy_decision,policy_reason,status) values('${other.id}','${cv}','${source}','QA','QA','QA',1,'QA',true,'QA reviewed','QA','QA','APPROVAL_REQUIRED');
select updated_at::text into v_version from ai_generations where id='${other.id}';
begin ${stmt(approvalRejectQuery(other,audit))} raise exception 'reject audit collision expected';exception when unique_violation then null;end;
if (select status from ai_generations where id='${other.id}')<>'APPROVAL_REQUIRED' then raise exception 'reject audit rollback assertion';end if;
${stmt(approvalRejectQuery(other,audit+'-reject'))}
if v_count<>1 then raise exception 'successful rejection assertion';end if;
${stmt(approvalRejectQuery(other,audit+'-reject'))}
if v_count<>0 or (select count(*) from audit_logs where id='${audit}-reject')<>1 then raise exception 'rejection duplicate audit assertion';end if;
${stmt(approvalClaimQuery(other))}
if v_count<>0 then raise exception 'rejected generation cannot send';end if;
raise exception using errcode='Z0001',message='QA rollback';exception when sqlstate 'Z0001' then null;end;end $qa$;`;
process.stdout.write(JSON.stringify({query}));
