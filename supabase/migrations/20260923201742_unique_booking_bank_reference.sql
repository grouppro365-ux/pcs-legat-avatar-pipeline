-- A bank transfer must not be credited as the advance for two bookings.
create unique index if not exists pcs_finance_booking_bank_reference_uidx
on public.pcs_finance_entries (upper(metadata->>'bank_reference'))
where status = 'paid'
  and payment_kind = 'booking_deposit'
  and metadata ? 'bank_reference';
