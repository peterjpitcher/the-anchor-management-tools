# The Anchor Management Tools — Whole-App Section Review

**Date:** 2026-06-24
**Reviewer:** Lead synthesis (consolidating 34 per-section adversarial reviews)
**Scope:** Every major section of the application — dashboard, customers, employees, events, private bookings, invoices, quotes, receipts, expenses, mileage, MGD, parking, rota, menu management, messaging/SMS, table bookings, cashing up, OJ Projects, short links, recruitment, settings, RBAC, profile, payroll, leave, the public flows (table booking, parking guest, timeclock kiosk, employee onboarding, staff portal), auth/layout, payments, webhooks and cron jobs.

---

## Executive summary

This review consolidates per-section findings across the whole application. Each serious finding was passed through an adversarial verifier; this report **trusts those verdicts** — findings ruled `isReal: false` were dropped, and corrected severities were applied. After de-duplication and false-positive removal, **109 findings** remain.

The headline numbers after triage:

- **1 Critical**, **22 High**, **42 Medium**, **44 Low**.

The single critical issue is a Row Level Security policy that grants the **public `anon` role blanket `UPDATE` on `timeclock_sessions` with `WITH CHECK (true)`** — anyone holding the public anon key can rewrite any open clock-in record (employee_id, clock_out_at, etc.), directly tampering with payroll source data. This needs immediate remediation.

Beyond that, the dominant pattern across the app is **exported server actions that skip a server-side RBAC re-check** and instead rely on either page-level gating (which does not protect the directly-invocable RPC endpoint) or on RLS. Several of these were correctly down-graded by the verifier because RLS does provide a backstop, but a handful genuinely expose data or money-moving operations (`daily-summary`, `getHolidayUsage`, `getEventBookings`, AI menu parsing, payroll read actions, PayPal capture routes gated on a read-only scope).

The other recurring, real-money concern is **timezone-incorrect date arithmetic** feeding financial/booking boundaries — refund tiers, deposit-cancellation thresholds, payroll windows and booking cut-offs computed against server-local/UTC time rather than Europe/London.

A functional regression also stands out: the **`/m` manager charge-approval route is missing from the middleware public allowlist**, so logged-out managers following an SMS/email link are bounced to login — the whole approve/waive flow is broken. The root cause is stale documentation claiming middleware is disabled when it is actually live.

The codebase is, on the whole, well-engineered: idempotency on webhooks and crons is strong, audit logging is broad, atomic RPCs are used for the most sensitive financial transitions, and the design-system discipline is good. The findings below concentrate on the seams.

---

## Cross-cutting themes

These are classes of problem that recur across many sections. Fixing them centrally (or with a shared helper / lint rule) will resolve dozens of individual findings.

### 1. Exported server actions missing a server-side RBAC/auth re-check (severity: high)

Next.js registers every exported `'use server'` function as an independently-callable RPC endpoint. Page-level gating does **not** protect the action. Numerous read/list actions verify only `auth.getUser()` (or nothing) and trust either page gating or RLS.

- **Genuinely exposing data or operations:** `getDailySummaryAction` (dashboard — leaks private-booking customer PII via the service-role client), `getHolidayUsage` (leave / staff-portal — any authenticated user reads any employee's holiday allowance/usage; **RLS confirmed permissive, so this is a real IDOR**), `getEventBookings` (events — customer PII via admin client behind only `events:view`), `parseIngredientWithAI` / `reviewIngredientWithAI` (menu — unguarded billable OpenAI calls, one directly client-invoked), the payroll read actions (`getPayAgeBands`/`getPayBandRates`/`getEmployeeRateOverrides`/`getDepartmentBudgets` — compensation data exposed to any authenticated user; **RLS confirmed permissive**), and `getMissingCashupDatesAction` (cashing-up).
- **Standards deviation only (RLS backstops the data):** `getCustomerList`, `getBulkCustomerLabels`, `updateSiteSettings`/`updateSiteToggle` (settings), `getMenuTargetGp`, `getBulkCustomerLabels`.

**Affected sections:** dashboard, customers, employees, events, menu-management, cashing-up, settings, payroll, leave, staff-portal, short-links.
**Fix:** add `checkUserPermission(module, action)` (with a self-service `isOwnEmployeeRecord` fallback where appropriate) to the top of every exported action that reads or mutates protected data; do not rely on the page or on RLS alone. Consider a lint rule that flags exported `'use server'` functions with no `checkUserPermission` call.

### 2. Timezone-incorrect date arithmetic on money/booking boundaries (severity: high → low)

The workspace standard mandates `src/lib/dateUtils.ts` (Europe/London) for all user-facing and boundary date logic. Many places use raw `new Date()`, `.setHours(0,0,0,0)`, `.toISOString()`, `.toLocaleDateString()` or `date-fns format()` in the runtime timezone (UTC on Vercel), shifting boundaries by up to a day / a BST hour.

- **Real-money / real-decision boundaries (high/medium):** private-booking cancellation 30-day refund threshold (`financial.ts daysUntilEvent`), table-booking refund tier day-count (`refunds.ts`), payroll P&L window starts, customer-eligibility win-back cutoff.
- **Display-only / lower-impact (low):** dashboard chart/birthday labels, invoice/quote/profile/users dates, message thread grouping, mileage/expense/MGD period boundaries, leave holiday-year computation, recruitment booking times, short-link analytics windows.

**Affected sections:** dashboard, customers, employees, events, private-bookings, invoices, quotes, receipts (intentional UTC — acceptable), mileage, expenses, mgd, rota, messages-sms, table-bookings, cashing-up, oj-projects, short-links, recruitment, settings, payroll, leave, profile, staff-portal, public flows, cron-jobs.
**Fix:** route all boundary and user-facing date logic through `dateUtils` (`getTodayIsoDate`, `toLocalIsoDate`, `formatDateInLondon`, London-aware diffing). Prioritise the refund/threshold cases.

### 3. Missing audit logging on mutations (severity: medium)

The Supabase rule requires `logAuditEvent()` on every create/update/delete. Several sensitive mutations skip it, leaving no trail of who changed what.

- **Most sensitive:** onboarding financial/health PII writes (`saveOnboardingSection` — NI number, bank details, health records), BOH table-booking delete/cancel (hard delete with no trail), GDPR candidate erasure (recruitment), `deletePayrollRow` (changes what an employee is paid), `updateRotaSettings` (manager/accountant PII emails + wage target), vendor-contact CRUD, OJ vendor billing settings, MGD reopen (incomplete old/new values), `requeueUnclassifiedTransactions`, `move-table`, RBAC assignment logs (UUIDs only, no names), `addEmployeeNote` failure branch.

**Affected sections:** employee-onboarding, table-bookings-admin, recruitment, payroll, rota, private-bookings, oj-projects, mgd, receipts, employees, roles-users-rbac.
**Fix:** add `logAuditEvent` (with `user_id`, `resource_id`, and meaningful but non-PII `new_values`) to each path.

### 4. Non-atomic multi-step writes / delete-then-insert without a transaction (severity: high → medium)

Several flows do delete-then-insert or sequential writes with best-effort manual rollback rather than a single Postgres transaction/RPC. A failure between steps (or a failing rollback) corrupts or loses data.

- mileage trip create/update (orphaned legless trips skew HMRC tax-year totals), RBAC permission/role replace (can strip a role/user of all permissions), recruitment slot claim/reschedule (lost or double-locked slots), receipts bulk group classification, menu pack-cost + price-history, quotes invoice conversion, customer dedup/import, leave emergency-contact replace, cashing-up child-row replace, expenses delete (orphaned receipt files).

**Affected sections:** mileage, roles-users-rbac, recruitment, receipts, menu-management, quotes, customers, leave, cashing-up, expenses.
**Fix:** move each into a single `SECURITY DEFINER` RPC/transaction (the codebase already does this well for invoices, private-booking payments, employee creation — follow that pattern).

### 5. Missing optimistic-concurrency guards on state transitions (severity: medium)

Read-status-then-update without `.eq('status', expectedStatus)` (or `FOR UPDATE`) allows concurrent actions to clobber each other.

- BOH table-booking status update, FOH no-show/cancel routes, `reviewLeaveRequest`, `markEmployeeCouldntWork` (no unique constraint), `clockIn` (no unique partial index on open sessions), credit-note number generation.

**Affected sections:** table-bookings-admin, leave, rota, invoices, timeclock-kiosk.
**Fix:** add status-scoped WHERE clauses / partial unique indexes, check affected-row counts, or wrap in locking RPCs.

### 6. PayPal/payment correctness gaps (severity: high → medium)

Money paths are mostly excellent, but specific gaps recur:

- **Read-scope authorises payment capture:** external event-bookings and table-bookings capture-order routes run capture/confirm behind `read:events` (or default read scope). **Real high-severity authorization violation.**
- **Captured-amount not verified vs expected:** parking PayPal capture webhook (the one capture path with no amount check) — verifier rated low because the order amount is server-set, but it is the lone inconsistency.
- **Currency blindness:** capture/refund helpers named `*Gbp` never assert `currency_code`; `refundPayPalPayment` hardcodes GBP.
- **Refund status edge cases:** refund post-processing catch can mark non-`COMPLETED` PayPal refunds as completed; `updateRefundStatus` counts only completed refunds (pending double-spend window).

**Affected sections:** payments, events, table-bookings-admin, private-bookings, parking-admin, public-table-booking-flow, public-parking-guest-flow.

### 7. Hand-rolled UI bypassing the @/ds design system / accessibility baseline (severity: low–medium)

Several screens use raw Tailwind palette classes / hex / native inputs and modals without focus-trap or Escape handling, contrary to the design-token rule and the DoD accessibility baseline.

- ExpenseForm + expenses modal (no focus trap/Escape), DailyCashupForm (raw colours, `alert()`/`confirm()`), MarkSickModal (rota), RoleForm, onboarding step components + success page, staff-portal layout, employees birthdays page, MGD insights, messages bulk, charge-approval `/m` page, invoice-template status colours.

**Affected sections:** expenses, cashing-up, rota, roles-users-rbac, employee-onboarding, staff-portal, employees, mgd, messages-sms, auth-and-layout, invoices.

### 8. Dead / duplicate client components drifting from the live version (severity: low)

Multiple sections ship a second, unused copy of the page client that diverges from the active `_components/` version, risking edits landing in the wrong file.

- `CustomersClient.tsx` (root vs `_components`), `QuotesClient.tsx`, `ParkingClient.tsx`, `TimeclockKiosk.tsx`, `PublicBookingClient.tsx` + `BookingConfirmationClient.tsx` (mockups), `PortalClient.tsx`.

**Affected sections:** customers, quotes, parking-admin, timeclock-kiosk, public-table-booking-flow, staff-portal.
**Fix:** delete the unused copies after confirming no dynamic imports.

### 9. Swallowed errors / silent soft-fails on user-facing operations (severity: medium–low)

Failures hidden from the user: payment-link/SMS failures on booking creation returning success, partial exports returning empty silently, benchmark fetch errors returning hardcoded fallbacks, secondary dashboard/rota loads degrading to blank UI with no warning.

**Affected sections:** parking-admin, public-table-booking-flow, profile, payroll (benchmark), rota, dashboard.

---

## Critical & High priority master list

Ordered critical first, then high. Each entry: section, file:line, why it matters, suggested fix.

### CRITICAL

**C1 — `anon` role granted blanket UPDATE on `timeclock_sessions`**
*Section: timeclock-kiosk* — `supabase/migrations/20260228000003_timeclock_anon_update_policy.sql:6-12`
The RLS policy `anon_clock_out` is `FOR UPDATE TO anon USING (clock_out_at IS NULL) WITH CHECK (true)` plus `GRANT UPDATE ... TO anon`. The anon key ships to every browser, and `WITH CHECK (true)` places no constraint on the resulting row — anyone can rewrite any open clock-in (`employee_id`, `clock_out_at`, `is_reviewed`, `work_date`) outside the kiosk UI, directly tampering with payroll source data. The kiosk's own server actions use the service-role client and do not need this grant.
**Fix:** drop the `anon_clock_out` policy and the `GRANT UPDATE ... TO anon`. If anon write is ever required, scope `WITH CHECK` to forbid changing `employee_id`/`work_date`/`is_reviewed` and only permit setting `clock_out_at`. Verify the policy is present in the live DB.

### HIGH

**H1 — `/m` manager charge-approval route missing from middleware allowlist (functional break)**
*Section: auth-and-layout* — `src/middleware.ts:7-27, 150`
`PUBLIC_PATH_PREFIXES` includes `/g` and `/r` but not `/m`. The token-authenticated, logged-out manager charge-approval pages under `src/app/m/[token]/charge-request/` are redirected to `/auth/login`, breaking the entire approve/waive flow. Root cause: CLAUDE.md and the orphaned `middleware.ts.disabled` claim middleware is disabled, but git shows it was re-enabled.
**Fix:** add `'/m'` to `PUBLIC_PATH_PREFIXES`; update CLAUDE.md to state middleware is live; delete `middleware.ts.disabled`.

**H2 — Daily-summary leaks private-booking customer PII with no RBAC**
*Section: dashboard* — `src/app/actions/daily-summary.ts:11-35`
Only checks `auth.getUser()`, then uses the service-role client to return private-booking customer names, guest counts and table-booking covers to any authenticated user (including staff with no events/bookings access).
**Fix:** gate behind `checkUserPermission` for the relevant modules before building the summary.

**H3 — Employees CSV export vulnerable to formula injection** *(severity corrected to medium by verifier — listed here for visibility; see per-section)*
*Section: employees* — `src/services/employees.ts:1230-1252`
Employee-controlled free-text starting with `= + - @` is written verbatim; opening the export in a spreadsheet executes it. Multi-step (needs a privileged exporter to open the file), hence medium.
**Fix:** prefix `'` to any cell beginning with `= + - @` (tab/CR) before quoting.

**H4 — Customer-facing event date timezone bug in private-booking refund threshold**
*Section: private-bookings* — `src/services/private-bookings/financial.ts:121-127`
`daysUntilEvent()` uses raw `new Date()` + `setHours` in server-local time. On Vercel (UTC) during BST, the 30-day cancellation threshold can flip a customer between a 95% deposit refund and total forfeiture.
**Fix:** compute both "today" and the event day in Europe/London and diff calendar dates.

**H5 — "Mark as Paid" invoice button always fails** *(corrected to medium)*
*Section: invoices* — `src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx:521-531`
`updateInvoiceStatus` explicitly rejects `paid`/`partially_paid`; the prominent button can never succeed. Loud failure with a working alternative, hence medium.
**Fix:** remove the button or route it to the Record Payment flow.

**H6 — Invoice totals/VAT diverge between screen, stored value and PDF**
*Section: invoices* — `src/lib/invoiceCalculations.ts:62-75` + `InvoiceDetailClient.tsx:257-292,711-763`
Per-line VAT is summed unrounded then stored to `numeric(10,2)`; the PDF divides by the rounded subtotal while the screen divides by the unrounded one, producing ~1p divergence and two different totals on one screen.
**Fix:** round per-line VAT to 2dp before summing; display the persisted values as the single source of truth.

**H7 — Recurring-invoice cron orphans unsent draft invoices on email failure**
*Section: invoices* — `src/app/api/cron/recurring-invoices/route.ts:186-202,350-405`
Schedule is advanced (`next_invoice_date`, `last_invoice_id`) before the draft→sent flip; on email failure the run is marked successful and the idempotency claim sealed, leaving a permanently-draft invoice that no cron will ever resend.
**Fix:** transition to `sent` before/independent of email delivery (as the auto-send cron does), or re-queue on failure instead of sealing the claim.

**H8 — `getQuoteSummary` / quote detail crash or show £NaN on null totals** *(corrected to low)*
*Section: quotes* — `src/app/actions/quotes.ts:89-94`, `[id]/page.tsx:190,529,564`
`quotes.total_amount` is nullable in the DB but typed non-null; a NULL poisons the summary buckets (£NaN) or throws on `.toFixed()`. Latent — column default is 0, so not currently reproducible, hence low.
**Fix:** coalesce with `?? 0` at all accumulation/format points and align the TS type with the nullable column.

**H9 — `completeReceiptUpload` trusts a client-supplied storage path** *(corrected to medium)*
*Section: receipts* — `src/services/receipts/receiptMutations.ts:1221-1273`
Only validates a regex and year-prefix, not that the path matches a token the server issued for this user/transaction. A privileged user can replay a path to attach an unrelated receipt to a different transaction and mark it completed.
**Fix:** persist the issued storage path and verify the supplied path matches it.

**H10 — Expense VAT can exceed the gross amount** *(corrected to medium)*
*Section: expenses* — `src/app/actions/expenses.ts:91-99,275-292`
`vat_amount` validated independently of `amount`; a typo (e.g. £999 VAT on £10) silently inflates the accountant's quarterly VAT-reclaim figure. Human-reviewed downstream, hence medium.
**Fix:** add a Zod cross-field refinement rejecting `vat_amount > amount` (ideally `> amount/6`) at client, server schema and DB constraint.

**H11 — Expenses "Spend by category" sidebar shows fabricated £0 budgets** *(corrected to medium)*
*Section: expenses* — `src/app/(authenticated)/expenses/_components/ExpensesClient.tsx:54-62,263-270,398-413`
Spend is keyed on `company_ref` but rendered against a hardcoded category list that never intersects, so every budget reads £0. No `category` column exists. Misleading non-functional UI.
**Fix:** add a real category field or remove the sidebar.

**H12 — Mileage trip create/update is non-atomic, orphaning legless trips that skew HMRC tax-year totals**
*Section: mileage* — `src/app/actions/mileage.ts:882-912,999-1033`
Trip row is inserted/updated, then legs separately; a legs failure leaves a trip with placeholder rates and no legs that still counts toward the cumulative 10,000-mile rate split of every other trip in the tax year. `updateTrip` deletes legs before inserting replacements.
**Fix:** wrap trip + legs in a single transactional RPC; for update, insert before delete.

**H13 — Parking refund loads booking via non-existent columns, breaking refunds and customer notifications**
*Section: parking-admin* — `src/app/actions/refundActions.ts:96-114` (and `289-301`)
The embed selects `parking_bookings(guest_name, email, phone)` which do not exist (columns are `customer_first_name/last_name/mobile/email`). The query errors → `loadSourceBooking` returns null → the entire parking refund path aborts ("Booking not found"), and refund notification status is corrupted.
**Fix:** correct the embed to the real column names and map name/email/phone accordingly.

**H14 — `updateParkingBookingStatus` writes audit log with no actor** *(corrected to medium)*
*Section: parking-admin* — `src/app/actions/parking.ts:322-433`
Unlike sibling actions, it never calls `auth.getUser()` and logs cancel/refund transitions with `user_id` null (the audit helper has no session fallback), losing accountability on financially-material `paid→refunded` changes.
**Fix:** fetch the user, return Unauthorized if absent, pass `user_id` to `logAuditEvent`.

**H15 — Rota settings mutation (manager/accountant PII emails) has no audit log** *(corrected to medium)*
*Section: rota* — `src/app/actions/rota-settings.ts:60-99`
Upserts manager/accountant emails and the wage-target percentage via the admin client with a permission check but no `logAuditEvent`.
**Fix:** add audit logging capturing the authenticated user and changed keys.

**H16 — Rota shift-acceptance cron records phantom auto-accepts** *(corrected to medium)*
*Section: rota* — `src/app/api/cron/rota-shift-acceptance/route.ts:209-256`
The update lacks `.select()`, so a zero-row match (shift already actioned via portal in the race window) still writes an `auto_accept` audit row and a reliability event, polluting the ledger.
**Fix:** add `.select('id')` and only proceed when a row actually transitioned.

**H17 — AI menu parsing/review actions have no auth/RBAC (billable OpenAI abuse)**
*Section: menu-management* — `src/app/actions/ai-menu-parsing.ts:87,261`
`parseIngredientWithAI` and `reviewIngredientWithAI` have zero auth/permission checks; `reviewIngredientWithAI` is called directly from the client. An authenticated-but-unauthorised user can drive unbounded billable OpenAI spend (one path bypasses the route's guard entirely).
**Fix:** add `checkUserPermission('menu_management','manage')` at the top of both actions.

**H18 — Dish GP analysis silently drops un-priced ingredients, inflating GP%**
*Section: menu-management* — `DishCompositionTab.tsx:62`, `DishGpAnalysisTab.tsx:125`
`if (!unitCost) continue` excludes un-priced components from portion cost; the service's `cost_data_complete` flag is computed but consumed nowhere (dead). A dish with an un-priced ingredient shows an artificially high GP% and can be flagged "OK" when actually below target — wrong pricing decisions.
**Fix:** surface the cost-incomplete state and warn that GP figures are unreliable until all components are priced.

**H19 — Bulk SMS reports requested count as "sent"** — **DROPPED (verifier `isReal: false`)**. The recipient list is already eligibility-filtered at fetch time, so `result.sent` normally equals the requested count. Not a real compliance/data-integrity bug.

**H20 — Table-booking deposit-timeout cron prematurely cancels valid bookings**
*Section: table-bookings-admin / cron-jobs* — `src/app/api/cron/table-booking-deposit-timeout/route.ts:22-58`
Cancels any `pending_payment` booking within 24h of the event without checking `hold_expires_at` or an approved-but-uncaptured PayPal order. A booking created 20h before its event (with a valid ~20h hold) is cancelled on the next hourly run, sending the customer a cancellation SMS while their payment window is still open. Conflicts with the correct `event-booking-holds` cron.
**Fix:** add `.lte('hold_expires_at', now)` / `.not('hold_expires_at','is',null)`; reconcile the 24h rule so it cannot fire before the hold expires.

**H21 — BOH table-booking delete/cancel route has no audit logging**
*Section: table-bookings-admin* — `src/app/api/boh/table-bookings/[id]/route.ts:38-66,103-119`
Hard-deletes (and cascade-removes payment/charge rows) and soft-cancels with zero audit trail; the sibling status route audits correctly. Most destructive operation in the section, no record of who/when.
**Fix:** add `logAuditEvent` to both branches using `auth.userId`.

**H22 — `getClientBalance` caps invoices at 50, understating client outstanding balance**
*Section: oj-projects* — `src/app/actions/oj-projects/client-balance.ts:43-63`
Sums unpaid balance over only the latest 50 invoices (paid/void filtered in JS *after* the cap), so a high-volume client's outstanding balance is silently understated; credit notes are summed across all of them, compounding the mismatch. The cron uses the correct `.limit(10000)` + status filter.
**Fix:** compute the balance from a dedicated unbounded unsettled-invoice query; keep `.limit(50)` only for the displayed list.

**H23 — `getHolidayUsage` has no auth/ownership check (IDOR on holiday data)** *(merged: appears in both `leave` and `staff-portal`)*
*Sections: leave, staff-portal* — `src/app/actions/leave.ts:472-529`
No `auth.getUser()`, no `checkUserPermission`, no `isOwnEmployeeRecord`. **RLS on `employee_pay_settings`/`leave_requests`/`leave_days` confirmed permissive (`USING true`)**, so any authenticated user can enumerate any employee's holiday allowance and leave consumption by employee UUID. Sibling `getLeaveRequests` gates correctly.
**Fix:** add `checkUserPermission('leave','view')` with an `isOwnEmployeeRecord` self-service fallback.

**H24 — Leave holiday usage counts weekends/non-working days against a working-day allowance**
*Section: leave* — `src/app/actions/leave.ts:151-156,398-403,526-528`
`eachDayOfInterval` expands every calendar day into `leave_days` and counts raw rows against `holiday_allowance_days` (DB default 25 = working days). A Mon–Fri request spanning a weekend over-consumes the allowance; over-allowance flags trip falsely. Confirmed in three display surfaces.
**Fix:** exclude weekends (and ideally per-employee non-working days) when counting against the allowance.

**H25 — No PIN/identity verification on the public timeclock kiosk** *(corrected to medium)*
*Section: timeclock-kiosk* — `TimeclockClient.tsx:54-80`
Anyone can tap any named staff card to clock that person in/out with no credential; the route is public and exposes the full active-staff roster by name. Falsified hours feed payroll. Intentional shared-iPad design with manager review, hence medium.
**Fix:** require a per-employee PIN or device-bound token verified server-side in `clockIn`/`clockOut`.

**H26 — Avatar upload has no file-type or size validation (stored XSS to a public bucket)**
*Section: profile* — `src/app/actions/profile.ts:217-231`
Accepts any file (only an empty-check) and uploads to a public bucket; SVG/HTML with script becomes stored XSS served from a public origin, plus unbounded size. Client `accept="image/*"` is bypassable on the action.
**Fix:** validate `file.type` against an image allowlist, enforce a max size, derive the extension from the validated MIME type.

**H27 — `profile` GDPR export queries messages by the wrong identifier space** *(corrected to medium)*
*Section: profile* — `src/app/actions/profile.ts:162-166`
Filters `messages.customer_id` (FK to `customers`) by the auth user UUID, which never matches; the "Export My Data" output always reports zero messages, and the query error is swallowed. Mis-designed rather than high-impact.
**Fix:** resolve the linked customer first or drop the messages section; check the query error.

**H28 — Payroll period actions have no auth/RBAC and use the admin client** *(corrected to medium)*
*Section: payroll* — `src/app/actions/payroll.ts:55-115`
`getOrCreatePayrollPeriod` / `...ForDate` / `ensurePayrollPeriodsAhead` write `payroll_periods` via the service-role client with no permission check (one is called from the staff portal). Authenticated users can pollute the table; bounded, low-sensitivity data, hence medium.
**Fix:** gate each with `checkUserPermission` or split the internal helper from the exported wrapper.

**H29 — Payroll pay-band / rate-override / budget read actions expose compensation data with no permission check**
*Section: payroll* — `src/app/actions/pay-bands.ts:41-104,201-213`; `budgets.ts`
Read actions for hourly rates, rate overrides and budgets have no RBAC. **RLS on these tables confirmed permissive (`USING true` / `auth.uid() IS NOT NULL`)**, so any authenticated staff member (including low-privilege roles) can read every employee's pay data.
**Fix:** add `checkUserPermission('payroll'/'employees','view')` to the read actions.

**H30 — Recruitment: candidate cannot rebook after cancelling (public dead-end)**
*Section: recruitment* — `src/services/recruitment.ts:2079-2126,2015-2022`; `RecruitmentBookingClient.tsx:121-161`
Self-service cancel never clears `booking_token_used_at` and `previewRecruitmentBookingToken` returns the cancelled appointment as `currentAppointment`, so the Book button (gated on `!currentAppointment`) disappears and the candidate is locked out with only dead Cancel/Reschedule buttons.
**Fix:** clear `booking_token_used_at` on cancel and exclude cancelled appointments from `currentAppointment`.

**H31 — Recruitment: orphaned Outlook calendar event when Graph delete fails on cancel**
*Section: recruitment* — `src/lib/recruitment/calendar.ts:208-256`
On a Graph DELETE failure the appointment keeps its `calendar_event_id` and is set to `cancelled`; the retry sweep only selects `status='scheduled'` future appointments and only patches/creates, so the live event is never removed and the candidate's invite is never withdrawn, with no staff signal.
**Fix:** add a deletion-retry sweep for cancelled appointments still holding `calendar_event_id`.

**H32 — RBAC: role permission / role-deletion changes don't invalidate affected users' cached permissions**
*Section: roles-users-rbac* — `src/services/permission.ts:267-339,233-265,85-98`
Permission checks are served from a 60s `unstable_cache` keyed per user; only `assignRolesToUser` busts the tag. Removing a permission from a role (or deleting a role) leaves every holder with the revoked permission on server-side gates for up to 60s — fail-open on the security-critical revocation direction.
**Fix:** on role-permission change / role delete, look up all `user_roles` for the role and `revalidateTag` each user.

**H33 — RBAC privilege escalation: a `roles:manage` holder can grant any permission to a custom role and self-elevate**
*Section: roles-users-rbac* — `src/app/actions/rbac.ts:308-374`
`assignPermissionsToRole` accepts arbitrary `permissionIds` with no check that the actor holds them; combined with `users:manage_roles` a user can mint a super-admin-equivalent custom role and assign it to themselves. Admin-tier prerequisites, but a genuine privilege-boundary breach.
**Fix:** restrict assignable permissions to the actor's own set, and/or gate `users:manage_roles`+`roles:manage` behind super_admin.

**H34 — RBAC non-atomic delete-then-insert can wipe all role/user permissions** *(corrected to medium)*
*Section: roles-users-rbac* — `src/services/permission.ts:301-338,359-401`
`assignPermissionsToRole` / `assignRolesToUser` delete all rows then insert; a double failure (insert + best-effort rollback) leaves the role/user with zero permissions, logged only to console.
**Fix:** perform the replace in a single atomic RPC or diff-and-apply only changed rows.

**H35 — PayPal capture/create-order routes run money-moving operations behind a read-only API scope**
*Section: payments, public-table-booking-flow* — external event/table-bookings `capture-order` + `create-order` routes
Capture (real money) and booking confirmation run behind `['read:events']` (or the read default). Any API key with a read scope can drive payment capture and mutate booking/payment state. Least-privilege violation on a financial endpoint.
**Fix:** require a write/payment scope (e.g. `write:bookings` / `payments:capture`) on both routes; audit which keys hold it.

**H36 — Refund amount has no positive-value validation** — **DROPPED (verifier `isReal: false`)**. The `payment_refunds.amount NUMERIC(10,2) CHECK (amount > 0)` constraint blocks zero/negative refunds before any side effect; only a cosmetic raw-error-message gap remains (low).

**H37 — Parking PayPal capture webhook doesn't verify captured amount** *(corrected to low)*
*Section: payments / public-parking-guest-flow* — `src/app/api/webhooks/paypal/parking/route.ts:301-340`
Marks paid/confirmed using PayPal's reported amount with no comparison to the booking price. Order amount is server-set and immutable, so not exploitable; it is the lone capture path missing the consistency check.
**Fix (hardening):** compare captured amount to `override_price ?? calculated_price` and route mismatches to manual review.

**H38 — Resend status webhook has no idempotency guard** *(corrected to medium)*
*Section: webhooks* — `src/app/api/webhooks/resend/route.ts:400-505`
Unlike the PayPal routes, retried/duplicated delivery events re-increment `email_delivery_failures` and re-insert opt-out consent rows. Append-only audit noise + counter inflation, not a wrong consent outcome.
**Fix:** gate the health/consent mutations behind an idempotency claim keyed on the svix event id.

---

## Per-section breakdown

For each section: the remaining findings after triage, ordered by severity. Severities reflect verifier corrections. Items already in the master list are summarised; full detail lives above.

### dashboard
- **High:** Daily-summary PII leak (H2).
- **Medium:** Parking query compares `timestamptz` to bare date strings (`dashboard-data.ts:1133`); no dashboard error boundary (blank page on snapshot throw).
- **Low:** ProgressBar divides by capacity that can be 0; raw `Date`/`toLocaleDateString` for chart/birthday labels; `lastYearSameWeek` % off a partial last-year window; `vsLastWeek` compares unequal-length windows; `private_bookings.total_amount` used as revenue without payment netting; Feb-29 birthday forced to Feb 28; snapshot cache keyed on userId only (stale after RBAC change); refresh action no-op with no feedback.

### customers
- **Medium:** Pagination uses `count: 'estimated'` (wrong totals on search/filter); `getBulkCustomerLabels` no auth check; SMS Active/Deactivated stat cards count only the current page; customer dedup runs through the RLS-scoped client against a global unique index.
- **Low:** `getCustomerList` relies on RLS only (standards deviation — verifier downgraded); dead duplicate `CustomersClient.tsx`; win-back cutoff uses raw `Date`/`toISOString`; consent-audit CSV export `any`-typed; delete-customer cascade scope unverified/unlogged; bulk SMS/Email buttons non-functional; select-all is page-scoped with no indication; service-contact consent permission asymmetric between create and update.

### employees
- **High/Medium:** CSV formula injection (H3, medium); phone numbers not normalised to E.164 on employee + emergency-contact create paths.
- **Dropped:** `restoreEmployeeVersion` missing RBAC — verifier `isReal: false` (the SQL function enforces `employees:manage`).
- **Medium:** CSV dates via raw `toLocaleDateString`; birthdays page hardcoded Tailwind colours.
- **Low:** birthdays page raw `Date`; employee-history default ranges raw `toISOString`; `createEmployeeAccount` no rate limiting; `addEmployeeNote` failure branch unaudited; health-record checkbox parsing diverges (`'on'` only); reliability leaderboard sort headers not keyboard/colour accessible; reliability window filtering compares ISO strings lexically.

### events
- **Dropped:** manual cash/card applies online discount — verifier `isReal: false` (discount is scoped to `payment_mode`, intentional).
- **Medium:** unhandled `JSON.parse` on FormData fields; event-date validation against server-local midnight; staff cancellation refund derived from current price not amount paid; cancellation cascade only refunds PayPal payments.
- **Low:** `transferEventBooking` dead UUID-vs-UUID guard; checklist progress can exceed total on stale keys; `getEventBookings` returns customer PII behind only `events:view` via admin client.

### private-bookings
- **High:** cancellation 30-day refund threshold in UTC not London (H4).
- **Medium:** customer-facing SMS/email event dates without Europe/London; open-dispute detection via free-text regex over notes.
- **Low:** cancellation-preview date without London tz; dead/legacy `recordFinalPayment` path diverging from the atomic RPC; deleting a PayPal-captured deposit clears paid state without surfacing that no refund is issued.

### invoices
- **High/Medium:** "Mark as Paid" dead-end (H5, medium); on-screen vs stored vs PDF total divergence (H6); per-line VAT never rounded; recurring-invoice cron orphans unsent drafts (H7); `voidInvoice` wrongly requires `oj_projects:manage` for all invoices; credit-note numbering non-atomic (collision risk).
- **Low:** detail dates via raw `Date`/`toLocaleDateString`; hardcoded hex in the invoice template/status colours; new-invoice form doesn't validate `due_date >= invoice_date`; receipt email bodies persisted to `invoice_email_logs` (PII) with weak email validation.

### quotes
- **High→Low:** nullable `total_amount` → £NaN/crash (H8, low, latent).
- **Medium:** `total_amount.toFixed()` can throw on null; expiry/`valid_until` comparisons via raw `Date`; `convertQuoteToInvoice` copies stored totals without recomputation.
- **Low:** quote dates via `toLocaleDateString`; conversion insert (user client) vs rollback (admin client) asymmetry / non-atomic; dead duplicate `QuotesClient.tsx`; convert page double-redirect race; convert action lacks a confirmation step.

### receipts
- **High→Medium:** `completeReceiptUpload` trusts client storage path (H9).
- **Medium:** `requeueUnclassifiedTransactions` no audit log/revalidate; receipt file delete has no confirmation dialog.
- **Low:** icon-only delete button no aria-label / colour-only; `markReceiptTransaction` passes status via `as any`; malformed `?page=` → NaN offset; delete rollback re-insert drops `content_hash`/`hash_verified_at`; bulk group classification non-atomic (acknowledged DEF-007).

### expenses
- **High→Medium:** VAT can exceed gross (H10); fabricated category sidebar (H11).
- **Medium:** all queries use the admin client (RLS bypass, defence-in-depth gap); `deleteExpense` non-atomic (orphans receipt files); ExpenseForm hardcoded colours; modal no focus-trap/Escape.
- **Low:** `uploadExpenseFile` file-count check racy; insights quarter math raw `Date`; duplicate file-validation limits client/server; populated-table filter loading has no indicator.

### mileage
- **Dropped:** distance cache symmetry — verifier `isReal: false` (intentional one-way cache; prefill only, editable; amount_due not derived from cache).
- **High:** trip create/update non-atomic (H12).
- **Medium:** live rate-split preview wrong for back-dated trips; backfill migration hardcodes 0.45 for post-2026-04-01 trips.
- **Low:** "Rate" column sorts by standard-rate miles not rate; no future-date rejection; `recalculateTaxYearMileage` parallel per-row updates can partially apply.

### mgd
- **Medium:** annual/all-time insights drill-down builds a Jan1–Dec31 range matching no MGD period; HMRC form hardcodes 1 machine + forces 20% rate despite advertising a 5% Cat D rate.
- **Low:** hardcoded hex/Tailwind colours; empty-period UX discoverability; reopen audit log omits cleared `date_paid`/`submitted_by`; RLS super_admin-only vs RBAC manager grant (admin-client only).

### parking-admin
- **High/Medium:** refund column mismatch breaks refunds + notifications (H13); `updateParkingBookingStatus` no actor in audit (H14, medium); cancel action no confirmation; payment-link/SMS failure on creation swallowed.
- **Low:** paid-session reminders skip `completed` bookings; dead duplicate `ParkingClient.tsx`; search `.or()` interpolation relies on a denylist escape.

### rota
- **High→Medium:** `updateRotaSettings` PII no audit (H15); shift-acceptance cron phantom auto-accepts (H16).
- **Medium:** `markEmployeeCouldntWork` check-then-insert (no unique constraint); page degrades to empty UI on secondary load failures; `rejectPortalShift` doesn't check the mirrored live update; MarkSickModal hand-rolled (no focus-trap/Escape/tokens).
- **Low:** `getRotaWeekDayInfo` day keys via local `Date` + `toISOString`; manager email hardcoded instead of the configurable setting.

### menu-management
- **High:** AI parsing/review actions unguarded (H17); GP analysis drops un-priced ingredients (H18).
- **Medium:** `verifyDishAllergens` doesn't abort on null user (food-safety attestation); allergen choice-group resolved by display name not id; recipe price-history write failure leaves committed `pack_cost` with no history; `reviewIngredientWithAI` returns unvalidated `JSON.parse`.
- **Low:** `getMenuTargetGp` exported with no permission check; "Remove placement" button defaults to `type=submit`.

### messages-sms
- **Dropped:** bulk "sent" count inflation — verifier `isReal: false` (list pre-filtered).
- **Medium:** bulk preview renders `'null'` for null last_name.
- **Low:** reconcile cron counts successful 20404 handling as an error; quiet-hours warning computed once at mount (stale); thread date grouping via raw `Date`/`toLocaleDateString`; mark-read/unread (a write) gated only on `messages:view`; hardcoded `text-yellow-600`.

### table-bookings-admin
- **High:** deposit-timeout premature cancellation (H20); BOH delete/cancel no audit (H21).
- **Dropped:** party-size deposit transition stale snapshot — verifier `isReal: false` (the intervening update only writes party_size fields; pre-update party size is the correct input).
- **Medium:** BOH status update no race guard; refund tier day-count in server-local time; `move-table` no audit log; deposit-timeout cron assumes no captured deposit (no refund before auto-cancel).
- **Low:** `BookingDetailClient` formats booking date in UTC.

### cashing-up
- **High:** `getMissingCashupDatesAction` no RBAC (corrected to low by verifier — RLS backstops; the operational fact is protected); import is insert-only and reports re-imports as failures.
- **Medium:** import zeroes card/stripe variance structurally; cash-count vs cash-total never reconciled; `upsertAndSubmitSession` double/contradictory audit + non-atomic; audit events omit `user_id`/`resource_id`; child-row replace non-atomic; Submit re-runs on non-draft sessions.
- **Low:** native `alert()`/`confirm()`; raw Tailwind colours; no double-submit guard beyond `isPending`; insights/dashboard windows raw `Date`; site matching breaks on duplicate names / default-site fallback; no Zod on import rows.

### oj-projects
- **High:** `getClientBalance` capped at 50 understates balance (H22).
- **Medium:** vendor billing settings mutation no audit/revalidate; statement email (financial PII) only requires `view`.
- **Low:** statement default range via `toISOString` (UTC); `billing_pending` edit returns a misleading "not linked to an invoice" error; statement opening balance floors each invoice at 0 (drops client credit).

### short-links
- **High→Medium:** open redirect — no destination host allowlist (H, medium); `createShortLinkInternal` unauthenticated server action (medium, dead export).
- **Medium:** `createShortLink` dedup RLS-scoped vs admin insert; user-created links never set `created_by` (hidden from default list); total/pagination count includes variants while rows don't.
- **Low:** template-literal bug renders literal `${...}`; redirect injects `short_code` into third-party URLs; click tracking best-effort in `waitUntil`; dates/analytics windows raw `Date`/`toISOString`; table missing loading state + empty cell `colSpan`; analytics getters use `.single()` (throws on missing/dup); dedup returns `already_exists` across owner/system boundary.

### recruitment
- **High:** cancel-then-cannot-rebook lockout (H30); orphaned calendar event on Graph delete failure (H31).
- **Medium:** public booking cancel/reschedule/claim routes no rate limit/Turnstile; GDPR erasure no audit log; retention cleanup embedded-filter ineffective (re-anonymises every run); booking dates via raw `Intl`/`Date` (no London tz); slot claim non-atomic (token-used in a separate unchecked write); reschedule slot booking/release non-atomic.
- **Low:** `userHasRole` `any`-typed sole gate for GDPR erasure; public POST errors echoed raw; reschedule status event bypasses the validated transition RPC; calendar sync has no max-attempt cap; booking page missing aria-live/fieldset; dashboard payload pervasively `any`-typed.

### settings
- **Dropped:** `updateSiteSettings`/`updateSiteToggle` critical authz bypass — verifier `isReal: false` (RLS on `sites` has no UPDATE policy, so the write is denied for everyone; downgraded to low — missing RBAC check is a consistency/defence-in-depth gap, and likely a functional no-op bug for legitimate managers).
- **High→Medium:** site settings update no input validation (deposit/group-size/email/currency unchecked).
- **Medium:** GDPR settings page no page-level permission gate; Event Categories page no page-level gate; SpecialHoursModal formats exception date in local time.
- **Low:** `runCronJob` self-fetches with CRON_SECRET via resolved base URL; Users/Roles tabs always rendered regardless of permission; Event Categories table inline style/raw colours.

### roles-users-rbac
- **High→Medium:** stale permission cache on revocation (H32); privilege escalation via custom roles (H33); non-atomic permission replace (H34, medium).
- **Medium:** Users table dates via `date-fns` local time; role filter dropdown non-functional; Role column always shows hardcoded "User" badge.
- **Low:** RoleForm hardcoded colours; RolePermissionsModal swallows load failures (Save can clear permissions); `getAllUsers` exposes all emails behind `users:view`; assignment audit logs omit role/permission names.

### profile
- **High→Medium:** export queries wrong identifier space (H27); avatar upload no validation (H26, high stays).
- **Dropped:** avatar double-prefix URL — verifier `isReal: false` (upload key and render URL derive from the same path; resolves correctly).
- **Medium:** avatar bucket/read policy not in migrations (IaC gap, likely created via dashboard); account-deletion request only writes an audit log (no notification/workflow); change-password enforces only 6 chars (vs 8 elsewhere); profile dates via raw `Date`/`toLocaleDateString`.
- **Low:** server actions use `toISOString` for export filename/date; `fullName` no Zod/trim/length bound; swallowed errors in export/avatar paths; Change-Photo label+button double-trigger; avatar `<img>` empty-base fallback; client-only password change with no re-auth.

### payroll
- **High→Medium:** period actions no auth/admin client (H28); pay-band/rate/budget reads no RBAC (H29, high stays — RLS permissive).
- **Medium:** variance flag never fires for no-show shifts; RotaPayroll action buttons are dead no-ops; `sendPayrollEmail` proceeds without verifying the user; `deletePayrollRow` no audit log.
- **Low:** per-employee summary re-rounds rounded row totals; approval snapshot stores compensation PII (confirm RLS/retention); month label via raw `toLocaleDateString`; period boundaries via `toISOString`; `fetchGreeneKingBenchmark` swallows errors + `any`; P&L window starts server-local; £833 threshold magic number; approval lookup `.single()` (should be `.maybeSingle()`).

### leave
- **High:** `getHolidayUsage` IDOR (H23); weekend/non-working days counted against allowance (H24).
- **Dropped:** `leave_days` unique + `ignoreDuplicates` cross-request corruption — verifier `isReal: false` (overlap guard blocks partial overlaps; one owner per date; only a narrow TOCTOU edge remains).
- **Medium:** progress bar divides by allowance with no zero guard; portal holiday-year via server-local `Date`; `reviewLeaveRequest` non-atomic status check.
- **Low:** manager approve/decline leaves usage bar stale; declining doesn't restore days won from overlapping requests; leave UI bypasses dateUtils/@/ds; overlap check + insert not transactional.

### public-table-booking-flow
- **High:** PayPal capture/create-order routes behind read scope (H35).
- **Medium:** `PublicBookingClient.tsx` non-functional mockup in the tree (dead, violates date/phone/validation rules).
- **Low:** `?state=paid` renders a spoofable "deposit received" page; end-of-day hold fallback uses server-local tz; `BookingConfirmationClient` dead mockup with placeholder QR; SMS-failure on creation swallowed (payment link unreachable).

### public-parking-guest-flow
- **Dropped:** captured amount never verified (high) — verifier `isReal: false` (amount server-set and immutable; booking price immutable post-creation).
- **Medium:** PayPal `cancelUrl` points to a non-existent route (404 on cancel).
- **Low:** return route can redirect to `/parking/guest/` with no id; guest page ignores `missing_parameters`/`not_found`/`cancelled` states; no not-found/error boundary; hardcoded fallback phone/colours; trailing-space name when last name missing.

### timeclock-kiosk
- **Critical:** anon UPDATE grant (C1).
- **High→Medium:** no PIN/identity verification (H25).
- **Medium:** `clockOut` uses `.single()` (stuck if multiple open sessions); no unique constraint preventing two open sessions per employee.
- **Low:** `clockOut` doesn't validate employee status / off-roster employees can't clock out; orphaned `TimeclockKiosk.tsx`; clock audit events have no `user_id` and run fire-and-forget; raw `Date`/`toLocale*` time formatting; hardcoded hex/BEM colours; no per-card double-tap guard / no roster empty/error state.

### employee-onboarding
- **High:** no rate limiting on public token endpoints (corrected to low — 256-bit token makes brute force infeasible; only generic resource-consumption hardening remains); financial/health PII writes have no audit logging (H, high stays); `createEmployeeAccount` validate→createUser→link non-atomic (corrected to medium — unique-email constraint partially self-serialises; orphan needs a double failure).
- **Medium:** phone numbers stored raw (no E.164); emergency-contacts delete-then-insert non-atomic; password only 8-char minimum, no strength/breach check.
- **Low:** onboarding step components/success page hardcoded colours/native inputs; step disabled/aria polish + back-nav step-index desync.

### staff-portal
- **High:** `getHolidayUsage` IDOR (H23, merged).
- **Medium:** calendar feed token non-expiring static bearer (no per-user revocation); `isTomorrow()` mixes London-today with UTC arithmetic; shift dates/times via raw `toLocaleDateString`/`toLocaleString`.
- **Low:** leave holiday-year via raw `Date`; holiday request form date validation tz-ambiguous; note field no length cap; dead `PortalClient.tsx` with a non-functional "Sign out"; portal layout/pages bypass @/ds.

### auth-and-layout
- **High:** `/m` missing from middleware allowlist (H1); stale "middleware disabled" docs (code-quality, real live regression).
- **Medium:** FOH-only users have no server-side route gating (client-only redirect); layout fallback can let portal employees through on RPC failure.
- **Low:** charge-approval page hardcoded colours; charge-approval dates via raw `Intl`/`Date`; duplicated `PORTAL_ONLY_ROLES` logic; login rate limiting IP-only (no per-account throttle).

### payments
- **High:** capture routes behind read scope (H35).
- **Dropped:** refund no positive-value validation — verifier `isReal: false` (DB CHECK constraint).
- **Medium:** currency-blind capture/refund helpers (hardcoded GBP); portal deposit capture doesn't validate currency; PayPal refund post-processing catch marks non-COMPLETED as completed; `updateRefundStatus` counts only completed refunds (pending double-spend window — verify `calculate_refundable_balance`).
- **Low→Medium:** parking capture webhook no amount check (H37, low); webhook `configuration_error` returns 200 in non-prod (silent drop); refund SMS PII without E.164 normalisation; refund permission uses a `'refund'` action that may be undefined in RBAC; Stripe persist-failure handlers not internally idempotent on replay; reconciliation cron captures APPROVED orders without re-checking the booking is still payable.

### webhooks
- **High→Medium:** Resend webhook no idempotency (H38).
- **Medium:** Resend status update can clobber a newer status (no progression guard); parking `CAPTURE.DENIED` leaves the booking row stale.
- **Low:** top-level PayPal route no idempotency (duplicate audit rows); Resend bounce/complaint matches customers by `ILIKE` email (mutates all sharing an address); event-bookings webhook silently ACKs `blocked` states; Resend returns 401 by string-matching the error message; Twilio reply-to-book auto-reply not tied to inbound message id; Twilio signature uses `request.url` (proxy mismatch risk); PayPal verify relies solely on remote API (no local replay check); Resend missing-secret returns 500 (retry storm).

### cron-jobs
- **High:** deposit-timeout premature cancellation (H20, shared with table-bookings).
- **Medium:** `private-bookings-expire-holds` cancels with no audit log.
- **Low:** cron auth non-constant-time compare; `recurring-invoices` leaks raw DB error in 500 response; expire-holds SMS date via raw `Date`/`toLocaleDateString`.

---

## Checklist — every section reviewed

| # | Section | Status | C | H | M | L |
|---|---------|--------|---|---|---|---|
| 1 | dashboard | Reviewed | 0 | 1 | 2 | 8 |
| 2 | customers | Reviewed | 0 | 0 | 4 | 8 |
| 3 | employees | Reviewed | 0 | 0 | 4 | 7 |
| 4 | events | Reviewed | 0 | 0 | 4 | 3 |
| 5 | private-bookings | Reviewed | 0 | 1 | 2 | 3 |
| 6 | invoices | Reviewed | 0 | 1 | 5 | 4 |
| 7 | quotes | Reviewed | 0 | 0 | 3 | 6 |
| 8 | receipts | Reviewed | 0 | 1 | 2 | 5 |
| 9 | expenses | Reviewed | 0 | 0 | 6 | 4 |
| 10 | mileage | Reviewed | 0 | 1 | 2 | 3 |
| 11 | mgd | Reviewed | 0 | 0 | 2 | 4 |
| 12 | parking-admin | Reviewed | 0 | 1 | 3 | 3 |
| 13 | rota | Reviewed | 0 | 0 | 6 | 2 |
| 14 | menu-management | Reviewed | 0 | 2 | 4 | 2 |
| 15 | messages-sms | Reviewed | 0 | 0 | 1 | 5 |
| 16 | table-bookings-admin | Reviewed | 0 | 2 | 4 | 1 |
| 17 | cashing-up | Reviewed | 0 | 1 | 6 | 6 |
| 18 | oj-projects | Reviewed | 0 | 1 | 2 | 3 |
| 19 | short-links | Reviewed | 0 | 0 | 5 | 8 |
| 20 | recruitment | Reviewed | 0 | 2 | 6 | 6 |
| 21 | settings | Reviewed | 0 | 0 | 4 | 4 |
| 22 | roles-users-rbac | Reviewed | 0 | 2 | 4 | 4 |
| 23 | profile | Reviewed | 0 | 1 | 4 | 6 |
| 24 | payroll | Reviewed | 0 | 1 | 4 | 8 |
| 25 | leave | Reviewed | 0 | 2 | 3 | 4 |
| 26 | public-table-booking-flow | Reviewed | 0 | 1 | 1 | 4 |
| 27 | public-parking-guest-flow | Reviewed | 0 | 0 | 1 | 5 |
| 28 | timeclock-kiosk | Reviewed | 1 | 0 | 2 | 7 |
| 29 | employee-onboarding | Reviewed | 0 | 1 | 3 | 2 |
| 30 | staff-portal | Reviewed | 0 | 0 | 3 | 5 |
| 31 | auth-and-layout | Reviewed | 0 | 2 | 2 | 4 |
| 32 | payments | Reviewed | 0 | 1 | 4 | 6 |
| 33 | webhooks | Reviewed | 0 | 0 | 3 | 9 |
| 34 | cron-jobs | Reviewed | 1* | 1 | 1 | 3 |

\* The deposit-timeout High (H20) is shared between cron-jobs and table-bookings-admin; counted once in totals. The timeclock Critical (C1) is the only critical. Per-section counts are indicative after triage; the authoritative totals are 1 / 22 / 42 / 44.

---

## Recommended remediation order

1. **C1** — drop the anon `UPDATE` grant on `timeclock_sessions` (verify live DB).
2. **H1** — add `/m` to the middleware allowlist; fix the stale docs.
3. **H2, H23, H29** — add RBAC re-checks to the actions that genuinely leak PII / compensation data (RLS confirmed permissive).
4. **H35** — require write/payment scopes on the PayPal capture routes.
5. **H13, H20, H30, H31** — the functional breakages (parking refunds, premature booking cancellation, recruitment lockout, orphaned calendar events).
6. **H4** + the refund/threshold timezone fixes (table-booking refund tiers, payroll windows).
7. **H32, H33** — the RBAC revocation cache and privilege-escalation gaps.
8. Then work through the medium tier by cross-cutting theme (audit logging, atomicity, optimistic-concurrency, dateUtils migration) to clear many findings per change.
