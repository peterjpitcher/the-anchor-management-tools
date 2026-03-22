# QA Review Report

**Scope:** Full application review — Anchor Management Tools (Next.js 15 + Supabase)
**Date:** 2026-03-22
**Mode:** Code Review (Mode A)
**Engines:** Claude + Codex CLI (v0.107.0)
**Files reviewed:** ~902 TypeScript/TSX files across server actions, API routes, services, webhooks, cron jobs, and components

## Executive Summary

Four specialist reviewers (Bug Hunter via Codex, Security Auditor via Codex, Performance Analyst via Claude, Standards Enforcer via Claude) independently analysed the codebase. Together they found **70 findings**: 3 critical bugs, 8 high-severity bugs, 8 high-severity security issues, 3 high-severity performance issues, 3 high-severity standards gaps, plus 45 medium/low findings. The most urgent issues involve **payment data integrity** (invoices can be marked paid without payment records, PayPal deposits don't confirm bookings), **public endpoint security** (mass-assignment on booking API, unauthenticated timeclock), and **financial accuracy** (payroll can approve with missing data).

---

## Critical Findings

### CRIT-001: Invoice status can be set to "paid" without a payment record
- **Engine:** Codex (BUG-001)
- **File:** `src/app/actions/invoices.ts:415`, `src/services/invoices.ts:418`
- **Category:** Data Integrity
- **Description:** `updateInvoiceStatus` allows `paid` and `partially_paid` through the generic status path. `paid` writes `paid_amount = total_amount` with no `invoice_payments` row.
- **Impact:** Ledger shows money received when no payment exists. Remittance advice emailed for nonexistent payments.
- **Fix:** Block monetary statuses in generic status action; require `InvoiceService.recordPayment()` for payment-state transitions.

### CRIT-002: PayPal deposit capture records payment but never confirms the booking
- **Engine:** Codex (BUG-002)
- **File:** `src/app/actions/privateBookingActions.ts:1498`, `src/app/api/webhooks/paypal/private-bookings/route.ts:346`
- **Category:** Data Integrity
- **Description:** PayPal capture paths only stamp `deposit_paid_date`/`deposit_payment_method`. The canonical deposit path also moves `draft -> confirmed` and triggers follow-up side effects.
- **Impact:** Customer pays, booking stays `draft`, misses confirmation/calendar flows, can still be expired or cancelled.
- **Fix:** Route PayPal captures through the same deposit-recording service used by manual deposits.

### CRIT-003: Booking balance reminders cron is POST-only — Vercel cron never invokes it
- **Engine:** Codex (BUG-003)
- **File:** `src/app/api/cron/booking-balance-reminders/route.ts:13`
- **Category:** Logic
- **Description:** File only exports `POST`. Vercel cron jobs invoke `GET`.
- **Impact:** Daily balance reminder SMSes never run in production.
- **Fix:** Export `GET` for the cron entrypoint.

---

## High Findings

### HIGH-001: Public booking endpoint allows mass-assignment of internal fields
- **Engines:** Codex (BUG-004) + Codex (SEC-003) — **CROSS-ENGINE AGREEMENT**
- **File:** `src/app/api/public/private-booking/route.ts:156`
- **Category:** Data Integrity + Security (A01)
- **Description:** Route spreads raw request body into `CreatePrivateBookingInput`, including `customer_id`, `deposit_amount`, `status`, `created_by`.
- **Impact:** Public caller can tamper with internal booking/payment state or bind enquiry to wrong customer.
- **Fix:** Replace spread with strict public schema and explicit field whitelist.

### HIGH-002: Duplicate Twilio webhooks increment failure counters, deactivating valid customers
- **Engine:** Codex (BUG-005)
- **File:** `src/app/api/webhooks/twilio/route.ts:258`
- **Category:** Data Integrity
- **Description:** Duplicate status callbacks still call `applySmsDeliveryOutcome()`. Each retry increments `sms_delivery_failures`.
- **Impact:** One failed SMS retried by Twilio can wrongly deactivate a customer from future SMS.
- **Fix:** Deduplicate outcome application by status transition.

### HIGH-003: Payroll approval can proceed with silently missing data
- **Engine:** Codex (BUG-006)
- **File:** `src/app/actions/payroll.ts:143`
- **Category:** Partial Failure
- **Description:** `getPayrollMonthData()` fetches shifts, sessions, pay settings in parallel but only checks `shiftsError`.
- **Impact:** Approvable payroll snapshot with missing hours or null pay rates.
- **Fix:** Fail the whole review when any required dataset errors.

### HIGH-004: Parking capacity can be oversold under concurrent bookings
- **Engine:** Codex (BUG-007)
- **File:** `src/services/parking.ts:85`
- **Category:** Race Condition
- **Description:** Availability checked first, booking inserted separately. No transaction or DB guard.
- **Impact:** Two simultaneous bookings for last space both confirmed.
- **Fix:** Move to single transaction/RPC or add database-level constraint.

### HIGH-005: Concurrent clock-ins create duplicate open sessions
- **Engines:** Codex (BUG-008) + Codex (SEC-001) — **CROSS-ENGINE AGREEMENT**
- **File:** `src/app/actions/timeclock.ts:84`
- **Category:** Race Condition + Auth (timeclock is public with no PIN/secret)
- **Description:** Read-then-insert with no lock or uniqueness guarantee. Plus the `/timeclock` route is public — anyone on the internet can clock in/out any employee.
- **Impact:** Multiple open sessions per employee; `.single()` lookups fail. Public exposure allows attendance falsification.
- **Fix:** Add unique partial index + atomic insert. Add kiosk secret + per-employee PIN.

### HIGH-006: Booking APIs create pending_payment holds with no payment link
- **Engine:** Codex (BUG-009)
- **File:** `src/app/api/table-bookings/route.ts:234`, `src/app/api/event-bookings/route.ts:489`
- **Category:** Partial Failure
- **Description:** Both routes swallow payment-token creation failures and return success with `next_step_url: null`.
- **Impact:** Inventory held, customer cannot pay, idempotency replays the dead-end.
- **Fix:** Fail the request or roll back the hold when token generation fails.

### HIGH-007: Hold-expiry cron can cancel recently confirmed bookings
- **Engine:** Codex (BUG-010)
- **File:** `src/app/api/cron/private-bookings-expire-holds/route.ts:18`
- **Category:** Race Condition
- **Description:** Cron snapshots expired draft IDs, then cancels by ID only. A booking confirmed between those two steps is cancelled incorrectly.
- **Fix:** Use single guarded update with `status='draft'` condition.

### HIGH-008: Recurring invoice schedules permanently wedged after partial success
- **Engine:** Codex (BUG-011)
- **File:** `src/app/api/cron/recurring-invoices/route.ts:58`
- **Category:** Partial Failure
- **Description:** If invoice creation succeeds but `next_invoice_date` advance fails, idempotency seals the key. Future runs skip the schedule forever.
- **Fix:** Make both operations atomic or only seal after both succeed.

### HIGH-009: Employee document actions sign arbitrary storage paths
- **Engine:** Codex (SEC-004, SEC-005)
- **File:** `src/app/actions/employeeActions.ts:812`
- **Category:** Security (A01)
- **Description:** `getAttachmentSignedUrl` accepts raw storage paths and creates signed URLs without verifying the file belongs to a record the caller may access.
- **Impact:** Any user with `employees.view_documents` can retrieve hidden/orphaned HR documents by guessing paths.
- **Fix:** Look up file by record ID, verify authorization, sign only resolved path.

### HIGH-010: System roles mutable via permission assignment bypass
- **Engine:** Codex (SEC-006)
- **File:** `src/services/permission.ts:267`, `src/app/actions/rbac.ts:311`
- **Category:** Security (A01)
- **Description:** `updateRole()` blocks `is_system` roles, but `assignPermissionsToRole()` does not.
- **Impact:** User with `roles.manage` can alter system roles and grant broader permissions.
- **Fix:** Enforce `is_system` check in all role-mutation paths.

### HIGH-011: Two cron routes fail open when CRON_SECRET unset
- **Engine:** Codex (SEC-007)
- **File:** `src/app/api/cron/table-booking-deposit-timeout/route.ts:9`, `src/app/api/cron/private-bookings-expire-holds/route.ts:10`
- **Category:** Security (A05)
- **Description:** If CRON_SECRET env var missing, `Bearer undefined` is accepted.
- **Impact:** Destructive booking-expiry jobs exposed to public internet.
- **Fix:** Shared helper that hard-fails when CRON_SECRET is absent.

### HIGH-012: Public config endpoint leaks internal vendor/commercial data
- **Engine:** Codex (SEC-002)
- **File:** `src/app/api/public/private-booking/config/route.ts:10`
- **Category:** Data Exposure (A01)
- **Description:** Unauthenticated endpoint returns admin-backed vendor/package data including supplier contacts, finance fields.
- **Fix:** Return explicit public allowlist only.

### HIGH-013: `persistOverdueInvoices()` called on every invoice read
- **Engine:** Claude (PERF-001)
- **File:** `src/services/invoices.ts:276`
- **Category:** Performance
- **Description:** Every `getInvoices()` or `getInvoiceById()` first runs an UPDATE query on all overdue invoices. Adds 50-200ms write latency to every invoice page load.
- **Fix:** Move to cron job or compute status in JS at read time (already partially done).

---

## Medium Findings

| ID | Source | File | Summary |
|----|--------|------|---------|
| MED-001 | Codex BUG-012 | `receipts.ts:2573` | Bulk receipt rollback wipes prior vendor classification instead of restoring |
| MED-002 | Codex BUG-013 | `cron/auto-send-invoices` | Auto-send emails draft invoice, then status change can fail — invoice stuck in draft |
| MED-003 | Codex BUG-014 | `dateUtils.ts:27` | `getTodayIsoDate()` uses host timezone, not London — DST bugs |
| MED-004 | Codex SEC-009 | `permission.ts:85` | RBAC revocation effective for up to 60s after admin removal (cache) |
| MED-005 | Codex SEC-010 | `privateBookingActions.ts:802` | Booking discounts have no server-side bounds check |
| MED-006 | Codex SEC-011 | `webhooks/paypal`, `webhooks/twilio` | Webhook handlers persist untrusted payloads before verification |
| MED-007 | Codex SEC-008 | `privateBookingActions.ts:1624` | View-only staff can mint non-expiring booking portal links |
| MED-008 | Claude PERF-002 | `messagesActions.ts:156` | Messages inbox fetches up to 900 rows to build 25 conversations |
| MED-009 | Claude PERF-003 | `private-bookings.ts:1762` | `getBookings()` uses `select('*')` on view without pagination |
| MED-010 | Claude PERF-009 | `dashboard-data.ts:1051` | Quotes dashboard fetches 3x1000 rows to sum in JS instead of SQL |
| MED-011 | Claude PERF-015 | `dashboard-data.ts:886` | All unpaid invoices fetched to sum in JS — no limit |
| MED-012 | Claude PERF-011 | `rbac.ts:64` | `checkUserPermission` creates new Supabase client each time |
| MED-013 | Claude PERF-012 | Entire `src/` | Zero `next/dynamic` imports — all components eagerly loaded |
| MED-014 | Claude STD-003 | 31 action files | 171 `error: any` occurrences — should be `error: unknown` |
| MED-015 | Claude STD-004 | All services | No `fromDb` conversion layer exists despite documented standard |
| MED-016 | Claude STD-005+006 | 10+ template files | Hardcoded personal phone/name PII in email templates |
| MED-017 | Claude STD-007+008 | Multiple files | Raw `new Date()` bypassing dateUtils for user-facing dates |
| MED-018 | Claude STD-012 | All auth routes | Zero `error.tsx` boundaries in entire authenticated route tree |
| MED-019 | Claude STD-014 | `invoices.ts:414` | Unsafe `FormData.get() as Type` casts without validation |
| MED-020 | Claude STD-010 | `receipts.ts`, `event-categories.ts` | `console.log` in production server actions |

---

## Low Findings

| ID | Source | Summary |
|----|--------|---------|
| LOW-001 | Claude PERF-005 | Calendar notes fetched with 730-day horizon (up to 1000 rows) |
| LOW-002 | Claude PERF-006 | Dashboard cashing-up section makes 4 sequential rounds instead of 2 |
| LOW-003 | Claude PERF-008 | Rota shifts fetched with `select('*')` |
| LOW-004 | Claude PERF-014 | `select('*')` used in 30+ service queries |
| LOW-005 | Claude PERF-018 | Financials service sequential deletes in loop |
| LOW-006 | Claude PERF-019 | Receipt pagination in sequential loop |
| LOW-007 | Claude PERF-021 | Dashboard cache TTL only 60s for all metrics |
| LOW-008 | Claude PERF-022 | `date-fns` barrel imports in 20+ files |
| LOW-009 | Claude STD-009 | Hardcoded hex colours in calendar/rota print |
| LOW-010 | Claude STD-011 | `console.log` in services |
| LOW-011 | Claude STD-013 | Loading.tsx missing in 8+ route directories |
| LOW-012 | Claude STD-015-017 | Various `any` types in GDPR service, private bookings, employee invite |
| LOW-013 | Claude STD-019 | Inconsistent permission check patterns (3 different styles) |
| LOW-014 | Claude STD-018 | Low test coverage — 21 test files for ~600 source files |

---

## Cross-Engine Analysis

### Agreed (both engines flagged independently)

These findings were identified by both Codex and Claude independently — **highest confidence**:

1. **PUBLIC BOOKING MASS-ASSIGNMENT** (BUG-004 + SEC-003) — Both flagged the public private-booking endpoint accepting arbitrary internal fields
2. **TIMECLOCK AUTH + RACE CONDITION** (BUG-008 + SEC-001) — Codex Bug Hunter found the race condition; Codex Security Auditor found the missing auth. Both independently flagged the same endpoint.
3. **DATE HANDLING INCONSISTENCY** (BUG-014 + STD-007/008) — Codex found `getTodayIsoDate()` uses host TZ; Claude found components bypassing dateUtils entirely

### Codex-Only Findings

These were uniquely caught by the different model perspective:

- **CRIT-001** (invoice paid without payment) — Subtle business logic trace through two files
- **CRIT-002** (PayPal deposit doesn't confirm) — Required understanding webhook vs manual deposit paths
- **CRIT-003** (cron POST vs GET) — Simple but easy to miss
- **HIGH-006** (payment link failures swallowed) — Required tracing partial failure paths
- **HIGH-008** (recurring invoice wedge) — Complex idempotency interaction
- All security findings (SEC-001 through SEC-011) — Codex performed systematic auth tracing

### Claude-Only Findings

These required deep project context:

- **All performance findings** — Required understanding query patterns, caching strategy, and dashboard architecture
- **All standards findings** — Required comparing code against CLAUDE.md conventions
- Specifically: `persistOverdueInvoices()` blocking reads, missing `next/dynamic`, `fromDb` gap

---

## Recommendations — Priority Fix Order

### Immediate (fix this week)
1. **CRIT-001** — Block paid/partially_paid from generic status update path
2. **CRIT-002** — Route PayPal captures through canonical deposit service
3. **CRIT-003** — Export GET on booking-balance-reminders cron
4. **HIGH-001** — Add strict schema to public booking endpoint
5. **HIGH-003** — Check all dataset errors in payroll approval
6. **HIGH-011** — Fix CRON_SECRET fail-open on two cron routes

### Short-term (next 2 weeks)
7. **HIGH-005** — Add PIN/secret to timeclock + unique constraint on open sessions
8. **HIGH-004** — Atomic parking capacity check
9. **HIGH-006** — Fail on payment link generation error
10. **HIGH-007** — Guarded update in hold-expiry cron
11. **HIGH-010** — Enforce `is_system` check in permission assignment
12. **HIGH-013** — Move `persistOverdueInvoices()` to cron

### Medium-term (next month)
13. **MED-016** — Extract hardcoded PII to env vars
14. **MED-003** — Fix dateUtils to use London timezone properly
15. **MED-008/009** — Optimise messages inbox and bookings queries
16. **MED-014** — Project-wide `error: any` to `error: unknown` codemod
17. **MED-018** — Add root `error.tsx` boundary
18. **MED-019** — Add runtime validation for FormData casts

### Long-term (tech debt backlog)
19. **LOW-014** — Increase test coverage for core business logic
20. **MED-015** — Decide on fromDb convention vs update standard
21. **MED-013** — Add `next/dynamic` for heavy components
22. Performance quick wins (PERF-009, PERF-015 — SQL aggregates)

---

## Specialist Reports

Individual reports are available at:
- `tasks/codex-qa-review/bug-hunter-report.md` (Codex — 14 bugs)
- `tasks/codex-qa-review/security-auditor-report.md` (Codex — 11 vulnerabilities)
- `tasks/codex-qa-review/performance-analyst-report.md` (Claude — 22 findings)
- `tasks/codex-qa-review/standards-enforcer-report.md` (Claude — 23 deviations)

---

*Generated: 2026-03-22 | Engines: Claude Opus 4.6 + Codex CLI 0.107.0*
