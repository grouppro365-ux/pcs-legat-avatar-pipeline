# Rental lifecycle

Contract confirmation now supports a distinct vehicle return with manager,
actual time, note and explicit checkbox. Return requires a recorded handover
and cannot predate it. Signing remains independent. Facts and audit entries
are recorded in one Supabase transaction.

After handover the Mini App requests active status; after return it requests
completed status. The contract API validates the current finalized contract
and required facts. For Neon bookings it uses the existing manager gateway,
with a new conditional-update operation for CONFIRMED → SERVICE_IN_PROGRESS
and SERVICE_IN_PROGRESS → COMPLETED. This prevents overwriting a concurrent
status change. The manager source includes the existing live v6 login guard;
no credentials or runtime settings were changed.

Neon and Supabase are separate databases. Remote status updates are verified
before committing the local projection and audit. A failure leaves a retry
action visible, including when the remote status succeeded but the local
recording failed. Repeating the action does not repeat a remote transition or
duplicate the local phase event. No payment, deposit refund or vehicle catalog
availability is automatically changed.

Generating a new version preserves matching editable document fields through
version-policy.mjs. Versions with signed copies or recorded handover/return
facts retain their history. The center displays the latest current version.
Older unsigned versions without these facts are removed by the existing policy.
Signatures and attestations are never copied as a new signature.

Validation: 40 Node tests passed, including actual API handler tests with fake
DB/manager calls for blocked transitions, races and partial-failure retry.
SQL assertions used newly generated synthetic reservation/contract IDs inside
BEGIN / ROLLBACK; no actual rental was marked issued, returned or complete.
Confirmed service-only execution, security invoker and fixed search path.
Authenticated native Telegram end-to-end validation remains outstanding.

Deployment: pcs_confirm_contract_fact extended for return;
pcs_record_rental_phase added; pcs-manager-live2 v7, pcs-contract-api v14.
The frontend cache key is 20261003-return1. Original transparent logo unchanged.
