# PCS AI Operator — repository audit

## Objective
Build one production-grade Telegram Business AI operator for Premium Concierge Service Thailand. Core acceptance path: real Telegram Business message → webhook → persistence/CRM → intent/knowledge → AI draft → approval/auto-send → reply via the same business connection → history and next action updated.

## Working
- Existing GitHub repository contains a separate PCS/Legat avatar/SEO pipeline and is not an existing Telegram Business operator.
- The repository default branch is therefore treated as unrelated production material and remains untouched.
- A dedicated feature branch and isolated `pcs-ai-operator/` subtree are used for this implementation.

## Broken
- No existing PCS Telegram Business application code was found in the connected GitHub repository.
- No existing operator database schema, webhook, worker, CRM, approval queue, AI adapter, or Inbox UI was available to preserve.

## Dead code
- None identified inside the new subtree at audit time.
- Existing unrelated avatar/SEO files are intentionally not modified or deleted.

## Security issues
- Live Telegram/OpenRouter secrets are not committed.
- Production E2E cannot be certified until real secrets and a Telegram Business connection are present in the runtime.

## Architecture issues
- None inherited because the operator is a new isolated application.
- Main risk is coupling to an unrelated repository; mitigated by an isolated subtree + feature branch and no merge to `main` before E2E PASS.

## Keep
- Existing repository content outside `pcs-ai-operator/`.
- Official Telegram Business Bot API only.

## Replace
- Nothing from the existing repository.

## Delete
- Nothing from the existing repository.
