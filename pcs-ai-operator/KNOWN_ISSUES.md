# Known issues

1. **Live Telegram Business E2E is UNVERIFIED** until a real `TELEGRAM_BOT_TOKEN`, public `TELEGRAM_WEBHOOK_URL`, webhook secret, and an enabled Telegram Business connection are supplied to a deployed runtime.
2. **Live OpenRouter generation is UNVERIFIED** until a real server-side `OPENROUTER_API_KEY` is present.
3. Voice transcription and binary document extraction are represented in the attachment model but are not part of the first code slice yet; they remain FAIL against the full 72-section specification.
4. Browser/mobile visual acceptance is UNVERIFIED until a deployable runtime exists.
5. Daily automated PostgreSQL backups are documented but the hosting-specific scheduler is not yet wired.
