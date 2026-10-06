-- Existing PCS knowledge source. Invoke only after current PCS admin authentication.
create or replace function public.pcs_knowledge_save_v1(p_id uuid,p_expected_revision integer,p_record jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $fn$
declare previous public.pcs_knowledge_items; saved public.pcs_knowledge_items; input public.pcs_knowledge_items;
begin
 select * into input from jsonb_populate_record(null::public.pcs_knowledge_items,p_record);
 if input.title is null or input.category is null or input.description is null or input.status is null or input.status not in ('active','draft','outdated','disabled') or input.visibility is null or input.visibility not in ('customer_safe','approval_only','internal_only') or input.auto_answer_allowed is null or input.price<0 then raise exception 'invalid_knowledge';end if;
 if input.auto_answer_allowed and (input.status<>'active' or input.visibility<>'customer_safe' or input.valid_until<now()) then raise exception 'invalid_knowledge_authority';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into previous from public.pcs_knowledge_items where id=p_id for update;
 if p_expected_revision is null then
  if previous.id is not null then
   if exists(select 1 from public.pcs_audit_logs where entity_type='pcs_knowledge_items' and entity_id=p_id::text and action='knowledge_created' and payload->>'fingerprint'=md5(p_record::text)) and previous.revision=1 then return (to_jsonb(previous)-'media')||jsonb_build_object('price',previous.price::text);end if;
   raise exception 'knowledge_conflict' using errcode='40001';
  end if;
  insert into public.pcs_knowledge_items(id,title,category,description,city,price,currency,conditions,restrictions,source,visibility,status,auto_answer_allowed,valid_until,operator_comment,answer_guidance,verified_at,revision)
  values(p_id,input.title,input.category,input.description,input.city,input.price,input.currency,input.conditions,input.restrictions,input.source,input.visibility,input.status,input.auto_answer_allowed,input.valid_until,input.operator_comment,input.answer_guidance,now(),1) returning * into saved;
 else
  if previous.id is null then raise exception 'knowledge_missing' using errcode='P0002';end if;
  if previous.revision<>p_expected_revision then raise exception 'knowledge_conflict' using errcode='40001';end if;
  update public.pcs_knowledge_items set title=input.title,category=input.category,description=input.description,city=input.city,price=input.price,currency=input.currency,conditions=input.conditions,restrictions=input.restrictions,source=input.source,visibility=input.visibility,status=input.status,auto_answer_allowed=input.auto_answer_allowed,valid_until=input.valid_until,operator_comment=input.operator_comment,answer_guidance=input.answer_guidance,verified_at=now(),revision=previous.revision+1,updated_at=clock_timestamp() where id=p_id returning * into saved;
 end if;
 insert into public.pcs_audit_logs(actor,action,entity_type,entity_id,payload)
 values('pcs-manager-admin',case when p_expected_revision is null then 'knowledge_created' else 'knowledge_updated' end,'pcs_knowledge_items',p_id::text,jsonb_build_object('revision',saved.revision,'fields',(select jsonb_agg(k) from jsonb_object_keys(p_record)k),'fingerprint',md5(p_record::text)));
 return (to_jsonb(saved)-'media')||jsonb_build_object('price',saved.price::text);
end $fn$;
revoke all on function public.pcs_knowledge_save_v1(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.pcs_knowledge_save_v1(uuid,integer,jsonb) to service_role;
