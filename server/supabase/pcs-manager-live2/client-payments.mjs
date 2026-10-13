// Read the existing cabinet claims. No projection writes or provider integration.
export const clientPaymentsQuery=`select c.id,c.application_id,a.public_id application_public_id,a.client_name,
 a.operational_status,a.client_payment_status stored_payment_status,c.status,c.amount_thb::text amount,
 'THB'::text currency,c.reference,c.review_note,c.created_at,c.reviewed_at,c.updated_at,
 c.updated_at::text edit_version,p.price::text agreed_price,p.deposit::text deposit,
 b.verified::text verified_amount,b.pending::text pending_amount,
 case when p.price>0 then greatest(p.price-b.verified,0)::text end remaining,
 case when p.price>0 then greatest(b.verified-p.price,0)::text end overpayment,
 case when p.price is null or p.price<=0 then 'UNKNOWN' when b.verified>p.price then 'OVERPAID'
 when b.verified=p.price then 'PAID' when b.verified>0 then 'PARTIAL' else 'UNPAID' end balance_status
 from pcs.application_payment_claims c join applications a on a.id=c.application_id
 cross join lateral (select
 case when a.accepted_offer_snapshot->>'client_price_thb' ~ '^[0-9]{1,10}(\\.[0-9]{1,2})?$' then (a.accepted_offer_snapshot->>'client_price_thb')::numeric end price,
 case when a.accepted_offer_snapshot->>'deposit_thb' ~ '^[0-9]{1,10}(\\.[0-9]{1,2})?$' then (a.accepted_offer_snapshot->>'deposit_thb')::numeric end deposit) p
 cross join lateral (select coalesce(sum(amount_thb) filter(where status='VERIFIED'),0) verified,
 coalesce(sum(amount_thb) filter(where status='PENDING'),0) pending
 from pcs.application_payment_claims where application_id=a.id) b
 where ($1='all' or c.status=$1) order by c.created_at desc,c.id desc limit 101 offset $2`;
