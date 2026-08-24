# PCS AI Operator — v20 hardening

## Goal
Remove false-completion states from PCS AI Operator and make catalog, language/currency, official research, and regression behavior verifiable before production routing changes.

## Verified baseline
- Production Telegram WebApp ultimately redirects to the Vercel root entrypoint.
- Current Telegram gateway routes customer traffic to `pcs-business-runtime-v8`.
- Catalog contains 12 live automotive listings but 9 physical fleet assets when deduplicated by `ltc_id` / `fleet_id`.
- `pcs_fx_cache` has THB-base rates with source and timestamps.
- Existing sensitive-data grounding gate is safe but did not invoke official research.
- WhatsApp, Instagram, Facebook and LINE connection records are not configured.

## Scope of this branch
### Catalog KPI integrity
- Define physical fleet as `pcs_owned` + `car_*` + `metadata.fleet_master=true`.
- Deduplicate physical vehicles by `ltc_id`, then `fleet_id`, then title.
- Prefer the rental listing for one physical asset represented by rent and sale records.
- Make the `Автопарк` KPI show and filter the same physical set.
- Preserve intersection with status filtering.

### Locale and currency
- One client-context language state for RU, EN, TH, IT, ES, FR, DE, PL, ZH, JA, KO, AR, KK.
- Admin interface remains Russian in v20; this branch does not claim full UI translation.
- Store source prices unchanged.
- Convert only for display and mark converted amounts with `≈`.
- Use the server FX cache, never hard-coded rates.
- Disable conversion when FX data is stale.

### Official research
- `pcs-official-research-v2` uses topic-specific official domains and requires official URLs + confidence >= 0.90.
- `pcs-business-runtime-v9` is staging only.
- Sensitive researched answers become `approval_required` drafts; they are not auto-sent.
- Production gateway must remain on v8 until Telegram E2E verification passes.

### Regression
- Deterministic suite contains 592 scenarios.
- CI syntax-checks the v20 modules and runs the suite on relevant PRs and main pushes.

## Data integrity rules for the fleet
The authoritative July LTC master marks LTC-001…LTC-008 as not ready for publication until their individual blockers are resolved. Missing or conflicting prices must not be invented to make the UI look complete.

Safe normalization already applied in the database:
- Nissan Juke: `price/base_price` aligned to its already stored `daily_price/final_price = 800 THB/day`; weekly price remains unconfirmed.
- MG5 sale: `final_price` aligned to its already stored one-time `price/base_price = 250000 THB`; the leaked `660` rental value was removed.

Not allowed in v20 without new verified evidence:
- Filling LTC-001/002/005/006/007 prices.
- Choosing one side of Mazda 2 / LTC-008 historical price conflicts.
- Marking a checking vehicle as available merely because a price exists.

## Acceptance gates
| Area | Gate | Status |
|---|---|---|
| Catalog KPI | 9 physical fleet rows from 12 auto listings, click result matches count | Implemented, regression-covered |
| Currency | Source price preserved, transparent approximate conversion, stale gate | Implemented, regression-covered |
| Mandatory languages | RU/EN/IT/ES/FR/DE/TH deterministic cases | Implemented, regression-covered |
| Extended languages | PL/ZH/JA/KO/AR/KK normalization/fallback | Implemented, regression-covered |
| Official research engine | Official-only evidence + confidence threshold | Deployed |
| Official research runtime | Draft-for-approval path | Deployed to staging v9, not production-routed |
| Regression | >= several hundred deterministic scenarios | 592 scenarios + CI |
| Real Telegram WebView visual QA | Run actual embedded WebApp on target device/viewports | OPEN P0 |
| 9-car verified pricing/cards | Every physical asset has current verified price/media/docs | BLOCKED by source data |
| WhatsApp/Instagram/Facebook/LINE | Credentials + inbound/outbound webhook E2E | OPEN / NOT CONFIGURED |

## Production routing rule
Do not switch `pcs-tg-gateway` from v8 to v9, merge visual changes to production, or call the release complete until the real Telegram Business/WebView E2E gate is passed.
