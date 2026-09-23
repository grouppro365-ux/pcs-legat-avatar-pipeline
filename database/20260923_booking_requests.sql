-- A client's selection is an application, not an inventory-blocking booking.
-- This table contains only quote and verification state; document bytes stay
-- in private storage and payment proof stays in finance intake.
create table if not exists public.pcs_booking_requests (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.pcs_contacts(id),
  offer_id text not null,
  catalog_item_id uuid not null references public.pcs_catalog_items(id),
  start_date date not null,
  end_date date not null,
  rental_total numeric(12,2) not null check (rental_total > 0),
  currency text not null default 'THB',
  booking_deposit_amount numeric(12,2) check (booking_deposit_amount > 0 and booking_deposit_amount <= rental_total),
  passport_status text not null default 'missing' check (passport_status in ('missing','received','approved','rejected')),
  international_permit_status text not null default 'missing' check (international_permit_status in ('missing','received','approved','rejected')),
  payment_status text not null default 'not_requested' check (payment_status in ('not_requested','requested','receipt_pending','paid','rejected')),
  status text not null default 'collecting' check (status in ('collecting','ready_for_booking','booked','cancelled','expired')),
  reservation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contact_id, offer_id),
  check (end_date > start_date),
  check (status <> 'ready_for_booking' or (
    booking_deposit_amount is not null and passport_status = 'approved'
    and international_permit_status = 'approved' and payment_status = 'paid')),
  check (status <> 'booked' or reservation_id is not null)
);
create index if not exists pcs_booking_requests_contact_idx on public.pcs_booking_requests (contact_id, created_at desc);
alter table public.pcs_booking_requests enable row level security;
