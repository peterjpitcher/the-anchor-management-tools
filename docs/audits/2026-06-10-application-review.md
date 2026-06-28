# Application Review — 2026-06-10

**Scope:** whole application at commit `03f7374c` (main, clean tree).
**Method:** five parallel audits — security/auth, payments & domain rules, code consistency, reliability/ops, build health — plus a live database schema scan (227 tables, 15 views, 471 RLS policies). Every finding below was verified against actual code (file:line cited), not inferred.

**Verdict:** the application is structurally healthy — full verification pipeline green (lint 0 warnings, tsc clean, 2,707/2,707 tests pass, production build succeeds) and the auth architecture is sound and consistently applied. The real problems cluster in three places: **deposit/refund money flows**, **dead-but-documented operational safety switches**, and **drift between documentation, schema and code**.

---

## A. Decide first — policy contradiction

### F1. Deposit threshold: CLAUDE.md says 7+, code says 10+ — **[Decision needed]**
- `src/lib/table-bookings/deposit.ts:14` — `LARGE_GROUP_DEPOSIT_THRESHOLD = 10`
- `supabase/migrations/20260509000015….sql:406` — `v_deposit_required := p_party_size >= 10`
- Project CLAUDE.md domain rule: "£10 deposit per person for groups of **7 or more**".
- Evidence suggests the move to 10 was a deliberate spec change (2026-04-28 spec, May migrations) — groups of 7–9 currently pay **no deposit**.
- **Action:** rule which is correct. If 10+ is current policy → update CLAUDE.md (and anywhere else that states 7). If 7+ stands → fix both the TS constant and the SQL RPC together.
- Related (F22): the rule lives in two places (TS + SQL) and the code comment admits the threshold "has changed twice already" — consolidate or add a cross-check test.
- **Resolved 2026-06-28: ruled 10+ (live code is authoritative); CLAUDE.md updated to match.**

---

## B. High priority — fix soon

### F2. Guest self-cancellation never refunds the deposit — **[High, money]**
- `src/lib/table-bookings/manage-booking.ts:511–650` — guest cancel path evaluates late-cancellation charges but contains **zero refund calls**. Staff cancel paths do refund (`foh/.../cancel/route.ts:95`, `boh/.../status/route.ts:130`, `boh/.../[id]/route.ts:128`).
- Impact: a guest cancelling well in advance keeps `payment_status=completed` and never gets the deposit back unless staff notice manually.
- Fix: call `refundTableBookingDeposit` (with the same tier logic as staff paths) in the guest cancel flow.

### F3. Private-booking hard delete destroys payment records — **[High, money/audit]**
- `src/services/private-bookings/mutations.ts:1581–1636` — delete gate checks SMS only and is **skipped entirely when status='cancelled'**; `private_booking_payments.booking_id` is `ON DELETE CASCADE` (`migrations/20260502000000….sql:4`).
- Impact: a cancelled booking with recorded deposit/balance payments can be hard-deleted, cascading away the financial records.
- Fix: block deletion while `private_booking_payments` rows exist (or require refund/zeroing first).

### F4. SMS kill switch is dead code — **[High, operational]**
- `src/lib/sms/suspension.ts:29` — `resolveSmsSuspensionReason` has **zero importers**. `SUSPEND_ALL_SMS`/`SUSPEND_EVENT_SMS` exist only in `src/lib/env.ts:19–20` and `.env.example:13–14`. `sendSMS` (`src/lib/twilio.ts:207`) never checks suspension.
- Impact: the documented emergency stop for mass-texting customers does nothing.
- Fix: call `resolveSmsSuspensionReason` at the top of `sendSMS` (single chokepoint, all 25 callers covered).

### F5. Unauthenticated admin-client writes in fix-phone-numbers action — **[High, security (latent)]**
- `src/app/actions/fix-phone-numbers.ts:30,57` — both exported `'use server'` actions use `createAdminClient()` (RLS bypass); `fixPhoneNumbers` updates `customers.mobile_number` with no `getUser()`/permission check. Currently **zero callers** (dead code), so not exploitable today — but server actions are network-callable endpoints once bundled.
- Fix: add a permission guard or delete the file.

### F6. No-show/late-cancel card charging is inoperable but still looks live — **[High, operational]**
- `src/lib/table-bookings/charge-approvals.ts:401–455` requires `stripe_customer_id` + `stripe_payment_method_id`; the only flow that ever saved cards (card capture) was removed (`src/app/g/[token]/card-capture/page.tsx` is a tombstone). Every new charge request fails with "No card on file", yet the system still creates requests, emails manager approval links, and surfaces outcomes in `table-bookings/reports/page.tsx:218–238`.
- Impact: staff act on a workflow that can never succeed. Fails safe, but generates noise and false expectations.
- Fix: retire the charge-request pipeline (or rebuild it on a supported payment instrument). Pairs with F7.

### F7. Legacy "card capture" language still in staff UI and schema — **[High per domain rule, effort Low]**
- Domain rule: any legacy credit-card-hold language is always a bug. Found: status label `'Pending card capture'` rendered by `src/components/schedule-calendar/adapters.ts:51–52` (+ `types.ts:18`, `sort.ts:19`) on live dashboard/events pages; copy in `m/[token]/charge-request/page.tsx:210`; DB enum value `pending_card_capture` in `table_booking_status`.
- Customer-facing copy is clean (tombstone page is appropriate); this is staff-facing + schema residue.
- Fix: remove the label/status from UI surfaces; plan enum cleanup with a migration (needs approval — destructive enum change).

---

## C. Medium priority

### Payments & refunds
- **F8.** Tiered auto-refund is Stripe-only: `src/lib/table-bookings/refunds.ts:42–50` looks up `payments.stripe_payment_intent_id`, but PayPal captures write only `table_bookings.paypal_deposit_capture_id` (no `payments` row). Staff cancel/delete reports a misleading `reason:'no_deposit'` for PayPal deposits; refunds must be done manually via `refundActions.ts`.
- **F9.** `refundTableBookingDeposit` (`refunds.ts:70–77`) updates `payments` only — never inserts a `payment_refunds` ledger row, never sets `table_bookings.deposit_refund_status`. Stripe auto-refunds are invisible to the unified refund ledger that all other refund rails maintain.
- **F10.** Private-booking contracts aren't enforced: generation is on-demand only (`/api/private-bookings/contract`, correctly permission-gated); nothing requires a contract before a private booking is confirmed, despite the "contracts must be generated" rule.
- **F11.** PayPal webhook soft-passes when `PAYPAL_WEBHOOK_ID` is unset outside production (`src/app/api/webhooks/paypal/route.ts:88–101` returns 200). Production fails closed. Fix: 500 regardless of `NODE_ENV`.

### Operations & environment
- **F12.** Rate limiting silently degrades: `src/lib/distributed-rate-limit.ts:26–33` falls back to an in-memory per-lambda limiter when `UPSTASH_REDIS_REST_URL/TOKEN` are unset — and both are **missing from `.env.example`**. Exposed public POSTs: `/api/table-bookings`, `/api/private-booking-enquiry`, `/api/public/private-booking`, `/api/external/performer-interest`, `/api/recruitment/applications` (abuse cost: SMS sends, PayPal orders). Declare the vars; log when the fallback engages.
- **F13.** Dead/misleading security env vars: `TWILIO_WEBHOOK_AUTH_TOKEN` (`.env.example:37`) is never read — validation actually uses `TWILIO_AUTH_TOKEN`; `ROTA_FEED_SECRET` (`.env.example:143`) is never read — staff calendar feeds are keyed by `CALENDAR_TOKEN_SECRET ?? SUPABASE_SERVICE_ROLE_KEY` (`src/lib/portal/calendar-token.ts:4`). Rotating either documented "secret" is a no-op, and rotating the service-role key would silently invalidate every staff calendar feed. Delete the dead vars; declare and set `CALENDAR_TOKEN_SECRET`.
- **F14.** Notification fallbacks hide misconfiguration: `RECRUITMENT_NOTIFICATION_EMAIL || 'manager@the-anchor.pub'` (`src/lib/recruitment/communications.ts:113`), same hardcoded fallback for `MANAGER_APPROVAL_EMAIL` (`src/lib/table-bookings/charge-approvals.ts:8`); `RECRUITMENT_FROM_EMAIL` unset → `from: undefined` (communications.ts:169); Google Calendar sync silently disabled when `GOOGLE_CALENDAR_ROTA_ID`/`GOOGLE_CALENDAR_INTERVIEW_ID` absent. None of these are in `.env.example`. Declare them; warn loudly on fallback.
- **F15.** `.env.example` drift overall: ~19 declared-but-unused vars (incl. `WEBHOOK_BASE_URL`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID`) and a dozen used-but-undeclared (`JOB_QUEUE_*`, `OPENAI_*_MODEL`, `MANAGER_APPROVAL_EMAIL`, …).

### Auditability
- **F16.** Mutating server actions with **zero** `logAuditEvent`: `pay-bands.ts` (pay rates — most sensitive), `budgets.ts`, `rota-templates.ts`, `rota-settings.ts`, `vendor-contacts.ts`, `messagesActions.ts`, `sms.ts`, `menu-settings.ts` (via `update_menu_target_gp_transaction` RPC). Partial coverage on money actions: `quotes.ts` (15 mutations/6 audits), `recurring-invoices.ts` (12/6), `payroll.ts` (9/3). Also `portalPayPalActions.ts` writes audit rows directly via `admin.from('audit_logs').insert` instead of the helper.

### Timezone correctness (Europe/London vs UTC)
- **F17.** UTC-derived "today"/week-start bugs (wrong during the 1-hour BST window, midnight–1am London):
  - `src/lib/event-checklist.ts:55,101` — event todos "due today" feed the command centre
  - `src/app/(authenticated)/rota/page.tsx:84`, `rota/print/page.tsx:143`, `src/app/api/rota/pdf/route.ts:277` — `getMondayOfWeek(new Date())` uses `getUTCDay()`; Monday 00:00–01:00 BST renders the previous week
  - `src/lib/employees/separation.ts:27` (leaving date), `src/components/features/cashing-up/WeeklyTargetsModal.tsx:40`, `src/app/api/cron/table-booking-deposit-timeout/route.ts:30`
  - Sweep counts: 37 `.split('T')` date-derivations in app/components; 128 `toLocaleDateString` + 48 `toLocaleString` bypassing `formatDateInLondon()` (mostly cosmetically fine; `settings/audit-logs/AuditLogsClient.tsx:455` is machine-locale dependent; receipts pages pin `timeZone:'UTC'`).
  - Fix pattern: `getTodayIsoDate()` / `toLocalIsoDate()` / `formatDateInLondon()` from `src/lib/dateUtils.ts`.

### Error handling & data quality
- **F18.** Private-booking phone numbers stored unnormalised: `src/app/actions/privateBookingActions.ts:200,317` persist raw form input (no `formatPhoneForStorage`); only normalised later at SMS send. Breaks phone-equality joins/dedupe with `customers`.
- **F19.** Convention violations the team has already written lessons about: `src/app/actions/parking.ts:160` and `src/services/events.ts:27` return `JSON.stringify(error)` to users (lessons.md 2026-05-28 forbids this); `messagesActions.ts:404–437` throws `Error('Insufficient permissions')` to the client instead of returning `{ error }` (11 sites).
- **F20.** 35 migration files define `EXCEPTION WHEN OTHERS` handlers (e.g. `20260410000000_fix_booking_rpc_generated_column.sql`, `20260607000000_d09_payment_expiry_race_condition.sql`) — the documented failure-masking pattern; `20260702000000_log_error_fixes.sql` shows remediation started but incomplete.
- **F21.** `src/app/api/cron/oj-projects-billing/route.ts:3583` — empty `catch {}` around persisting `status:'failed'`: a failed billing run can leave no failure record.

### Dependencies & runtime
- **F22.** (also under A) Deposit logic duplicated TS + SQL — drift-prone.
- **F23.** `npm audit --omit=dev`: **5 high** (0 critical) — `next` (DoS with Server Components — upgrade Next.js), `axios` (SSRF via NO_PROXY bypass), `@xmldom/xmldom`, `basic-ftp`, `tmp`. All have fixes available. 9 moderate.
- **F24.** Local Node is v25.6.0; `.nvmrc` pins 20, engines `>=20 <23`. Everything passed under v25, but it's outside the supported range (`nvm use`).

---

## D. Low priority / hygiene

- **F25. Dead schema generations (0 code references):** `background_jobs`, `job_queue` (live queue is `jobs`, drained every minute by `/api/jobs/process`), `menu_items`, `menu_sections`, `table_configuration`, `table_combinations`(`_tables`). Candidates for DROP migrations — **destructive, needs explicit approval** — then regenerate types.
- **F26. Dead `Role` type with wrong column:** `src/types/database.ts:750–757` declares `is_system_role`; the live column is `is_system` (generated types + squashed migration agree). The correct type in `src/types/rbac.ts` has 13 importers; the wrong one has 0. Delete it before someone uses it.
- **F27. Four dead cron routes** (auth-guarded but never scheduled or invoked): `backfill-marketing-links`, `pub-ops-event-calendar-sync`, `sunday-lunch-prep`, `sunday-preorder` — delete or schedule.
- **F28. Stale project docs:** CLAUDE.md says middleware is disabled — `src/middleware.ts` has been ACTIVE since ~2026-05-27 (`middleware.ts.disabled` still sits beside it; remove it); CLAUDE.md cron table lists 5 of 33 crons and the wrong schedule for parking-notifications (actual `*/15 * * * *`).
- **F29. Hardcoded hex colours:** 145 lines in app/components TSX — mostly justifiable (print CSS in `rota/print`, design-system showcase), but chart palettes (`components/charts/BarChart.tsx`, `LineChart.tsx`, customer insights) belong in `src/ds/tokens.ts`.
- **F30. Misc:** PayPal capture endpoint gated by `read:events` API scope (money-moving route on a read scope — mitigated by server-side amount checks); one direct `@headlessui/react` import off the `@/ds` barrel (`rota/hours/HoursByEmployeeClient.tsx`); `src/instrumentation.ts.bak` should be deleted; schema oddities worth knowing (dual FK on `private_booking_audit.performed_by`; `pl_*`/`greene_king_*` tables not site-scoped; six service-role-only tables with RLS-enabled-zero-policies — confirm intentional).

---

## E. Verified healthy (coverage)

- **Pipeline:** lint 0 errors/0 warnings · tsc clean · 395 test files, 2,707/2,707 pass · production build succeeds (111/111 pages).
- **Auth:** all 36 cron routes check `CRON_SECRET`; webhooks (Twilio/Stripe/Resend/PayPal) validate signatures and fail closed in production; guest tokens are 32-byte CSPRNG, SHA-256-hashed at rest, scoped, expiring, single-use; rota feed uses per-user HMAC + `timingSafeEqual` + live permission re-check; no service-role/admin client reachable from client components; `NEXT_PUBLIC_*` vars contain no secrets; RBAC helpers consistently applied across API routes and actions; genuinely public routes are read-only or token-gated by design.
- **Payments:** PayPal create/capture is idempotent with server-side amount recomputation and double-capture guards; webhook idempotency is TOCTOU-safe; Stripe money handled in integer pence; parking `pending_payment` expiry handled by cron; staff deposit transitions on party-size amendments work both directions; venue-hosted-event deposit exception enforced server-side.
- **SMS:** single `messages.create` chokepoint with opt-in, rate limits and idempotency applying to all 25 call paths (incl. bulk); `skipSafetyGuards` has no external callers.
- **Jobs/cron:** single live `jobs` queue drained every minute; hourly weekly-summary cron is intentional (internal London-time Monday-9am guard).

---

## Suggested sequencing

1. **Rule on F1** (deposit threshold) — one-line answer unlocks either a doc fix or a two-line code+SQL fix.
2. **Money fixes:** F2, F3, then F8+F9 together (unified refund ledger for both rails).
3. **Safety switches:** F4 (SMS kill switch), F5 (guard/delete), F11 (webhook hard-fail), F12+F13+F14 (env hygiene — one PR).
4. **Retire card-capture residue:** F6+F7 as one changeset.
5. **Sweeps as background chores:** F16 (audit logging), F17 (timezone), F23 (dependency upgrades, Next.js first), then D items.

*Generated by a five-agent review (security, payments/domain, consistency, reliability, build) on 2026-06-10.*
