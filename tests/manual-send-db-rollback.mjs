// Capture production queries; run synthetic assertions in a rolled-back subtransaction.
import {sendManualMessage,ProviderRejection} from '../server/supabase/pcs-manager-live2/manual-send.mjs';
const cid='pcs-qa-send-20261004',cv='pcs-qa-send-conversation-20261004',conn='pcs-qa-send-connection-20261004';
const rid='11111111-1111-4111-8111-111111111111',queries=[];
let prior=null;
const sql={query:async(q,p)=>{
 queries.push({q,p});
 if(q.startsWith('select m.*'))return prior?[prior]:[];
 if(q.startsWith('select cv.id'))return[{id:cv,connection_id:conn,chat_id:'900000000041',enabled:true,rights:{can_reply:true}}];
 return[{id:rid}];
}};
await sendManualMessage(sql,cid,{request_id:rid,text:'QA reviewed'},async()=>({message_id:123}));
await sendManualMessage(sql,cid,{request_id:rid,text:'QA reviewed'},async()=>{throw new ProviderRejection()}).catch(()=>{});
prior={conversation_id:cv,request_contact:cid,direction:'OUT',text:'QA reviewed',status:'FAILED',raw:{manual_send:{contact_id:cid,stage:'rejected'}}};
await sendManualMessage(sql,cid,{request_id:rid,text:'QA reviewed'},async()=>({message_id:123}));
const literal=v=>v===null?'null':"'"+String(v).replaceAll("'","''")+"'";
function statement(prefix,overrides={}){
 const item=queries.find(x=>x.q.startsWith(prefix));
 const q=item.q.replace(/\$(\d+)/g,(_,n)=>literal(overrides[n]??item.p[Number(n)-1]));
 return q.startsWith('with written')?q.replace(/select id from written$/, 'select count(*) into v_count from written;'):`with qa_result as (${q}) select count(*) into v_count from qa_result;`;
}
const claim=statement('insert into messages'),finish=statement('with written'),reject=statement("update messages set status='FAILED'"),retry=statement("update messages set status='PROCESSING'");
const failureId='22222222-2222-4222-8222-222222222222';
const auditId=queries.find(x=>x.q.startsWith('with written')).p[3];
const query=`do $qa$ declare v_count int; begin begin
insert into contacts(id,telegram_user_id,name) values('${cid}',-900000000041,'QA');
insert into telegram_connections(id,connection_id,business_user_id,user_chat_id,rights,enabled,connected_at) values('${conn}','${conn}',900000000041,900000000041,'{"can_reply":true}',true,now());
insert into conversations(id,connection_id,chat_id,contact_id) values('${cv}','${conn}',900000000041,'${cid}');
${claim}
if v_count<>1 then raise exception 'claim assertion';end if;
${claim}
if v_count<>0 then raise exception 'duplicate claim assertion';end if;
${reject}
if v_count<>1 then raise exception 'rejection assertion';end if;
${retry}
if v_count<>1 then raise exception 'retry assertion';end if;
${retry}
if v_count<>0 then raise exception 'concurrent retry assertion';end if;
${finish}
if v_count<>1 or (select status from messages where id='${rid}')<>'SENT' or (select telegram_message_id from messages where id='${rid}')<>123 then raise exception 'receipt assertion';end if;
${finish}
if v_count<>0 or (select count(*) from audit_logs where id='${auditId}')<>1 then raise exception 'receipt replay assertion';end if;
${statement('insert into messages',{1:failureId})}
begin ${statement('with written',{1:failureId,4:auditId})} raise exception 'audit failure expected';exception when unique_violation then null;end;
if (select status from messages where id='${failureId}')<>'PROCESSING' or (select telegram_message_id from messages where id='${failureId}') is not null then raise exception 'atomic receipt assertion';end if;
raise exception using errcode='Z0001',message='rollback successful QA';
exception when sqlstate 'Z0001' then null;end;end $qa$;`;
process.stdout.write(JSON.stringify({query}));
