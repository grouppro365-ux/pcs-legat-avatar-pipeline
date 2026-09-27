-- Owner-approved MG5 advance. Applies only to NEW own-fleet requests;
-- explicit manager amounts and all existing requests remain unchanged.
create or replace function public.pcs_mg5_booking_advance(
  p_title text, p_ownership text, p_currency text, p_total numeric
) returns numeric language sql immutable security invoker set search_path='' as $$
  select case when p_ownership='pcs_owned' and p_currency='THB'
    and p_title ~* '\m(MG|МГ)[[:space:]]*5\M'
    and p_total>0 and p_total<'Infinity'::numeric and p_total<>'NaN'::numeric
    then least(p_total,case when p_total<2000 then 1000 else 2000 end)
    else null end;
$$;
revoke all on function public.pcs_mg5_booking_advance(text,text,text,numeric) from public,anon,authenticated;
grant execute on function public.pcs_mg5_booking_advance(text,text,text,numeric) to service_role;

create or replace function public.pcs_default_booking_advance()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.booking_deposit_amount is null and new.status='collecting'
     and new.payment_status='not_requested' then
    select public.pcs_mg5_booking_advance(c.title,c.ownership_type,new.currency,new.rental_total)
      into new.booking_deposit_amount from public.pcs_catalog_items c
      where c.id=new.catalog_item_id and c.category='car_rent' and c.deleted_at is null;
  end if;
  return new;
end;
$$;
revoke all on function public.pcs_default_booking_advance() from public,anon,authenticated;
grant execute on function public.pcs_default_booking_advance() to service_role;
create trigger pcs_booking_advance_on_insert before insert on public.pcs_booking_requests
  for each row execute function public.pcs_default_booking_advance();

alter table public.pcs_payment_routes
  add column payment_currency text not null default 'THB',
  add column exchange_rate_from_thb numeric(12,6) not null default 1,
  add constraint pcs_payment_route_currency_check check (
    (payment_currency='THB' and exchange_rate_from_thb=1) or
    (payment_currency='RUB' and exchange_rate_from_thb>0 and exchange_rate_from_thb<'Infinity'::numeric)
  );
