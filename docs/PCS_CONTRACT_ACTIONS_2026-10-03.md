# Contract request controls

Guard new-version creation per reservation and save/finalize/signed-scan upload
per contract within the current Mini App session. Matching buttons are disabled
and expose aria-busy while the request is pending. Completion restores original
labels and disabled state only on still-connected controls. Failure releases
the guard so the operator can retry. Existing fields/file selection remain on
failure. Known contract/booking errors have actionable Russian messages;
unexpected internal errors receive a generic retry message.

This is frontend duplicate-tap protection, not server-side idempotency or a
cross-tab lock. No SQL, Edge function, customer data or logo changes.

Validation: 51 tests passed, including five new tests executing contracts.js
for repeated generation, save/finalize contention, failure/retry, duplicate
scan upload, and detached/previously-disabled controls. JS syntax passed.
Authenticated Telegram interaction remains unverified.
Frontend cache key: contracts.js?v=20261003-actions1.
