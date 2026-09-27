# Shared rental-date release — 2026-09-27

Scope: Telegram and the existing Conversation Hub now use the same rental-date parser. Pickup plus two days returns two days later; return dates are exclusive. Numeric, ISO and named ranges, year rollover, impossible dates, zero duration and explicit past dates are covered.

Verification:
- Three new Hub regression tests failed against the old implementation for the expected reasons, then passed.
- Combined affected suites: 31 passed, 0 failed (latest receipt: `codex-token-economy-i5k_gvep/stdout.log` in the local OS temp directory).
- Supabase `pcs-business-runtime-v8` version 41 ACTIVE; 9 deployed files matched the tested local release contents after newline normalization.
- Supabase `pcs-meta-webhook-v1` version 12 ACTIVE; 8 deployed files matched the tested local release contents after newline normalization.
- Live unauthenticated POST to Telegram runtime: 401 `unauthorized`.
- Live unauthenticated POST to BotHelp receiver: 401 `invalid_bothelp_secret`.
- Authorization and channel settings, stored prices, deposits, customer records and booking/payment rules were not changed.

Limits: HTTP checks prove bundle startup and unauthorized-request rejection, not authenticated message delivery or booking E2E. The earlier live MG5 offer/photo test covered runtime v40, not this release. Instagram auto-reply is not certified by these tests.

Instagram decision pending: BotHelp human support (2026-09-24) confirmed that outgoing webhooks require a subscriber to reach a flow Action block; this is not a universal new-Direct-message event. Do not equate successful credentials or account connection with a complete inbound pipeline. A different provider requires account/plan and routing decisions plus a real message round-trip test before activation.

## Follow-up: requested vehicle model

Hub now imports the existing Telegram classifier for MG5, Focus and Fiesta. The latest recognized model is retained; explicit purchase of those models does not enter rental qualification. Catalog candidates are filtered by that model, city, rental category, available status, customer visibility and absence of deletion. No matching item means no silent substitute.

Two regression tests failed against the previous implementation (MG5 did not enter rental qualification; model choice was not retained), then passed. Added catalog eligibility/no-substitution cases. Combined affected suites: 34 passed, 0 failed; full local test log `codex-token-economy-5ev9ss2z/stdout.log` in OS temp.

Deployed `pcs-meta-webhook-v1` version 13 ACTIVE. All 9 published files matched the tested local contents after newline normalization. Live unauthorized POST returned 401 `invalid_bothelp_secret`. Telegram runtime was not redeployed by this follow-up; prices and channel activation were unchanged. This verifies code and startup/auth boundary, not an Instagram customer round trip.
