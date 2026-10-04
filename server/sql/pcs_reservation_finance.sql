-- Canonical reservation projection. No backfill of independently maintained bookings.
create or replace function public.pcs_reservation_finance_balance(p_reservation_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path=public,pg_temp as $$
declare r public.pcs_reservations%rowtype; gross numeric; returned numeric; net numeric;
 security_amount numeric; security_returned numeric; invalid_count integer; other jsonb; state text;
begin
 select * into r from public.pcs_reservations where id=p_reservation_id;
 if not found then return null; end if;
 select coalesce(sum(amount),0) into gross from public.pcs_finance_entries
 where reservation_id=r.id and status='paid' and currency=r.currency and entry_type='income'
 and coalesce(payment_kind,'') not in ('security_deposit','refundable_deposit');
 select count(*) into invalid_count from public.pcs_finance_entries f
 left join public.pcs_finance_entries original on original.id::text=f.metadata->>'original_finance_entry_id'
 where f.reservation_id=r.id and f.entry_type='refund' and f.status='paid' and
 (original.id is null or original.entry_type<>'income' or original.status<>'paid'
 or original.reservation_id is distinct from f.reservation_id or original.currency<>f.currency
 or coalesce(f.contact_id,r.contact_id) is distinct from coalesce(original.contact_id,r.contact_id)
 or (select coalesce(sum(x.amount),0) from public.pcs_finance_entries x where x.entry_type='refund'
     and x.status='paid' and x.metadata->>'original_finance_entry_id'=original.id::text)>original.amount);
 select coalesce(sum(f.amount),0) into returned from public.pcs_finance_entries f
 join public.pcs_finance_entries original on original.id::text=f.metadata->>'original_finance_entry_id'
 where f.reservation_id=r.id and f.status='paid' and f.entry_type='refund' and f.currency=r.currency
 and original.reservation_id=r.id and original.status='paid' and original.entry_type='income'
 and original.currency=f.currency and coalesce(original.payment_kind,'') not in ('security_deposit','refundable_deposit');
 select coalesce(sum(amount),0) into security_amount from public.pcs_finance_entries
 where reservation_id=r.id and status='paid' and currency=r.currency
 and (entry_type='deposit' or (entry_type='income' and payment_kind in ('security_deposit','refundable_deposit')));
 select coalesce(sum(f.amount),0) into security_returned from public.pcs_finance_entries f
 join public.pcs_finance_entries original on original.id::text=f.metadata->>'original_finance_entry_id'
 where f.reservation_id=r.id and f.status='paid' and f.entry_type='refund' and f.currency=r.currency
 and original.reservation_id=r.id and original.status='paid' and original.entry_type='income'
 and original.currency=f.currency and original.payment_kind in ('security_deposit','refundable_deposit');
 select coalesce(jsonb_agg(jsonb_build_object('currency',currency,'entry_type',entry_type,'amount',amount::text)
 order by currency,entry_type),'[]'::jsonb) into other from
 (select currency,entry_type,sum(amount) amount from public.pcs_finance_entries
  where reservation_id=r.id and status='paid' and currency<>r.currency group by currency,entry_type) q;
 net:=gross-returned;
 state:=case when invalid_count>0 then 'unpaid' when gross>0 and returned=gross then 'refunded'
 when net>0 and r.total_amount>0 and net>=r.total_amount then 'paid'
 when net>0 then 'partial' else 'unpaid' end;
 return jsonb_build_object('reservation_id',r.id,'currency',r.currency,'total_amount',r.total_amount::text,
 'total_confirmed',coalesce(r.total_amount>0,false),'gross_paid',gross::text,'refunded',returned::text,
 'net_paid',net::text,'remaining',case when r.total_amount>0 then greatest(r.total_amount-net,0)::text else null end,
 'overpayment',case when r.total_amount>0 then greatest(net-r.total_amount,0)::text else null end,
 'security_deposit_paid',security_amount::text,'security_deposit_refunded',security_returned::text,
 'other_currencies',other,'invalid_refunds',invalid_count,'payment_status',state,'stored_payment_status',r.payment_status);
end $$;

create or replace function public.pcs_recalculate_reservation_finance(p_reservation_id uuid)
returns void language plpgsql volatile security invoker set search_path=public,pg_temp as $$
declare balance jsonb; prior text;
begin
 select payment_status into prior from public.pcs_reservations where id=p_reservation_id for update;
 if not found then return; end if;
 balance:=public.pcs_reservation_finance_balance(p_reservation_id);
 if (balance->>'invalid_refunds')::integer>0 then raise exception 'reservation_refund_requires_matching_paid_original_within_amount'; end if;
 if prior is distinct from balance->>'payment_status' then
  update public.pcs_reservations set payment_status=balance->>'payment_status',updated_at=clock_timestamp() where id=p_reservation_id;
  insert into public.pcs_audit_logs(actor,action,entity_type,entity_id,payload)
  values('pcs-finance-projection','reservation_payment_recalculated','reservation',p_reservation_id::text,
    jsonb_build_object('previous_status',prior,'balance',balance));
 end if;
end $$;

-- Lock affected bookings before changing a line, including both sides of a move.
-- VOLATILE AFTER readers then see the latest committed ledger after a lock wait.
create or replace function public.pcs_lock_finance_reservations()
returns trigger language plpgsql volatile security invoker set search_path=public,pg_temp as $$
declare old_id uuid; new_id uuid;
begin
 if TG_OP<>'INSERT' then old_id:=old.reservation_id; end if;
 if TG_OP<>'DELETE' then new_id:=new.reservation_id; end if;
 perform id from public.pcs_reservations where id in (old_id,new_id) order by id for update;
 if TG_OP='DELETE' and old.reservation_id is not null and old.status='paid' then
  raise exception 'paid_reservation_finance_requires_reversal_not_delete';
 end if;
 if TG_OP='DELETE' then return old; end if;
 return new;
end $$;

create or replace function public.pcs_sync_finance_to_reservation()
returns trigger language plpgsql volatile security invoker set search_path=public,pg_temp as $$
declare old_id uuid; new_id uuid; target uuid;
begin
 if TG_OP<>'INSERT' then old_id:=old.reservation_id; end if;
 if TG_OP<>'DELETE' then new_id:=new.reservation_id; end if;
 for target in select id from public.pcs_reservations where id in (old_id,new_id) order by id loop
  perform public.pcs_recalculate_reservation_finance(target);
 end loop;
 if TG_OP='DELETE' then return old; end if;
 return new;
end $$;

create or replace function public.pcs_sync_reservation_finance_terms()
returns trigger language plpgsql volatile security invoker set search_path=public,pg_temp as $$
begin
 perform public.pcs_recalculate_reservation_finance(new.id);
 return new;
end $$;

drop trigger if exists pcs_finance_sync_reservation on public.pcs_finance_entries;
drop trigger if exists trg_pcs_sync_finance_to_reservation on public.pcs_finance_entries;
drop trigger if exists pcs_finance_reservation_lock on public.pcs_finance_entries;
create trigger pcs_finance_reservation_lock before insert or update or delete on public.pcs_finance_entries
 for each row execute function public.pcs_lock_finance_reservations();
create trigger pcs_finance_sync_reservation after insert or update or delete on public.pcs_finance_entries
 for each row execute function public.pcs_sync_finance_to_reservation();
drop trigger if exists pcs_reservation_finance_terms on public.pcs_reservations;
create trigger pcs_reservation_finance_terms after update of total_amount,currency on public.pcs_reservations
 for each row when (old.total_amount is distinct from new.total_amount or old.currency is distinct from new.currency)
 execute function public.pcs_sync_reservation_finance_terms();

revoke all on function public.pcs_reservation_finance_balance(uuid),public.pcs_recalculate_reservation_finance(uuid),
 public.pcs_lock_finance_reservations(),public.pcs_sync_finance_to_reservation(),public.pcs_sync_reservation_finance_terms()
 from public,anon,authenticated;
grant execute on function public.pcs_reservation_finance_balance(uuid),public.pcs_recalculate_reservation_finance(uuid),
 public.pcs_lock_finance_reservations(),public.pcs_sync_finance_to_reservation(),public.pcs_sync_reservation_finance_terms()
 to service_role;
