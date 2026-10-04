import {saveProspectPage} from '../server/supabase/pcs-manager-live2/prospect-engine.mjs';
const rows=JSON.stringify([{id:'synthetic-request',message_id:'42',message_url:'https://t.me/synthetic_channel/42',published_at:new Date().toISOString(),message_text:'Synthetic request',decision:'qualified',direction:'CAR_RENTAL',reason:'Synthetic',evidence:'Synthetic request',facts:{},outreach_status:'blocked_identity'}]);
const literal=x=>"'"+x.replaceAll("'","''")+"'";
const execute=(lease,body=rows,cursor=42)=>`execute $statement$${saveProspectPage}$statement$ into result using sid,${lease},${literal(body)},'synthetic-model','test-version','Synthetic source',${cursor},null::bigint,null::bigint,1,gen_random_uuid()::text;`;
const changed=JSON.parse(rows);changed[0].id='synthetic-second';changed[0].message_id='43';changed[0].message_text='Second synthetic';
console.log(`do $test$
declare sid text:=gen_random_uuid()::text; rid text:=gen_random_uuid()::text; result record;
begin
 begin
  insert into pcs_prospect_sources(id,username,lease_id,lease_until) values(sid,'pcs_test_'||left(replace(sid,'-',''),20),rid,now()+interval '5 minutes');
  ${execute('rid')}
  if result.saved<>1 or result.source_saved<>1 then raise exception 'page commit failed'; end if;
  if (select cursor_id from pcs_prospect_sources where id=sid)<>42 then raise exception 'cursor did not move'; end if;
  if not exists(select 1 from pcs_prospect_requests where source_id=sid and author_verified=false and contact_id is null and outreach_status='blocked_identity') then raise exception 'unverified author promoted'; end if;
  if not exists(select 1 from audit_logs where entity_id=sid and action='prospect_source_scanned') then raise exception 'audit missing'; end if;
  ${execute('rid')}
  if result.saved<>0 or result.source_saved<>0 then raise exception 'expired lease wrote again'; end if;
  update pcs_prospect_sources set lease_id=rid,lease_until=now()+interval '5 minutes' where id=sid;
  ${execute('rid')}
  if result.saved<>0 or result.source_saved<>1 then raise exception 'duplicate message inserted'; end if;
  update pcs_prospect_sources set lease_id=rid,lease_until=now()+interval '5 minutes' where id=sid;
  execute $ddl$create function pg_temp.pcs_prospect_reject_audit() returns trigger language plpgsql as $fn$ begin raise exception 'synthetic_audit_rejected'; end $fn$$ddl$;
  execute $ddl$create trigger pcs_prospect_test_audit before insert on audit_logs for each row when (new.action='prospect_source_scanned') execute function pg_temp.pcs_prospect_reject_audit()$ddl$;
  begin
   ${execute('rid',JSON.stringify(changed),43)}
   raise exception 'audit failure accepted';
  exception when others then if SQLERRM<>'synthetic_audit_rejected' then raise; end if; end;
  if (select cursor_id from pcs_prospect_sources where id=sid)<>42 or exists(select 1 from pcs_prospect_requests where source_id=sid and telegram_message_id=43) then raise exception 'audit failure did not roll back'; end if;
  raise exception using errcode='Z0001',message='prospecting fixture complete; rollback';
 exception when sqlstate 'Z0001' then null; end;
 if exists(select 1 from pcs_prospect_sources where id=sid) or exists(select 1 from pcs_prospect_requests where source_id=sid) or exists(select 1 from audit_logs where entity_id=sid) then raise exception 'fixture rollback failed'; end if;
end $test$;`);
