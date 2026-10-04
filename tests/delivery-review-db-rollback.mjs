import {deliveryReviewQuery} from '../server/supabase/pcs-manager-live2/delivery-review.mjs';
const cid='pcs-qa-deliveryreview-20261004',cv=cid+'-cv',mid='99999999-9999-4999-8999-999999999975',aid=cid+'-audit',base={message_id:mid,expected_version:'2026-10-04 00:00:00.123456',note:'QA manual conversation attestation',confirmed:true};
const lit=v=>"'"+String(v).replaceAll("'","''")+"'";
function stmt(q){return q.query.replace(/\$(\d+)/g,(_,n)=>n==='3'?'v_version':lit(q.params[Number(n)-1])).replace(/select written\.\* from written where exists\(select 1 from audited\)$/,'select count(*) into v_count from written where exists(select 1 from audited)')+';'}
const review=stmt(deliveryReviewQuery(cid,base,aid));
const query=`do $qa$ declare v_version text;v_count int;begin begin
insert into contacts(id,telegram_user_id,name) values('${cid}',-900000000075,'QA delivery review');
insert into telegram_connections(id,connection_id,business_user_id,user_chat_id,rights,enabled,connected_at) values('${cid}-conn','qa-delivery-connection',900000000075,900000000075,'{"can_reply":true}',true,now());
insert into conversations(id,connection_id,chat_id,contact_id) values('${cv}','qa-delivery-connection',900000000075,'${cid}');
insert into messages(id,conversation_id,business_connection_id,direction,status,text,raw) values('${mid}','${cv}','qa-delivery-connection','OUT','PROCESSING','QA attempt',jsonb_build_object('manual_send',jsonb_build_object('contact_id','${cid}','stage','sending')));
select updated_at::text into v_version from messages where id='${mid}';
${stmt(deliveryReviewQuery(cid+'-wrong',base,aid+'-wrong'))}
if v_count<>0 then raise exception 'contact scope assertion';end if;
update messages set raw=raw||'{"approval_send":{"stage":"sending"}}'::jsonb where id='${mid}';
${review}
if v_count<>0 then raise exception 'AI scope assertion';end if;
update messages set raw=raw-'approval_send' where id='${mid}';
insert into audit_logs(id,actor,action) values('${aid}','QA','collision');
begin ${review} raise exception 'audit failure expected';exception when unique_violation then null;end;
if (select status from messages where id='${mid}')<>'PROCESSING' or (select raw ? 'delivery_review' from messages where id='${mid}') then raise exception 'audit rollback assertion';end if;
delete from audit_logs where id='${aid}';
${review}
if v_count<>1 or (select status from messages where id='${mid}')<>'SENT' or (select raw->'delivery_review'->>'method' from messages where id='${mid}')<>'operator_attestation' or (select raw->'manual_send'->>'stage' from messages where id='${mid}')<>'sent' then raise exception 'confirmation assertion';end if;
if (select telegram_message_id from messages where id='${mid}') is not null or (select sent_at from messages where id='${mid}') is not null then raise exception 'provider facts must remain unknown';end if;
${review}
if v_count<>0 or (select count(*) from audit_logs where id='${aid}')<>1 then raise exception 'duplicate and stale assertion';end if;
raise exception using errcode='Z0001',message='QA rollback';exception when sqlstate 'Z0001' then null;end;end $qa$;`;
process.stdout.write(JSON.stringify({query}));
