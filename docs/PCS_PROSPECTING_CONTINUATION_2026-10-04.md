# PCS prospecting continuation — verified 2026-10-04

## Actual blocker recovered

The earlier chat's prospecting implementation existed as uncommitted files in its workspace. The live UI did not contain that feature and the live manager did not expose prospecting. This branch restores those files and adds complete classification validation and an authenticated internal worker.

The classifier now requests an object with one required record per message ID, retries missing results once, and rejects incomplete, duplicate or mismatched responses. No cursor advancement occurs for an incomplete page. Source cursor, stored messages and audit counters are saved atomically. Public posts do not prove the author's identity; no contact is invented and outreach remains blocked.

## Live changes and results

- PCS Supabase project: `nnlzgertmmxuteozoeel`; existing CRM remains in Neon.
- Existing `pcs-manager-live2` deployed as version 24. The worker requires the existing internal secret. Other prospecting endpoints require admin authentication.
- Creating another Edge Function exceeded the plan's function limit; the worker was incorporated into the existing manager instead. No subscription changes or function deletion.
- The owner explicitly authorized public Telegram text classification via the existing OpenRouter and code publication to the canonical GitHub repository on 2026-10-04. Earlier automatic approval blocks are resolved.
- An alternative public-review mode was executed. It does not load a model key or transmit message text to a model. All fresh messages are marked `review`, with no inferred direction or facts.
- All 35 seeded sources checked: 2 public-readable, 33 `public_history_unavailable`. 33 messages read; 12 fresh messages saved in the existing CRM as `review`. After authorized OpenRouter classification (HTTP 200, pg_net 175306), all 12 were processed: Initially 11 rejected and 1 review; correcting the irrelevant-forwarded-post guard and reclassification (pg_net 175325) produced 12 rejected, 0 review, 0 qualified, 0 outreach. Public sources were re-read before classification to preserve forwarding provenance. Review updates use original record identity/text, microsecond-preserving updated_at revision checks and an audited SQL statement; source cursors are unchanged.
- An optional 15-minute public scan schedule is prepared in `server/sql/pcs_telegram_prospecting_cron.sql` but NOT installed. Automatic approval review rejected recurring external model usage as requiring separate explicit permission. Manual scans remain available.
- 304 Node regressions pass; the gateway mock tests pass.
- The frontend adds source/request/run screens, pause/resume, source addition, public scans and classification of saved review-only messages. Publishing is in progress. Git CLI has no credentials; the connected GitHub API is used.
- Follow-up delivery guards are separately deployed in `pcs-customer-followup-v1` version 7. The existing Follow-up cron remains disabled; this prospecting work does not enable it.

## Browser path

`server/pcs-aio-browser` prepares a dedicated persistent AIO Sandbox deployment, adapted from the existing generic gateway. PCS has its own volume, hostname and keys. Gateway tests pass against a mock upstream. Docker is unavailable here; no production host or Telegram user session is connected. The screenshot supplied by the owner shows BotFather Serverless access on a waitlist; it is not usable as an available runtime yet.

## Remaining actions

1. Provision the dedicated Docker host and hostname, then verify Chromium and persistent files end-to-end. Owner signs into Telegram manually.
2. Implement and verify authenticated Telegram group reading, author identity and the outreach route before any client messages or Follow-up activation.
