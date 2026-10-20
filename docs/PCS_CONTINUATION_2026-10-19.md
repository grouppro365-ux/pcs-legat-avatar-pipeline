# PCS continuation — 19 October 2026

## Interface regression fixes

- Connections, status and error queues discard responses from abandoned routes. Re-entering the error queue starts a fresh read instead of being blocked by an earlier pending read.
- A deferred BotHelp form belongs to its opening intent. Settings saves do not close a replacement sheet or refresh an unrelated route.
- The delivery queue's client action opens the actual CRM workspace.
- Content editors reject stale completions after cancel, close or replacement. Only one editor and one generate/save attempt may be active. Keyboard submission works without a submitter; a changed payload gets a new command identifier.
- Application regression CI now runs the tracked Node suites for frontend and backend changes. Previously the transport workflow did not cover most browser modules.

Verification: independent code review; the full working tree passed 922 tests including the mobile-route suite. New tests run actual browser modules in a controlled DOM harness. They do not prove browser geometry or native Telegram behavior.

The production responsive-check page was opened at 390 CSS pixels. Its login screen loads correctly; no authenticated session is available in this browser. Signed-in mobile flows and native Telegram verification remain open.

## Qualification extension — separate pending backend release

The existing qualification workflow now has explicit visa and transfer schemas. Visa records client-supplied nationality, status/location, requested visa and timeline. Transfer records route, Thailand date/time, passengers, luggage, child seats and flight. Existing field isolation, staff permissions, CAS, immutable booking facts and audit remain in place.

The real SQL rollback suite passed on the existing Neon QA branch `br-nameless-cell-avf7ur5s`; all fixtures and function changes were rolled back. Production manager v83's qualification module matched the Git baseline before any changes.

Automatic approval review rejected installation of the SQL on the primary database because production schema deployment was not considered authorized. No production SQL or Edge Function was changed. The qualification extension requires approval of that concrete backend release before deployment.

## Specification

The original 75-section MASTER PROMPT was recovered from `Вставленный текст(4).txt` and read in full. The previous matrix's statement that the original could not be found is superseded. The full specification is still open: publishing/verification connectors, media/video/LTX, result learning, cross-channel ownership and automatic client follow-up remain incomplete.
