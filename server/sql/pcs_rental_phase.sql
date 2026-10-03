create or replace function public.pcs_record_rental_phase(p_contract_id uuid,p_status text,p_actor text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare c public.pcs_contracts%rowtype; r public.pcs_reservations%rowtype; old_status text;
begin
 if p_status is null or p_status not in ('active','completed') then raise exception 'invalid_rental_transition'; end if;
 if p_actor is null or p_actor not like 'admin-session:%' then raise exception 'confirmation_actor_required'; end if;
 select * into c from public.pcs_contracts where id=p_contract_id for update;
 if not found then raise exception 'contract_not_found'; end if;
 if c.status not in ('ready_to_sign','signed') then raise exception 'contract_not_ready_to_sign'; end if;
 if exists(select 1 from public.pcs_contracts where reservation_id=c.reservation_id and version>c.version and status not in ('superseded','cancelled')) then raise exception 'contract_not_current'; end if;
 if c.handover_data->'handover_confirmation' is null then raise exception 'handover_required'; end if;
 if p_status='completed' and c.handover_data->'return_confirmation' is null then raise exception 'return_required'; end if;
 select * into r from public.pcs_reservations where id=c.reservation_id for update;
 if not found then raise exception 'reservation_not_found'; end if;
 if r.status not in ('confirmed','active','completed') or (r.status='completed' and p_status='active') then raise exception 'invalid_rental_transition'; end if;
 old_status:=r.status;
 update public.pcs_reservations set status=p_status,updated_at=now() where id=r.id;
 if not exists(select 1 from public.pcs_contract_events where contract_id=c.id and event_type='rental_status_updated' and payload->>'status'=p_status) then
  insert into public.pcs_contract_events(contract_id,event_type,payload,actor)
   values(c.id,'rental_status_updated',jsonb_build_object('previous_status',old_status,'status',p_status),p_actor);
 end if;
 return jsonb_build_object('reservation_id',r.id,'status',p_status);
end $$;
revoke all on function public.pcs_record_rental_phase(uuid,text,text) from public,anon,authenticated;
grant execute on function public.pcs_record_rental_phase(uuid,text,text) to service_role;
