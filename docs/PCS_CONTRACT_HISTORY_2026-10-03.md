# Contract history

The contract center includes Versions and journal. The history endpoint is a
read-only authenticated route on the existing contract API. It lists the latest
50 retained versions and latest 200 events belonging to those versions, with
explicit truncation indicators. Actor identifiers, private storage paths and
unrelated event payload fields are omitted. No new table or SQL migration.

The UI distinguishes actual fact time from log creation time, identifies the
version and manager, and escapes all user notes. Retained ready-to-sign/signed
versions can open their locked fields and existing generated-PDF flow.
This does not add download of the uploaded signed scan. The current contract
remains on the primary center; creating signatures or handovers is not offered
in the history screen. Deleted unsigned drafts are not recreated by this view.

Validation: 46 tests passed (six new history tests), source checks passed.
Tests cover actual handler authentication, reservation scoping, read bounds,
private metadata filtering, failure response, escaped UI text and malformed IDs.
Visual narrow-screen verification could not be completed: the cloud browser
blocked the local preview page. Temporary QA fixture removed before publication.
Native Telegram authenticated end-to-end verification remains outstanding.

Deployment: contract API v15; frontend modules/cache keys 20261003-history1.
Original logo and operational data unchanged.
