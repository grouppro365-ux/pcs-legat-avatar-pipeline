# PCS AI Operator

Production-oriented Telegram Business AI operator for **Premium Concierge Service Thailand**.

## Acceptance path

`Telegram Business → webhook → PostgreSQL → BullMQ → CRM/context → PCS Knowledge Base → OpenRouter → policy → approval/auto-send → Telegram → CRM/history/next action`

The project is **not considered production-ready** until the real Telegram Business E2E path passes.

## Requirements

- Node.js 22+
- Docker + Docker Compose
- Telegram bot with Business Mode enabled in BotFather
- Telegram Premium/Business account that can connect the bot under **Telegram → Settings → Telegram Business → Chatbots / Automation**
- OpenRouter key

## Setup

1. Copy `.env.example` to `.env` and fill server-side secrets.
2. Run `docker compose up --build -d postgres redis`.
3. Run `npm ci`.
4. Run `npm run prisma:generate`.
5. Run `npx prisma migrate dev --name init` for a new development database, or `npm run prisma:migrate` on an existing production database with checked-in migrations.
6. Run `npm run prisma:seed` to load the owner-supplied PCS baseline facts.
7. Run `docker compose up --build`.
8. Open `http://localhost:3000`.

## BotFather / Telegram Business

1. Create or select the bot in BotFather.
2. Enable Business Mode for the bot.
3. Put the token in `TELEGRAM_BOT_TOKEN`.
4. Set a high-entropy `TELEGRAM_WEBHOOK_SECRET`.
5. Deploy the API on HTTPS and set `TELEGRAM_WEBHOOK_URL=https://<host>/telegram/webhook`.
6. In the PCS Telegram account, connect the bot in Telegram Business automation and grant only the required rights.
7. In the admin UI use **Settings → Telegram → Verify token / Install webhook**.
8. Verify the connection is stored and enabled before enabling auto-send.

The webhook subscribes only to `business_connection`, `business_message`, `edited_business_message`, and `deleted_business_messages`.

## OpenRouter

Set:

- `OPENROUTER_API_KEY`
- `AI_MODEL`
- `AI_FALLBACK_MODEL`

The adapter is OpenAI-compatible and automatically attempts the fallback model after a temporary/provider failure. If both fail, it creates a human-review state and does not auto-send.

## Safety defaults

- `PCS_AUTOSEND=false` by default.
- Price/currency statements without active Knowledge Base source IDs cannot auto-send.
- complaint, legal, partnership, refund/discount/contract-like intents are routed to a human.
- duplicate Telegram `update_id` is a no-op.
- failed jobs are capped and stored in `failed_jobs` after terminal failure.
- secrets are server-side only.

## Commands

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
```

## Backup

Daily production backup requirement:

```bash
pg_dump "$DATABASE_URL" --format=custom --file="pcs-$(date +%F).dump"
```

Restore to a verified empty/maintenance target:

```bash
pg_restore --clean --if-exists --dbname="$DATABASE_URL" pcs-YYYY-MM-DD.dump
```

Store backups outside the application host and test restore periodically. Hosting-specific scheduler configuration is intentionally separate from application code.

## Troubleshooting

- **Webhook 401**: Telegram secret header does not match `TELEGRAM_WEBHOOK_SECRET`.
- **No business updates**: verify Business Mode, enabled connection, recipients, and `allowed_updates`.
- **Can receive but not send**: inspect stored BusinessConnection rights and verify the connection is enabled.
- **AI draft not created**: inspect worker, Redis, `ai_generations`, and `failed_jobs`.
- **Duplicate reply**: inspect `telegram_updates.update_id`; a duplicate must not enqueue twice.
- **Price answer blocked**: add/activate the relevant Knowledge Base item; this is intentional anti-hallucination behavior.
