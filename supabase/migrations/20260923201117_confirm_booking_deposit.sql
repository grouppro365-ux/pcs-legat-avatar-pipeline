-- Only the server-side service role may record a manually bank-verified
-- booking advance. A photo of a receipt is not evidence of funds received.
create or replace function public.pcs_confirm_booking_deposit(
  p_request_id uuid,
  p_bank_reference text,
  p_actor text
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  booking public.pcs_booking_requests%rowtype;
  receipt public.pcs_media_intake%rowtype;
  finance_id uuid;
  next_status text;
begin
  if length(trim(coalesce(p_bank_reference, ''))) < 6
     or length(p_bank_reference) > 120
     or p_bank_reference ~ '[\r\n]'
     or length(trim(coalesce(p_actor, ''))) < 3 then
    raise exception 'invalid_verification_reference';
  end if;

  select * into booking from public.pcs_booking_requests
    where id = p_request_id for update;
  if not found then raise exception 'booking_request_not_found'; end if;
  if booking.payment_status = 'paid' and booking.finance_entry_id is not null then
    return jsonb_build_object('request_id', booking.id,
      'finance_entry_id', booking.finance_entry_id,
      'status', booking.status, 'already_recorded', true);
  end if;
  if booking.status <> 'collecting'
     or booking.payment_status <> 'receipt_pending'
     or booking.booking_deposit_amount is null
     or booking.receipt_media_intake_id is null then
    raise exception 'booking_payment_not_ready_for_verification';
  end if;

  select * into receipt from public.pcs_media_intake
    where id = booking.receipt_media_intake_id;
  if not found or receipt.review_status <> 'approved'
     or receipt.classification <> 'receipt'
     or receipt.contact_id is distinct from booking.contact_id
     or receipt.extracted->>'booking_request_id' is distinct from booking.id::text
     or receipt.extracted->>'storage_bucket' is distinct from 'pcs-contracts'
     or coalesce(receipt.extracted->>'storage_path', '') not like 'booking-requests/' || booking.id::text || '/%' then
    raise exception 'booking_receipt_not_approved';
  end if;

  insert into public.pcs_finance_entries
    (contact_id, entry_type, amount, currency, status, paid_at,
     payment_kind, payment_method, receipt_path, note, metadata)
  values
    (booking.contact_id, 'income', booking.booking_deposit_amount,
     booking.currency, 'paid', now(), 'booking_deposit',
     'bank_transfer', receipt.extracted->>'storage_path',
     'Booking advance verified against bank statement',
     jsonb_build_object('booking_request_id', booking.id,
       'bank_reference', trim(p_bank_reference),
       'verified_by', p_actor, 'receipt_intake_id', receipt.id))
  returning id into finance_id;

  next_status := case
    when booking.passport_status = 'approved'
     and booking.international_permit_status = 'approved'
    then 'ready_for_booking' else 'collecting' end;
  update public.pcs_booking_requests
    set finance_entry_id = finance_id,
        payment_status = 'paid', status = next_status, updated_at = now()
    where id = booking.id;

  insert into public.pcs_audit_logs
    (actor, action, entity_type, entity_id, payload)
  values
    (p_actor, 'booking_deposit_bank_verified', 'pcs_booking_requests',
     booking.id::text,
     jsonb_build_object('finance_entry_id', finance_id,
       'amount', booking.booking_deposit_amount,
       'currency', booking.currency, 'bank_reference', trim(p_bank_reference)));

  return jsonb_build_object('request_id', booking.id,
    'finance_entry_id', finance_id, 'status', next_status,
    'already_recorded', false);
end;
$$;

revoke all on function public.pcs_confirm_booking_deposit(uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.pcs_confirm_booking_deposit(uuid,text,text)
  to service_role;
