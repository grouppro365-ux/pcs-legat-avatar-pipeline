# MG5 advance and RUB payment route — 2026-09-27

## Owner decisions and explicit bounded interpretation

- MG5 security deposit remains 10,000 THB, separate from rent and advance.
- Standard booking advance: 2,000 THB. Short rental interpretation announced to owner: rent below 2,000 THB uses min(1,000 THB, rental total).
- Only new own-fleet MG5 car-rental requests in THB receive the default. Explicit manager amounts and existing requests are not overwritten.
- Approved transfer conversion: 1 THB = 3 RUB. Private recipient/card/phone stay in the database, not source control.
- Assigning an advance does not send an invoice, mark payment received, or confirm a booking. Existing document and bank verification remain mandatory.

## Implementation and verification

- Production migration `20260927083826_mg5_booking_advance_policy` installs an invoker-only, service-role-restricted calculation/insert trigger and explicit payment currency/rate fields.
- `database/tests/mg5_advance_policy.sql` passed against production inside BEGIN/ROLLBACK: model/currency/ownership boundaries, amount caps, actual insert, manual update and explicit insert override. Zero test requests remain.
- Current two-day request remains collecting / not_requested with advance 1,000 THB.
- Corrected payment route discriminator from invalid `pcs_payment` to database value `pcs` in consumers (contact workflow marker remains unchanged).
- Gateway renders the RUB equivalent and stores the same sent text plus currency/rate evidence. 37 Node tests passed, including conversion and route regression checks.
- Published gateway v40 and business runtime v42; custom webhook authentication preserved.
- All 13 gateway files and 9 runtime files were compared with the release bundle after deployment. Unauthenticated POST requests returned 401 on both functions.
- The authorized RUB route was activated and read back: currency RUB, rate 3, approved recipient/bank. No payment details are included in this report.
- Live Telegram Web check on 27 September: `/brequest` returned advance 1,000 THB, collecting, missing passport/IDP and not_requested. This verifies the manager bot reads the current production request.
- No client message, real payment, booking confirmation or document approval was fabricated for these tests. Full customer payment E2E remains pending genuine documents and payment.

## Instagram, separate next step

- `https://github.com/subzeroid/instagrapi` is MIT licensed and supports password login and Direct without a Meta Developers app.
- Upstream explicitly describes private API production automation as fragile and recommends controlled internal use. Challenges, session expiry and account restrictions are real risks; this is not a reliability-equivalent replacement for official API authorization.
- No Instagram password collected, unofficial runtime installed, account connected or automatic messages enabled in this change. A controlled pilot must keep login local, protect session files, stop at challenges/rate limits, deduplicate inbound events and retain the existing PCS Conversation Hub business logic.
