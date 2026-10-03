# PCS UI migration — 3 October 2026

This is a scoped update of the existing `pcs-ai-operator-v6` frontend, not a new application. The original repository HTML is byte-identical to the fetched production Vercel HTML; 25 unmodified modules are also byte-identical. Repository name notwithstanding, this directory contains the actual current PCS Operator source.

## Current frontend

Vanilla JavaScript and HTML; 30 loaded application modules; 19 legacy CSS layers. Existing `go`, `shell`, `openSheet`, `call`, `opsCall` and Neon adapter remain in use. The adapter routes authenticated operations through the existing Supabase Edge gateway to the existing Neon databases. No backend/schema/auth protocol changes are included in this update.

## Implemented foundation

- Exact uploaded original logo stored as `assets/pcs-original-logo.png`. Original SHA-256: `1c11d5379f76a45e54f34110c206ef3c649d9286f9bd9ea61d4cd1345d68ff56`. RGBA 2048×682, already transparent. No generation, recoloring, crop or image conversion. Logo containers are transparent; pseudo-element wordmarks are suppressed.
- Idempotent original-logo application across existing header, dashboard, inbox/calendar navigation and system banners. Removed competing legacy text replacement.
- Semantic tokens and aliases for the legacy primary, approved-page and dashboard style systems. Light/dark/system preference; system media change and cross-tab storage handling; early initialization without forcibly resetting saved preference.
- Existing theme action opens the existing sheet with explicit accessible theme choices. Login includes the same action. Original white logo remains on a photographic welcome region and full navigation surface, without an individual background plate.
- Dashboard route detection retains the required body class. This resolves the oversized navigation icons and broken dashboard styling seen during actual browser QA. Desktop dashboard uses available width, two operational panels and four KPI columns. Search and shortcuts follow document flow rather than conflicting fixed offsets.
- Keyboard focus, reduced motion and theme-aware danger/warning colors.

## Migration order

1. Confirm the foundation in mobile and desktop and both themes, including the original logo.
2. Identify and obtain the existing Client frontend source. The repository contains the Operator UI; bundled Edge client/provider portal handlers are APIs, not frontend screens. Do not invent a parallel client application.
3. Implement Client Home benchmark against supplied `image(3).png`, using only real catalog/content and existing API contracts. Client nav must use its own existing request/message/booking routes.
4. Migrate Client requests/offers/bookings/profile; then Provider operational screens; then dense Admin/CRM; then actual Content/AI/Video capabilities.
5. Screenshot and interaction QA in both themes before publishing each role migration. No invented prices, availability, metrics, offers or integrations.

## Verification and remaining work

The original-logo/theme/Operator foundation has passed its scoped QA (`design-qa.md`). Seven theme/navigation tests pass; desktop and 390px mobile browser checks cover real Home/Inbox and theme selection. Mobile More now exposes Appearance. A complete photographic hero overlay keeps the unchanged white original readable in both themes; the logo itself has no plate.

Contract fixes were published separately: compact document rows, private selected-image OCR, a single current version, deletion of older unsigned drafts after successful replacement, native Telegram HTTPS PDF downloads. Existing signed copies are retained. Tests cover OCR/photo behavior and PDF download transport; actual client-signature automation is not enabled without a real customer confirmation flow.

The full Client/Provider/CRM/Content migration remains unfinished. Client/Provider frontend source is not present in this repository, although existing backend handlers are available. The supplied Client collage cannot yet be certified as faithfully implemented. Do not claim the entire master specification is complete.

The obsolete operator-ux-v37 source-match test expects an older cache query and fails against the unchanged repository baseline; it has not been altered to conceal that unrelated issue.
