# PCS → Telegram Serverless

Prepared phase 1: host the released PCS Mini App on Telegram and execute its
supported API transport as native Telegram endpoints. This is **not a completed
migration** of the CRM database, bot webhook, workers, files or contracts backend.

Official reference: https://core.telegram.org/bots/serverless (2026-10-09).
CLI is pinned to @tgcloud/cli 0.2.0 with a lockfile.

## Cloud publication

1. In BotFather, select **@pcs_manager_bot → Serverless → CLI Access → Access token**.
   This is the `app<id>:<secret>` CLI token, not the Bot API token.
2. Store it as repository Actions secret **TGCLOUD_TOKEN** in
   https://github.com/grouppro365-ux/pcs-legat-avatar-pipeline/settings/secrets/actions.
3. The `PCS Telegram Serverless` workflow tests and builds committed source on
   main. With the secret configured, a main push touching this package deploys it;
   manual workflow dispatch also supports `deploy=true`.
4. A read-only native `api.getMe()` probe must identify @pcs_manager_bot before
   deployment. A token for another bot aborts publication.
5. CLI fetch precedes a targeted push of four modules plus static files. Existing
   handlers/library modules outside those targets are preserved. No schema push,
   migrate, webhook sync, menu change or force overwrite is performed.
6. The workflow verifies the public manifest and hashes of all published assets
   at `https://app<app_id>.tgcloud.ai/`. Change the bot's Mini App URL only after
   hosted login, authorized reads and documented operator acceptance succeed.

No credentials belong in this repository. The token is provided only to cloud
steps that use it; install, tests and build run without it. A missing secret
leaves the workflow at verified-build status and reports that publication is pending.

## Current components

- `tgcloud/endpoints/pcsApi.js`: Telegram-validated caller context plus the existing
  PCS admin token. A fixed allowlist forwards to existing PCS functions. No
  arbitrary host, webhook/secret service or internal worker can be selected.
- `tgcloud/endpoints/migrationStatus.js`: explicitly reports the legacy database
  and webhook; it does not claim native migration is complete.
- `tgcloud/endpoints/deploymentIdentity.js`: public bot identity probe using SDK
  Bot API; no customer message, webhook or menu mutation.
- `scripts/build-miniapp.mjs`: copies a committed frontend snapshot, corrects its
  root-relative base/asset paths and installs the native transport before the
  existing adapter. Tests, source modules and credentials are not static assets.
- Transport activates only at `app<id>.tgcloud.ai`. Password login/IP throttling,
  large/binary uploads, Request-object calls and unported services use their
  current routes. An uncertain dispatched RPC is **never** retried over HTTP.

There are no native database tables in phase 1 and no schema to deploy. PostgreSQL
applications, contacts, messages, tasks, audit, financial records and the existing
Storage remain the canonical source. No customer data was exported for preparation.

## Remaining native migration gates

1. Inspect the actual Serverless project and active webhook with the CLI token.
   Preserve its existing modules and database; do not assume that early access
   created an empty project.
2. Port the incoming-update gateway and workers, with durable update_id receipts,
   unknown-result recovery and existing business/admin/media handling. Test without
   real sends, then switch the webhook while retaining pending updates.
3. Inventory/export canonical schemas and counts, define one replacement source
   of truth, back up, copy data, compare counts/IDs/hashes and replay the cutover
   delta. Do not create a permanent parallel CRM.
4. PostgreSQL enum/FK/exclusion constraints, row locks, JSONB, writable CTEs and
   cron cannot be copied into SQLite unchanged. Telegram documents foreign keys
   as disabled. Booking overlap, atomic mutation+audit, request receipts, money,
   roles and relationship integrity require explicit native implementations and
   platform tests before financial/booking writes move.
5. Port private media, OCR/PDF, reminders, prospect scans and integrations. Confirm
   runtime limits and scheduling support; preserve existing cloud workers until
   their replacements are proven.
6. Verify an authenticated Mini App session and bot end-to-end, switch URLs and
   webhook, observe results, and only then retire replaced infrastructure. Keep a
   rollback path throughout; the CLI token alone does not prove acceptance.

## Verification performed

- Nine transport/policy tests pass: verified context + existing admin session,
  route restrictions, bad/oversized bodies, exact HTTP errors, a single mutation
  dispatch, no fallback after uncertain results, and legacy transport preservation.
- CLI install/lockfile, offline status, committed-source build and all 145 static
  hashes/local entrypoint references are checked.
- CLI fetch currently reports **no access token**. No native runtime execution,
  Telegram publication, customer-data transfer, webhook/menu change or visual
  browser verification has been performed.

The previous booking-CAS work remains in its original worktree, unpublished and
excluded from this migration build.
