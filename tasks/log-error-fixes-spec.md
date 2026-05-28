# Spec: Fix production log errors (2026-05-14 → 2026-05-28)

**Source analysis:** [tasks/log-review-2026-05-28.md](log-review-2026-05-28.md)
**Window analysed:** 14 days, 62,434 log entries → 4,161 errors → 7 distinct root causes
**Verified against:** current `main` (HEAD `7ecebcf3`), `supabase/migrations/20251123120000_squashed.sql`, commits since 2026-04-01

> **Pre-flight verification:** None of the seven root causes below has been touched by any commit since 2026-04-01. The closest is `bccd47a3 Add SMS failure diagnostics` (2026-05-25), which added logging but didn't change error levels or fix the schema writes.

---

## Sequencing

Five small, independently deployable PRs. Order is by blast-radius reduction:

| # | PR | Risk | Effect |
|---|---|---|---|
| 1 | `fix/audit-logs-column-names` | Low | Unblocks generate-slots cron (50 × HTTP 500 → 0) and invoice-reminders audit trail |
| 2 | `fix/private-booking-contract-audit-client` | Low | Restores contract audit-log trail |
| 3 | `fix/paypal-reconciliation-stuck-orders` | Medium | Cuts ~80% of error volume; one DB cleanup step |
| 4 | `chore/log-level-hygiene` | Low | Cuts noise: SMS safety + auth-login → `warn`/`info` |
| 5 | `fix/dashboard-quote-metrics-error-surfacing` | Low | Surfaces real underlying error so it can then be fixed |

Each PR has its own verification block; merge them sequentially.

---

## PR 1 — `fix/audit-logs-column-names`

### Problem
Two crons write column names that do not exist on `public.audit_logs`:

| Caller | Bad column | Real column (per schema) | Log evidence |
|---|---|---|---|
| `/api/cron/generate-slots` | `entity_type` | `resource_type` (or omit; `entity_type` is from `rota_email_log` / `reconciliation_notes`) | 10 × `column "entity_type" of relation "audit_logs" does not exist`, + 50 × HTTP 500 because the throw is uncaught |
| `/api/cron/invoice-reminders` | `operation_details` | `additional_info` | 3 × `Could not find the 'operation_details' column of 'audit_logs' in the schema cache` |

Canonical `audit_logs` schema (squashed migration line ~11294):
```
id, created_at, user_id, user_email, operation_type, resource_type, resource_id,
operation_status, ip_address, user_agent, old_values, new_values, error_message, additional_info
```

### Fix
1. **`src/app/api/cron/invoice-reminders/route.ts` line 428–435**
   - Rename `operation_details:` → `additional_info:`.
   - Confirm the surrounding insert object has `operation_type`, `resource_type`, `operation_status` (per the CHECK constraint `operation_status IN ('success','failure')`).
   - The error is currently caught and logged as non-blocking, so behaviour change is minimal — but the audit trail is currently empty for invoice reminders.

2. **`src/app/api/cron/generate-slots/route.ts`** (and any helper it calls — search for `entity_type` near an `audit_logs` insert)
   - Map `entity_type` → `resource_type`; map `entity_id` → `resource_id` if present.
   - **This error currently throws and returns HTTP 500** (uncaught in generate-slots, unlike invoice-reminders). Wrap in try/catch so the slot generation itself doesn't fail because of a logging side-effect.

3. **Repo-wide audit** — grep for any other `audit_logs` write that uses non-canonical columns:
   ```bash
   grep -rEn "from\\('audit_logs'\\)" src | xargs -I {} dirname {}
   # then check each writer for: entity_type, entity_id, operation_details, details, action
   ```
   Likely additional candidates: `src/app/actions/auditLogs.ts:58`, `src/services/audit.ts:60`, `src/lib/paypal-refund-webhook.ts:294`. Fix any that drift.

4. **Add a Vitest test** for the audit-log helper (`src/services/audit.ts` if it has a public `logAuditEvent`) asserting it inserts the canonical column set only. Mock the Supabase client and assert insert payload keys ⊆ `{user_id, user_email, operation_type, resource_type, resource_id, operation_status, ip_address, user_agent, old_values, new_values, error_message, additional_info}`.

### Out of scope
Adding `entity_type` / `operation_details` columns to `audit_logs` via migration — the rest of the codebase uses the canonical names; adding new columns would create two sources of truth.

### Verification
- `npm run lint && npx tsc --noEmit && npm test`
- Manually trigger `/api/cron/generate-slots` against a preview deploy (`curl -H "Authorization: Bearer $CRON_SECRET" …`) → expect HTTP 200, slots generated.
- Trigger `/api/cron/invoice-reminders` similarly → expect 200, then `SELECT * FROM audit_logs WHERE operation_type LIKE '%reminder%' ORDER BY created_at DESC LIMIT 5` returns rows with populated `additional_info`.
- Watch Vercel logs for 24h: zero recurrences of either column-name error.

---

## PR 2 — `fix/private-booking-contract-audit-client`

### Problem
`src/app/api/private-bookings/contract/route.ts:76` writes to `private_booking_audit` via the **cookie-based** Supabase client. RLS on that table (squashed migration line 5213) is enabled, but the only policy is `SELECT` for authenticated users — there is **no `INSERT` policy**, so every write fails with code 42501 (`new row violates row-level security policy`).

The error is caught and labelled "non-blocking", but the contract audit trail is completely missing.

### Fix
Switch the writer to the admin client, matching the pattern already in use in `src/services/sms-queue.ts` (lines 405, 525, 600, 679, 1048, 1126).

```ts
// at top of route
import { createAdminClient } from '@/lib/supabase/admin'

// inside handler, after user auth check:
const admin = createAdminClient()
const { error: auditError } = await admin.from('private_booking_audit').insert({ ... })
```

Keep the existing user-auth check using the cookie client — only the *audit write* moves to admin.

### Alternative (rejected)
Adding an `INSERT` RLS policy that lets authenticated users write audit rows is rejected: audit trails must be tamper-resistant, written by trusted server code only, never by client-driven mutations. Service-role write is the right pattern.

### Verification
- `npm test src/app/api/private-bookings/contract`
- Manually generate a contract on staging → `SELECT * FROM private_booking_audit WHERE action LIKE '%contract%' ORDER BY performed_at DESC LIMIT 3` returns the new row.
- Zero recurrences of "Contract audit log failed" in logs for 24h.

---

## PR 3 — `fix/paypal-reconciliation-stuck-orders`

### Problem
`/api/cron/paypal-deposit-reconciliation` accounts for **3,358 errors (81% of volume)**. Only **4 distinct order IDs** loop forever:
```
4TB38943S69167218, 2J52830664016643Y, 2GY54506VR606383F, 9C152858VV719682A
```
The cron's catch block calls `clearStalePayPalOrder` only when `isPayPalOrderNotFoundError(error)` is true (`paypal.ts:66–82`). That function recognises:
- HTTP 404, OR
- error name `RESOURCE_NOT_FOUND`, OR
- issue codes `INVALID_RESOURCE_ID` / `ORDER_NOT_FOUND`

The 4 stuck orders must be returning something else (probably HTTP 422 with `ORDER_ALREADY_CAPTURED`/`ORDER_NOT_APPROVED`, or 400 with `INVALID_REQUEST`). We don't know exactly *what* because of bug B below.

There are two bugs here:

**Bug A — orphan orders never cleared.** Cron retries the same dead orders every 15 min indefinitely.
**Bug B — error body swallowed in logs.** The logger receives the `PayPalApiError` object directly; `JSON.stringify` serialises Error properties as `{}` because they're non-enumerable. So the log shows `"error":{}` and we can't see the PayPal response that would tell us *why* the order is stuck.

### Fix
1. **Surface the PayPal error properly.** Wherever the cron logs `Failed to check order` (search for the message in `src/app/api/cron/paypal-deposit-reconciliation/route.ts`), change the log to include the PayPalApiError's enumerable fields:
   ```ts
   logger.error('PayPal reconciliation: failed to check order', {
     metadata: {
       bookingId,
       orderId,
       paypalStatus: error instanceof PayPalApiError ? error.status : null,
       paypalDetails: error instanceof PayPalApiError ? error.details : null,
       errorMessage: error instanceof Error ? error.message : String(error),
     }
   })
   ```
   Export `PayPalApiError` from `src/lib/paypal.ts` if it isn't already (line 20).

2. **Add an attempt-count safety valve.** Add `paypal_reconciliation_attempts` (int) and `paypal_reconciliation_last_error` (text) to `private_bookings` via migration. Increment on every failed `getPayPalOrder` lookup. After **5 consecutive failures**, call `clearStalePayPalOrder` with `reason: 'paypal_order_exhausted_retries'` so we stop looping. Reset to 0 on any successful lookup.

3. **Broaden `isPayPalOrderNotFoundError`** based on what (1) reveals. Likely additions: PayPal issue codes `ORDER_ALREADY_CAPTURED` (means we already got the money but lost track), `AGREEMENT_ALREADY_CANCELLED`, expired-token codes. Add unit tests in `src/lib/__tests__/paypal.test.ts` covering each new code.

4. **One-off cleanup script.** `scripts/clear-stuck-paypal-orders.ts` that, given the 4 known order IDs, looks them up via `getPayPalOrder`, prints the PayPal response, and (if confirmed dead) nulls `paypal_deposit_order_id` on the bookings. Document the script in `tasks/` and run it once on production after PR 3 ships.

### Investigation sequence (do this before final fix)
- Deploy step 1 alone to a preview branch and let the cron run once.
- Read the surfaced PayPal error in Vercel logs.
- That tells us exactly what error code to add to `isPayPalOrderNotFoundError` and whether the 4 orders are recoverable (captured but unrecorded → re-finalise) or terminal (never captured → just clear).

### Verification
- Deploy preview → trigger cron once via `curl` → inspect log for non-empty `paypalDetails`.
- After full PR: run `SELECT id, paypal_deposit_order_id, paypal_reconciliation_attempts FROM private_bookings WHERE paypal_deposit_order_id IS NOT NULL AND deposit_paid_date IS NULL` — count should drop to 0 (or stabilise) and the 4 orphan order IDs should be nulled.
- 24h log watch: PayPal error count drops from ~150/day to <5/day.

---

## PR 4 — `chore/log-level-hygiene`

### Problem
398 SMS safety-guard hits and 18 invalid-login attempts are logged at `error` level. Both are *working as designed*, so they inflate the error rate ~10× and drown out real bugs.

### Fix
1. **`src/lib/twilio.ts:267`** — change `logger.error('Outbound SMS blocked by safety limits', …)` → `logger.warn(…)`. The `success: false` return value still propagates to callers; only the log level changes.

2. **`src/services/auth.ts:19`** — remove the `console.error('Supabase Auth Error:', error.message)` entirely. The line right after (`throw new Error('Invalid email or password')`) surfaces the failure to the user already, and Supabase Auth itself logs failed attempts. If we want a record for rate-limit/IDS purposes, replace it with an explicit `await logAuditEvent({ operation_type: 'login_failed', resource_type: 'auth', operation_status: 'failure', user_email: email })` so it ends up on the audit trail rather than the error log.

3. **No other "expected-failure" `error` calls.** Grep for `logger.error\|console.error` and review the surrounding code for any other "this is expected behaviour" cases (idempotency-conflict log at `event-guest-engagement` is fine — it fires once, which is rare).

### Verification
- `npm run lint && npx tsc --noEmit && npm test`
- 24h log watch: `level=error` daily count drops by ~30; `level=warn` daily count rises by the same amount.
- Vercel error rate alert (if configured) should now reflect real bugs.

---

## PR 5 — `fix/dashboard-quote-metrics-error-surfacing`

### Problem
`src/app/(authenticated)/dashboard/dashboard-data.ts:1440` logs:
```ts
console.error('Failed to load dashboard quote metrics:', error)
```
The Supabase error object renders as `{ message: '' }` because Supabase's error type isn't a standard `Error` — its key fields (`code`, `message`, `details`, `hint`) aren't always set the way the formatter expects. So we get 142 occurrences of an error with no diagnostic content.

### Fix
1. **Improve the logger first** (this is a one-line fix, low risk):
   ```ts
   console.error('Failed to load dashboard quote metrics:', {
     code: error?.code,
     message: error?.message,
     details: error?.details,
     hint: error?.hint,
   })
   ```
   Switch to the project's `logger` (`@/lib/logger`) if dashboard-data already uses it elsewhere.

2. **Deploy, observe one failure, then fix the underlying query** in a follow-up PR. The most likely cause is an RLS/permission issue on `quotes` for the dashboard's anon-key client, or a column rename. We can't fix the root cause until step 1 tells us what Supabase is actually complaining about.

### Verification
- Deploy → load `/dashboard` → check Vercel log for the next "Failed to load dashboard quote metrics" entry with populated `code`/`message`.
- Open a follow-up issue with the surfaced error and triage from there.

---

## P2 stragglers (no PR needed yet)

These three are low-volume and likely transient or working-as-intended. Not actioning unless they recur after PRs 1–5 ship.

| Item | Count | Action |
|---|---|---|
| `ECONNRESET` on `/api/business/hours` | 3 | Already wrapped in `retry()`; check if retries are exhausting too early. Monitor only. |
| `SMS send blocked by idempotency conflict` | 1 | Working as designed (prevents duplicate sends). Already at `error` level — could downgrade to `warn` as part of PR 4 if we want. |
| 2 × 504 on `/events/[id]` (event ID `46f6a95a-43cf-47c5-9e75-407cf56d9379`) | 2 | Check if that specific event has unusually many bookings or images; consider adding pagination or a slow-query log. |

Bad phone numbers in DB (4 distinct numbers causing 77 SMS failures) are tracked separately as a data-quality task — they shouldn't block these PRs. Recommend a one-off cleanup script + tighter `formatPhoneForStorage()` validation at the write side. Track in [tasks/lessons.md](lessons.md) or a new ticket.

---

## Definition of done (whole stream)

- [ ] All 5 PRs merged to `main`, deployed to production
- [ ] 24-hour log window after final deploy shows:
  - PayPal reconciliation errors < 10/day (currently ~250/day)
  - `audit_logs` column-name errors: 0 (currently ~1/day average)
  - Private-booking contract audit trail populated for new contracts
  - Dashboard quote metrics either silent (root cause fixed) or surfacing a meaningful error
  - `level=error` count down from ~300/day to <50/day
- [ ] [tasks/lessons.md](lessons.md) updated with two new rules:
  1. "Never `JSON.stringify(error)` directly — Error properties are non-enumerable. Always destructure `code/message/details/hint` (Supabase) or the relevant fields (PayPalApiError, Twilio errors)."
  2. "Before adding/renaming columns referenced by an audit-log writer, grep all `from('audit_logs').insert(` callsites and update them in the same migration (per `.claude/rules/supabase.md`)."
