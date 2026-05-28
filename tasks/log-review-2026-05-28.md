# Log Review — 2026-05-14 → 2026-05-28

**Source:** `anchor-management-tools-log-export-2026-05-28T07-08-58.json` (56 MB, 62,434 entries)
**Window:** 14 days
**Distribution:** 4,117 `error`, 14,145 `warning`, 44,172 info/none
**5xx responses:** 50 × HTTP 500, 6 × HTTP 504

After de-duplication: **4,161 raw error entries → 17 distinct themes → 7 actionable root causes**.

---

## P0 — Action required

### 1. PayPal deposit-reconciliation cron failing (3,358 errors, 81% of all errors)
- Route: `/api/cron/paypal-deposit-reconciliation`
- Span: 2026-05-14 07:15 → 2026-05-26 11:30 (continuous, every 15 min)
- Only **4 distinct PayPal order IDs** keep failing the same call, cron retries forever:
  - `4TB38943S69167218` (most recent, ~448)
  - `2J52830664016643Y` (~1,156)
  - `2GY54506VR606383F`
  - `9C152858VV719682A`
- Thrown error: `Error: Failed to get PayPal order details`. The upstream PayPal SDK error object is logged as `{}` — caught but **the real cause is being swallowed**, which is why we can't see why PayPal is rejecting the lookup.
- **Action:** (a) log the raw PayPal error (status, message, debug_id); (b) either reconcile/manually-mark those 4 orders, or add a "give up after N attempts" guard in the cron so dead orders don't loop forever.

### 2. `audit_logs` schema drift — two columns referenced but missing in DB
Code writes to columns that don't exist. This is the *exact* failure mode called out in `.claude/rules/supabase.md` (mandatory function audit on column drops).

| Column | Where it fires | Count | Impact |
|---|---|---|---|
| `entity_type` | `/api/cron/generate-slots` | 10 | **Blocks cron entirely → 50 × HTTP 500** |
| `operation_details` | `/api/cron/invoice-reminders` | 3 | Non-blocking (logged then continues) |

- Generate-slots also accounts for the 30 × middleware 500s and 20 empty-message errors.
- **Action:** run live-schema check on `audit_logs`, then either (a) add the missing columns via migration, or (b) update the writers to use existing columns. Most likely a migration ran but the writers weren't updated.

### 3. Dashboard "quote metrics" load failing (142 errors)
- Route: `/dashboard` (and a few `?_rsc` RSC variants)
- Span: 2026-05-14 → 2026-05-27 (still happening)
- Sample: `Failed to load dashboard quote metrics: { message: '' }`
- The error message is empty — Supabase error is being stringified but not unwrapped (`err.message` is undefined on raw Supabase errors; needs `JSON.stringify(err)` or destructured `code/message/details/hint`).
- **Action:** fix the logging in `loadDashboardSnapshot` (or wherever quote metrics load) so we can see the real cause; then fix the underlying query/RLS issue.

### 4. Private-booking contract RLS denial (6 errors)
- Route: `/api/private-bookings/contract`
- Error: `new row violates row-level security policy for table "private_booking_audit"` (code 42501)
- Marked "non-blocking" in code but means we have **no audit trail for contract changes**.
- **Action:** either grant the right RLS policy to the auth role used here, or switch this audit write to the service-role client.

---

## P1 — Noise / hygiene (not bugs, but worth tidying)

### 5. SMS safety-limit blocks logged at `error` level (398 entries)
- This is the safety guard **working as designed** (recipient daily/hourly cap reached) but it shouldn't be `error` — downgrade to `warn`. Currently inflates error rate ~10× and masks real issues.

### 6. Bad phone numbers in the customer DB (77 SMS errors across 3 themes)
- 4 distinct numbers failing: `+44 470736…`, `+44 505516…`, `+44 256617…`, `+44 480703…` (plus a few US `+1` numbers being attempted with UK From).
- Twilio errors: code 21211 (invalid To), and "Message cannot be sent with this combination of To/From".
- **Action:** normalise/validate these contacts on the way in (libphonenumber-js is already a dependency), and run a one-off cleanup of existing rows.

### 7. Auth invalid-login at `error` level (18 entries)
- Normal user mistyping behaviour — should be `info` or `warn`, not `error`.

---

## P2 — Transient / one-off

- 3 × `ECONNRESET` on `/api/business/hours` (transient network).
- 1 × `SMS send blocked by idempotency conflict` (working as designed; one-off).
- 2 × 504 on `/events/[id]` (one event ID `46f6a95a-43cf-47c5-9e75-407cf56d9379` — worth checking that page for a slow query).

---

## Suggested next step
Tackle in order: **#2 (schema drift)** → **#1 (PayPal cron loop)** → **#5 (downgrade SMS-safety log level)** → **#3 (dashboard error)**. #2 is the smallest fix and unblocks one cron + 30 5xxs; #1 has the biggest log volume; #5 makes the dashboard usable for real alerting.
