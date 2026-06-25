# Tabology EPOS `cashup.ran` → AMS Cashing Up — build tracker

Mirror the EPOS end-of-day cash-up into a **submitted** AMS cash-up session for a manager to sign off. Cash reconciliation only. Inline variance flagging (no emails).

Endpoint to register in Tabology: `https://management.orangejelly.co.uk/api/webhooks/tabology`

## Plan

- [x] Recon exact facts (RPC signature, importer precedent, system-user, variance UI)
- [x] `src/lib/system-user.ts` — sentinel `SYSTEM_USER_ID`
- [x] `src/lib/webhooks/tabology.ts` — HMAC-SHA256 verifier (hex/base64) + pure `mapCashupRanToDto`
- [x] `src/app/api/webhooks/tabology/route.ts` — signed endpoint
- [x] `.env.example` — `TABOLOGY_WEBHOOK_SECRET`, `SYSTEM_USER_ID`
- [x] Inline variance flag on the daily sign-off view (+ dashboard £0 consistency)
- [x] Unit tests for verifier + mapper
- [ ] Verify: lint, typecheck, test, build
- [ ] Commit on `feat/tabology-cashup-webhook`
- [ ] Confirm with owner before merge/deploy (live endpoint needs production)

## Key decisions / assumptions

- **Status** = `submitted` (manager signs off). Existing `approved`/`locked` sessions are never overwritten by a re-send (skipped + audited). `draft`/`submitted` are updated in place.
- **Cash reconciliation only** — maps `payments.{method}.expected/actual` → expected/counted per method. No `gross_sales`/P&L feed, no sales mix, no `closing_cash` float (parked).
- **Site** — single-site venue: defaults to the only `sites` row (matches CSV importer). `venue_id` mapping is a TODO for multi-site.
- **System user** — sentinel UUID via `SYSTEM_USER_ID` (default nil UUID). No migration/seed needed (columns are NOT NULL but have no FK).
- **Idempotency** — keyed on the Tabology delivery `id` via the existing `idempotency_keys` table.
- **All non-`cashup.ran` events** are acknowledged with 200 and ignored, so the single endpoint is safe with all events enabled.
- **No DB migration** required.
