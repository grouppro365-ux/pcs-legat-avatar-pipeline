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
