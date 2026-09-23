alter table public.pcs_booking_requests
  add column if not exists passport_media_intake_id uuid references public.pcs_media_intake(id),
  add column if not exists permit_media_intake_id uuid references public.pcs_media_intake(id),
  add column if not exists receipt_media_intake_id uuid references public.pcs_media_intake(id),
  add column if not exists finance_entry_id uuid references public.pcs_finance_entries(id);
