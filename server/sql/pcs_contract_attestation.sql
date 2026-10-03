-- Existing contract data and audit log; only the authenticated Edge service may call this.
create or replace function public.pcs_confirm_contract_fact(
  p_contract_id uuid, p_kind text, p_occurred_at timestamptz,
  p_operator_name text, p_note text, p_actor text, p_confirmed boolean
) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare c public.pcs_contracts%rowtype; fact jsonb; fact_key text; recorded timestamptz := now();
begin
  if p_confirmed is distinct from true then raise exception 'confirmation_required'; end if;
  if p_kind not in ('signature','handover','return') or p_kind is null then raise exception 'invalid_confirmation_kind'; end if;
  if p_occurred_at is null or p_occurred_at > recorded or p_occurred_at < '2000-01-01'::timestamptz then raise exception 'invalid_confirmation_date'; end if;
  if length(trim(coalesce(p_operator_name,''))) not between 2 and 120 then raise exception 'operator_name_required'; end if;
  if length(trim(coalesce(p_note,''))) not between 5 and 1000 then raise exception 'confirmation_note_required'; end if;
  if p_actor is null or p_actor not like 'admin-session:%' then raise exception 'confirmation_actor_required'; end if;
  select * into c from public.pcs_contracts where id=p_contract_id for update;
  if not found then raise exception 'contract_not_found'; end if;
  if c.status not in ('ready_to_sign','signed') or jsonb_array_length(coalesce(c.missing_fields,'[]'))>0 then raise exception 'contract_not_ready_to_sign'; end if;
  if exists(select 1 from public.pcs_contracts where reservation_id=c.reservation_id and version>c.version and status not in ('superseded','cancelled')) then raise exception 'contract_not_current'; end if;
  fact_key := case when p_kind='signature' then 'signature_confirmation' when p_kind='handover' then 'handover_confirmation' else 'return_confirmation' end;
  if (coalesce(c.handover_data,'{}')->fact_key) is not null or (p_kind='signature' and c.status='signed') then raise exception 'fact_already_confirmed'; end if;
  if p_kind='return' then
    if c.handover_data->'handover_confirmation' is null then raise exception 'handover_required'; end if;
    if p_occurred_at < (c.handover_data->'handover_confirmation'->>'occurred_at')::timestamptz then raise exception 'return_before_handover'; end if;
  end if;
  fact := jsonb_build_object('method','operator_attestation','occurred_at',p_occurred_at,'confirmed_at',recorded,'operator_name',trim(p_operator_name),'note',trim(p_note),'actor',p_actor);
  update public.pcs_contracts set
    handover_data=coalesce(handover_data,'{}')||jsonb_build_object(fact_key,fact),
    status=case when p_kind='signature' then 'signed' else status end,
    signed_at=case when p_kind='signature' then p_occurred_at else signed_at end,
    updated_at=recorded
    where id=p_contract_id returning * into c;
  insert into public.pcs_contract_events(contract_id,event_type,payload,actor)
    values(p_contract_id,case when p_kind='signature' then 'previous_signature_confirmed' when p_kind='handover' then 'vehicle_handover_confirmed' else 'vehicle_return_confirmed' end,fact,p_actor);
  return to_jsonb(c);
end $$;
revoke all on function public.pcs_confirm_contract_fact(uuid,text,timestamptz,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.pcs_confirm_contract_fact(uuid,text,timestamptz,text,text,text,boolean) to service_role;
