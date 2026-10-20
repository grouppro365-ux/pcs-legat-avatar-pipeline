# PCS — release continuation, 20 October 2026

## Completed release of PRs 93 and 94

The user explicitly approved both merges and production qualification deployment. PR 93 merged at `b2d53f607cd22c4a164e991bd15ce931f0b6eed7`; PR 94 merged at `a1ebe51a01d2610d068fcbb130fdade5176c0637`.

The canonical qualification SQL is installed in the existing primary business database. Read-only verification confirms both visa and transfer schemas and no PUBLIC EXECUTE. `pcs-manager-live2` v84 is ACTIVE; all 48 deployed source files were reread and matched the intended bundle exactly. Only its qualification module changed from v83.

Production HTTP reads returned 200 and exact release bytes for index, connections, errors, status, content workflow and qualification. The qualification comparison used the immutable release commit rather than a working file already being improved. No client messages, production fixture clients, payment or booking changes were used for testing.

## Further fixes

- Closed sheets retain their DOM in this app. Notifications, search, tasks and qualification now check lifecycle ownership as well as DOM identity, preventing stale reads/saves from updating or reopening cancelled screens.
- Qualification keeps answers if a successful save cannot refresh the card. It distinguishes an uncertain save from a saved-but-not-refreshed result and retains a stable request fingerprint for an unchanged retry.
- The legacy admin `application-save` and `application-status` endpoints reject non-booking changes. Their unused generic branches could overwrite canonical qualification answers or advance a request outside its workflow. Current booking callers and dedicated request/workflow routes remain available.
- Reported public Telegram text posts can be independently observed through a fixed public permalink. The observation records exact message identity, normalized text hashes, current approved revision, brand version and check time under CAS and fresh staff authority. It never publishes a message or changes a manual report into an unqualified PUBLISHED status. Media, channel ownership, reach and future availability are outside this observation.
- Scheduled content shows its saved time and browser timezone. Nonexistent local DST times are rejected instead of silently shifted.

## Verification boundaries

Candidate validation: 959 automatic tests pass with no skips or failures. Independent review reproduced and verified repairs for adjacent-message borrowing, hidden HTML widgets and an in-sheet editor overwrite. The real SQL rollback suite passed on `br-nameless-cell-avf7ur5s`, including CAS, forged/revoked/banned staff access, replay, changed brand approval, audit-failure atomicity and PUBLIC EXECUTE denial. All fixture rows and schema/function preparation were rolled back. The validated SQL payload was unchanged after the final parser-only fixes.

Module regression tests and independent review cover actual async handlers with a controlled DOM that retains nodes after close. These tests do not prove visual layout or native Telegram WebView behavior. The current browser has no authenticated PCS session; the prior secure login request was cancelled and was not retried.

A direct read of `https://t.me/s/telegram` from this execution host returned a 200 Site Unavailable page. That is tested as UNREADABLE, not successful public-message observation. A real successful message match is therefore not claimed.

The full 75-section specification is still open: account publishing connectors, media/video/LTX, result learning, cross-channel ownership and automatic client follow-up require further work. These changes do not count as completion of those systems.
