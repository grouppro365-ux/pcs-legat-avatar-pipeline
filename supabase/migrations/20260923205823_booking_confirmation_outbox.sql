-- At-most-one active Telegram confirmation attempt per verified booking.
-- Service role is the only caller; customer data stays in existing private rows.
create table if not exists public.pcs_booking_confirmation_outbox (
  request_id uuid primary key references public.pcs_booking_requests(id),
  status text not null default 'pending' check (status in ('pending','sending','sent','failed')),
  claim_id uuid,
  attempts integer not null default 0 check (attempts >= 0),
  claimed_at timestamptz,
  sent_at timestamptz,
  telegram_message_id bigint,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pcs_booking_confirmation_outbox enable row level security;
revoke all on public.pcs_booking_confirmation_outbox from anon, authenticated;
grant select, insert, update on public.pcs_booking_confirmation_outbox to service_role;

create or replace function public.pcs_claim_booking_confirmation(p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  booking public.pcs_booking_requests%rowtype;
  notice public.pcs_booking_confirmation_outbox%rowtype;
  claim uuid;
begin
  select * into booking from public.pcs_booking_requests
    where id = p_request_id for update;
  if not found or booking.status <> 'booked' or booking.reservation_id is null then
    raise exception 'booking_not_confirmed';
  end if;
  insert into public.pcs_booking_confirmation_outbox(request_id)
    values (p_request_id) on conflict (request_id) do nothing;
  select * into notice from public.pcs_booking_confirmation_outbox
    where request_id = p_request_id for update;
  if notice.status = 'sent' then
    return jsonb_build_object('claimed', false, 'reason', 'already_sent');
  end if;
  if notice.status = 'sending' and notice.claimed_at > now() - interval '10 minutes' then
    return jsonb_build_object('claimed', false, 'reason', 'in_progress');
  end if;
  claim := gen_random_uuid();
  update public.pcs_booking_confirmation_outbox
    set status = 'sending', claim_id = claim, claimed_at = now(),
        attempts = attempts + 1, last_error = null, updated_at = now()
    where request_id = p_request_id;
  return jsonb_build_object('claimed', true, 'claim_id', claim);
end;
$$;

create or replace function public.pcs_finish_booking_confirmation(
  p_request_id uuid, p_claim_id uuid, p_message_id bigint, p_error text default null
) returns boolean language plpgsql security invoker set search_path = public, pg_temp as $$
declare changed integer;
begin
  if p_message_id is null and coalesce(p_error, '') = '' then
    raise exception 'confirmation_result_missing';
  end if;
  update public.pcs_booking_confirmation_outbox
    set status = case when p_message_id is null then 'failed' else 'sent' end,
        sent_at = case when p_message_id is null then null else now() end,
        telegram_message_id = p_message_id,
        last_error = left(p_error, 300), updated_at = now()
    where request_id = p_request_id and claim_id = p_claim_id and status = 'sending';
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

revoke all on function public.pcs_claim_booking_confirmation(uuid) from public, anon, authenticated;
revoke all on function public.pcs_finish_booking_confirmation(uuid,uuid,bigint,text) from public, anon, authenticated;
grant execute on function public.pcs_claim_booking_confirmation(uuid) to service_role;
grant execute on function public.pcs_finish_booking_confirmation(uuid,uuid,bigint,text) to service_role;
