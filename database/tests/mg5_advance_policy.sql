-- Run in a transaction and roll back: no synthetic requests persist.
do $$
declare
  source_request public.pcs_booking_requests%rowtype;
  got numeric;
  test_id uuid;
begin
  if public.pcs_mg5_booking_advance('MG MG5 Pro', 'pcs_owned', 'THB', 1320) is distinct from 1000::numeric
     or public.pcs_mg5_booking_advance('MG5', 'pcs_owned', 'THB', 1980) is distinct from 1000::numeric
     or public.pcs_mg5_booking_advance('MG5', 'pcs_owned', 'THB', 2000) is distinct from 2000::numeric
     or public.pcs_mg5_booking_advance('MG5', 'pcs_owned', 'THB', 660) is distinct from 660::numeric
     or public.pcs_mg5_booking_advance('MG50', 'pcs_owned', 'THB', 5000) is not null
     or public.pcs_mg5_booking_advance('Ford Fiesta', 'pcs_owned', 'THB', 5000) is not null
     or public.pcs_mg5_booking_advance('MG5', 'partner', 'THB', 5000) is not null
     or public.pcs_mg5_booking_advance('MG5', 'pcs_owned', 'RUB', 5000) is not null
     or public.pcs_mg5_booking_advance('MG5', 'pcs_owned', 'THB', 0) is not null
  then raise exception 'MG5 calculation regression'; end if;

  select r.* into strict source_request from public.pcs_booking_requests r
    join public.pcs_catalog_items c on c.id=r.catalog_item_id
    where c.ownership_type='pcs_owned' and c.title ~* '\mMG[[:space:]]*5\M' limit 1;
  insert into public.pcs_booking_requests(contact_id,offer_id,catalog_item_id,start_date,end_date,rental_total,currency)
    values(source_request.contact_id,'rollback-mg5-'||gen_random_uuid(),source_request.catalog_item_id,
      source_request.start_date,source_request.end_date,1320,'THB')
    returning id,booking_deposit_amount into test_id,got;
  if got is distinct from 1000::numeric then raise exception 'MG5 insert trigger regression'; end if;
  update public.pcs_booking_requests set booking_deposit_amount=900 where id=test_id;
  select booking_deposit_amount into got from public.pcs_booking_requests where id=test_id;
  if got is distinct from 900::numeric then raise exception 'Manager override overwritten'; end if;
  insert into public.pcs_booking_requests(contact_id,offer_id,catalog_item_id,start_date,end_date,rental_total,currency,booking_deposit_amount)
    values(source_request.contact_id,'rollback-mg5-'||gen_random_uuid(),source_request.catalog_item_id,
      source_request.start_date,source_request.end_date,1320,'THB',700)
    returning booking_deposit_amount into got;
  if got is distinct from 700::numeric then raise exception 'Explicit advance overwritten'; end if;
end $$;
