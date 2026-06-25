# EPOS `cashup.ran` → AMS Cashing Up — what's possible

_Scoped to cash-up only (members/loyalty parked). Grounded in the real cash-up schema, the `upsert_cashup_session_atomic` RPC, the existing CSV importer, and the dashboard/variance code._

---

## The big picture

Your AMS Cashing Up module is a **manual nightly reconciliation** — one session per site per day, where staff key in the takings and count the drawer. The EPOS `cashup.ran` payload already contains **expected, actual *and* variance per payment method**, plus the closing-float reconciliation. In other words, **the till already does the reconciliation** — so AMS doesn't need staff to re-count. It can **mirror the finished result** automatically.

That turns the AMS cash-up from a *data-entry* screen into an *oversight & reporting* layer: managers review variance, trends vs targets, and get alerts — with **zero re-keying**.

**Low-risk, because there's precedent:** `src/app/actions/cashing-up-import.ts` already imports cash-ups from CSV through the **same** `upsert_cashup_session_atomic` RPC. The webhook is essentially "that importer, but automatic and real-time."

### Mirror vs prefill
- **Mode A — Mirror (recommended).** The till already has actual + variance, so we write a complete, reconciled session. Staff do nothing in AMS.
- **Mode B — Prefill.** Only fill "expected" and have staff count in AMS. Pointless here — the EPOS already gives us the count.

---

## Field mapping (what lands cleanly)

| EPOS `cashup.ran` field | AMS destination | Notes |
|---|---|---|
| `data.from`/`data.to` (date) | `cashup_sessions.session_date` | Use the **trading day** (London tz), not `ran_at` — matters for late-night Z-reads |
| `payments.cash.expected` | `cashup_payment_breakdowns[CASH].expected_amount` | |
| `payments.cash.actual` | `cashup_payment_breakdowns[CASH].counted_amount` | The till's counted cash |
| `payments.card.expected` | `cashup_payment_breakdowns[CARD].expected_amount` | |
| `payments.card.actual` | `cashup_payment_breakdowns[CARD].counted_amount` | |
| per-method variance | `…variance_amount` | RPC derives it (`counted − expected`) |
| sum of expected / actual | `cashup_sessions.total_expected_amount` / `total_counted_amount` / `total_variance_amount` | All derived by the RPC |

That's the whole core reconciliation, mapped — no schema change needed for it.

## What has no home today (needs a small, additive migration + a decision)

None of these block the core mirror; they're enhancements:

- **`gross_sales`** (single total) — no column. Option: write to `pnl_sales_imports` as an `epos` source row for a daily revenue line (sales-mix stays 0 unless a split is available).
- **`closing_cash`** (float expected/actual/variance) — this is a *separate* concept from per-method takings; no column. Could become a dedicated field or a 4th breakdown row.
- **`warnings[]`** — till-side anomalies; no storage/UI. Worth surfacing to managers.
- **`ran_by` (email) / `ran_at`** — provenance; no columns. Nice-to-have for audit.
- **EPOS cash-up id / webhook delivery id** — no idempotency column/table; needed so re-deliveries update in place rather than duplicate or error.
- **Per-denomination drawer count** (`cashup_cash_counts`) — EPOS can't provide this. For a mirrored session it's simply left empty (the manual count becomes redundant).
- **Sales mix (drinks/food/other)** — EPOS gives one `gross_sales` total; can't be split unless `plan.invoice.lines` is populated. Stays manual/0.

---

## What's possible (the feature menu)

**Prerequisite (shared infra):** a signed `POST /api/webhooks/tabology` endpoint — HMAC-SHA256 verification (reusing the Stripe verifier pattern) + idempotency on the event id. Needed before anything below. _M._

### Core
1. **Auto-mirror the nightly cash-up** — `cashup.ran` → `upsert_cashup_session_atomic` with CASH/CARD expected+actual, totals & variance derived; idempotent on (site, date) + EPOS id. Manual cash-up becomes **review-only**; daily double-entry gone. _M / high._ ← the centrepiece.

### Oversight & alerting
2. **Variance + missing-cashup alert** — daily cron: flag `|variance|` over threshold and surface `closing_cash.variance`; email managers (reuse the `rota-manager-alert` Microsoft Graph pattern + `missing-cashups.ts`). _M / high._
3. **Surface EPOS `warnings`** — persist and render on the session view + PDF so till anomalies reach managers. _S / med._
4. **Configurable variance threshold** — move the hardcoded `£50` (`cashing-up.service.ts`) into config. _S / med._

### Revenue & reporting
5. **Daily `gross_sales` → P&L feed** — write the day's total into `pnl_sales_imports` (`source='epos'`) for a daily revenue line. _M / high._
6. **Expected-vs-counted reconciliation panel** — per-method expected-vs-actual view driven by EPOS figures (today only cash has a manual "expected"). _M / med._

### Polish
7. **Generalise payment methods** beyond hardcoded CASH/CARD/STRIPE (other methods are currently dropped from weekly/dashboard rollups). Column is already `TEXT` — no migration. _M / med._
8. **Capture `ran_by`/`ran_at` + raw payload** for provenance & auditability. _S / low._

---

## Decisions needed

1. **Status of a mirrored cash-up** — auto-`approved` (trust the till, like the CSV importer), or land as `submitted` for a manager to approve? _(Affects whether managers still "sign off" each day. Note: `locked` would refuse future EPOS corrections.)_
2. **Re-sends / corrections** — if the till re-runs a cash-up for the same day, should the new payload overwrite the existing AMS session even if it's already approved?
3. **`gross_sales`** — do you want the daily revenue total feeding your P&L/reporting, or just the cash reconciliation for now?
4. **Variance alerts** — want an automatic manager email when variance exceeds a threshold? If so: threshold + recipient(s)?
5. **One real sample `cashup.ran` payload** — to confirm the exact method names, `closing_cash` and `warnings` shapes before mapping.

**I'll just propose sensible defaults for the plumbing** (these don't need you): map `venue_id: 1` → The Anchor's site via a small lookup; attribute webhook-created sessions to a dedicated "EPOS system" service user; idempotency keyed on the EPOS cash-up id.

---

## Recommended phasing

- **Phase 0** — signed `/api/webhooks/tabology` endpoint in **log-only** mode. Captures a real payload, proves the signature scheme. Zero risk.
- **Phase 1** — **auto-mirror** (feature 1) + venue/site map + system user + idempotency. The core win; makes manual cash-up review-only.
- **Phase 2** — variance/missing-cashup alerts (2) + surface warnings (3) + configurable threshold (4).
- **Phase 3** — `gross_sales` → P&L feed (5), method generalisation (7), provenance (8).

### Key files this touches
`src/services/cashing-up.service.ts` · `src/app/actions/cashing-up.ts` · `src/app/actions/cashing-up-import.ts` (mapping precedent) · `src/components/features/cashing-up/DailyCashupForm.tsx` · `src/app/(authenticated)/cashing-up/dashboard/_components/DashboardClient.tsx` · `src/app/actions/missing-cashups.ts` · `src/app/api/cron/rota-manager-alert/route.ts` · `supabase/migrations/20260708000025_cashup_session_atomicity.sql`
