-- Review state and booking state must change in the same transaction. A
-- partially reviewed passport, permit or receipt must never unblock a booking.
create or replace function public.pcs_review_booking_document(
  p_request_id uuid, p_kind text, p_decision text, p_actor text
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  booking public.pcs_booking_requests%rowtype;
  document public.pcs_media_intake%rowtype;
  media_id uuid;
  expected_class text;
  next_passport text;
  next_permit text;
  next_status text;
begin
  if p_kind not in ('passport','permit') or p_decision not in ('approved','rejected')
     or length(trim(coalesce(p_actor,''))) < 3 then raise exception 'invalid_document_review'; end if;
  select * into booking from public.pcs_booking_requests where id=p_request_id for update;
  if not found or booking.status <> 'collecting' then raise exception 'booking_not_collecting'; end if;
  media_id := case when p_kind='passport' then booking.passport_media_intake_id else booking.permit_media_intake_id end;
  expected_class := case when p_kind='passport' then 'passport' else 'international_permit' end;
  if media_id is null or (p_kind='passport' and booking.passport_status<>'received')
     or (p_kind='permit' and booking.international_permit_status<>'received') then
    raise exception 'booking_document_not_pending';
  end if;
  select * into document from public.pcs_media_intake where id=media_id for update;
  if not found or document.classification <> expected_class or document.review_status <> 'needs_review'
     or document.contact_id is distinct from booking.contact_id
     or document.extracted->>'booking_request_id' is distinct from booking.id::text
     or document.extracted->>'storage_bucket' is distinct from 'pcs-contracts'
     or coalesce(document.extracted->>'storage_path','') not like 'booking-requests/'||booking.id::text||'/%' then
    raise exception 'booking_document_evidence_invalid';
  end if;
  update public.pcs_media_intake set review_status=p_decision,updated_at=now() where id=media_id;
  next_passport := case when p_kind='passport' then p_decision else booking.passport_status end;
  next_permit := case when p_kind='permit' then p_decision else booking.international_permit_status end;
  next_status := case when next_passport='approved' and next_permit='approved'
      and booking.payment_status='paid' then 'ready_for_booking' else 'collecting' end;
  update public.pcs_booking_requests set passport_status=next_passport,
      international_permit_status=next_permit,status=next_status,updated_at=now()
    where id=booking.id;
  insert into public.pcs_audit_logs(actor,action,entity_type,entity_id,payload)
    values(p_actor,'booking_document_review','pcs_booking_requests',booking.id::text,
      jsonb_build_object('kind',p_kind,'decision',p_decision,'media_intake_id',media_id));
  return jsonb_build_object('request_id',booking.id,'status',next_status,'decision',p_decision);
end;
$$;

create or replace function public.pcs_review_booking_receipt(
  p_request_id uuid, p_decision text, p_actor text
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  booking public.pcs_booking_requests%rowtype;
  receipt public.pcs_media_intake%rowtype;
begin
  if p_decision not in ('approved','rejected') or length(trim(coalesce(p_actor,''))) < 3 then
    raise exception 'invalid_receipt_review';
  end if;
  select * into booking from public.pcs_booking_requests where id=p_request_id for update;
  if not found or booking.status <> 'collecting' or booking.payment_status <> 'receipt_pending'
     or booking.receipt_media_intake_id is null then raise exception 'booking_receipt_not_pending'; end if;
  select * into receipt from public.pcs_media_intake where id=booking.receipt_media_intake_id for update;
  if not found or receipt.classification <> 'receipt' or receipt.review_status <> 'needs_review'
     or receipt.contact_id is distinct from booking.contact_id
     or receipt.extracted->>'booking_request_id' is distinct from booking.id::text
     or receipt.extracted->>'storage_bucket' is distinct from 'pcs-contracts'
     or coalesce(receipt.extracted->>'storage_path','') not like 'booking-requests/'||booking.id::text||'/%' then
    raise exception 'booking_receipt_evidence_invalid';
  end if;
  update public.pcs_media_intake set review_status=p_decision,updated_at=now() where id=receipt.id;
  if p_decision='rejected' then
    update public.pcs_booking_requests set payment_status='requested',updated_at=now() where id=booking.id;
  end if;
  insert into public.pcs_audit_logs(actor,action,entity_type,entity_id,payload)
    values(p_actor,'booking_receipt_review','pcs_booking_requests',booking.id::text,
      jsonb_build_object('decision',p_decision,'media_intake_id',receipt.id));
  return jsonb_build_object('request_id',booking.id,'decision',p_decision);
end;
$$;

revoke all on function public.pcs_review_booking_document(uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.pcs_review_booking_receipt(uuid,text,text) from public, anon, authenticated;
grant execute on function public.pcs_review_booking_document(uuid,text,text,text) to service_role;
grant execute on function public.pcs_review_booking_receipt(uuid,text,text) to service_role;
