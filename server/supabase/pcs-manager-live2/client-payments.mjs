// Shared canonical balance; list filters never alter the full verified/pending totals.
export const clientPaymentsQuery=`select c.id,c.application_id,a.public_id application_public_id,a.client_name,
 a.operational_status,a.client_payment_status stored_payment_status,c.status,c.amount_thb::text amount,
 'THB'::text currency,c.reference,c.review_note,c.created_at,c.reviewed_at,c.updated_at,
 c.updated_at::text edit_version,b.agreed_price,b.deposit,b.verified_amount,b.pending_amount,
 b.remaining,b.overpayment,b.balance_status
 from pcs.application_payment_claims c join applications a on a.id=c.application_id
 cross join lateral pcs.application_service_balance(a.id) b
 where ($1='all' or c.status=$1) order by c.created_at desc,c.id desc limit 101 offset $2`;
