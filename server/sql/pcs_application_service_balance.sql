-- Canonical read-only service balance. Refundable deposit is never service credit.
CREATE OR REPLACE FUNCTION pcs.application_service_balance(p_application uuid)
RETURNS TABLE(agreed_price text,deposit text,verified_amount text,pending_amount text,remaining text,overpayment text,balance_status text)
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $fn$
 SELECT p.price::text,p.deposit::text,b.verified::text,b.pending::text,
 CASE WHEN p.price>0 THEN greatest(p.price-b.verified,0)::text END,
 CASE WHEN p.price>0 THEN greatest(b.verified-p.price,0)::text END,
 CASE WHEN p.price IS NULL OR p.price<=0 THEN 'UNKNOWN' WHEN b.verified>p.price THEN 'OVERPAID'
 WHEN b.verified=p.price THEN 'PAID' WHEN b.verified>0 THEN 'PARTIAL' ELSE 'UNPAID' END
 FROM public.applications a
 CROSS JOIN LATERAL (SELECT
 CASE WHEN a.accepted_offer_snapshot->>'client_price_thb' ~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' THEN (a.accepted_offer_snapshot->>'client_price_thb')::numeric END price,
 CASE WHEN a.accepted_offer_snapshot->>'deposit_thb' ~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' THEN (a.accepted_offer_snapshot->>'deposit_thb')::numeric END deposit) p
 CROSS JOIN LATERAL (SELECT coalesce(sum(amount_thb) FILTER(WHERE status='VERIFIED'),0) verified,
 coalesce(sum(amount_thb) FILTER(WHERE status='PENDING'),0) pending
 FROM pcs.application_payment_claims WHERE application_id=a.id) b
 WHERE a.id=p_application
$fn$;
REVOKE ALL ON FUNCTION pcs.application_service_balance(uuid) FROM PUBLIC;
