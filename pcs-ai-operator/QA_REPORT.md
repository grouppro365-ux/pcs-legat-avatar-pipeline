# QA report — 0.1.0-dev.1

| Gate | Status | Evidence |
|---|---|---|
| Repository audit | PASS | `PCS_AI_OPERATOR_AUDIT.md` |
| Static core tests | PENDING CI | GitHub Actions workflow created |
| Typecheck | PENDING CI | GitHub Actions workflow created |
| Lint | PENDING CI | GitHub Actions workflow created |
| Build | PENDING CI | GitHub Actions workflow created |
| Docker runtime | UNVERIFIED | Docker unavailable in authoring sandbox |
| Telegram Business connection | UNVERIFIED | Requires live token + owner connection |
| Real incoming business message | UNVERIFIED | Requires live Telegram E2E |
| Real outgoing business reply | UNVERIFIED | Requires live Telegram E2E |
| AI response | UNVERIFIED | Requires OpenRouter key |
| Database persistence | PENDING integration runtime | Prisma schema + integration path implemented |
| Retry/DLQ | PENDING integration runtime | BullMQ policy implemented |
| Duplicate protection | STATIC PASS | unique Telegram `update_id` ingestion + unit-tested normalizer/policy primitives |
| Mobile UI | UNVERIFIED | responsive implementation exists; device test not run |

**Release status: UNVERIFIED / not production-ready.**
