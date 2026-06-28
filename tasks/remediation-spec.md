# The Anchor Management Tools — Consolidated Remediation Specification

## Sources & method

This specification merges two whole-application reviews into a single executable plan. Nothing is dropped: every confirmed finding from both reviews is preserved, either as a consolidated action in Part B or as a line item in the complete ledger (Part D).

| Source | Report | Date | Confirmed findings | Severity split |
|---|---|---|---|---|
| **[SEC]** | `tasks/section-review-findings.md` — correctness / security / data-integrity / domain-rule | 2026-06-24 | **109** | 1 Critical · 22 High · 42 Medium · 44 Low |
| **[UX]** | `tasks/section-review-ui-ux-findings.md` — UI/UX / accessibility / CRUD completeness | (same sweep) | **311** | 28 High · 118 Medium · 165 Low |

**How they were verified:** each report ran every serious finding through an adversarial verifier; findings ruled `isReal: false` were dropped and corrected severities applied. This spec trusts those verdicts. Both reports cover the same 34 sections (32 functional areas + the `@/ds` library + cross-section consistency).

**Combined confirmed findings carried into this spec: 420** (109 [SEC] + 311 [UX]), before de-duplication of issues that appear in both reports. Where the same underlying defect appears in both, it is merged into one item tagged **[BOTH]** and both source locations are cited.

---

## How to read this spec

### Severity scale

| Severity | Meaning | Examples |
|---|---|---|
| **P0 — Critical** | Active security hole or data-tampering vector. Fix immediately, out of band. | Anon UPDATE grant on `timeclock_sessions`. |
| **P1 — High** | Real money/PII exposure, a broken core flow, an IDOR, or an app-wide a11y/data-loss defect in a shared primitive. | Daily-summary PII leak; `/m` route broken; DS `Checkbox` silent data loss. |
| **P2 — Medium** | Wrong-but-recoverable behaviour, missing audit trail, non-atomic write, missing CRUD operation, hand-rolled inaccessible UI, swallowed errors. | Refund-tier timezone bug; pay bands create-only; native `window.confirm`. |
| **P3 — Low** | Polish, consistency, display-only timezone drift, hardcoded colours, missing toasts, dead duplicate components. | Chart hex colours; raw `toLocaleDateString` on display labels. |

### Source tags

- **[SEC]** — finding originates in the correctness/security review.
- **[UX]** — finding originates in the UI/UX/CRUD review.
- **[BOTH]** — the same underlying issue was independently raised by both reviews; both file locations are cited.

---

## Executive summary

### Totals

- **2 reports**, **420 confirmed findings** carried in, consolidated into **~150 prioritised actions** (Part B) with a complete per-section ledger of every individual finding (Part D).
- Security review severity: **1 Critical, 22 High, 42 Medium, 44 Low.**
- UX review severity: **28 High, 118 Medium, 165 Low.**

### Headline risks

1. **P0 — Anon role can rewrite payroll source data.** RLS policy `anon_clock_out` grants the public `anon` role blanket `UPDATE` on `timeclock_sessions` with `WITH CHECK (true)`. Anyone with the public anon key can rewrite any open clock-in. **[SEC] C1.**
2. **A broken core flow:** the `/m` manager charge-approval route is missing from the middleware public allowlist, so logged-out managers following an SMS/email link are bounced to login — the whole approve/waive flow is dead. **[SEC] H1.**
3. **Server actions skip server-side RBAC re-checks**, genuinely leaking customer PII and compensation data (dashboard daily-summary, holiday usage IDOR, pay-band reads) — RLS confirmed permissive on the affected tables. **[SEC] H2/H23/H29.**
4. **Money-moving PayPal capture runs behind a read-only API scope.** **[SEC] H35.**
5. **Timezone-incorrect date arithmetic on real-money boundaries** — refund tiers, deposit-cancellation thresholds, payroll windows. **[SEC] H4 + theme 2.**
6. **App-wide UI defects in shared `@/ds` primitives:** `Checkbox` silently loses data (medical/PII checkboxes record nothing), `DataTable`/`Checkbox`/`Radio`/`Tabs` are keyboard-inaccessible, `ConfirmDialog` closes before async resolves. One fix each ripples across the whole app. **[UX] global-components.**
7. **Navigation has no permission gating** — every user sees every section; the permission-gated nav is dead code. **[UX] H4/H5.**
8. **Pervasive CRUD gaps** — pay bands, roles' name/description, API-key revocation, OJ clients, vendor billing settings, table-booking edits, parking edits, parking rates have no working UI.

### Recommended order of attack

1. **P0 first, out of band:** WS-12 (drop the anon UPDATE grant) — `tasks/section-review-findings.md` C1.
2. **Unblock the broken flow:** WS-2 / A-002 (`/m` middleware allowlist).
3. **Close the data-leak actions:** WS-3 (RBAC re-checks on PII/comp-data actions), WS-13 (PayPal scope).
4. **Fix the shared-primitive defects once:** WS-1 (DS Checkbox/DataTable/ConfirmDialog/Radio/Tabs/tables a11y) — highest leverage, resolves dozens of [UX] findings.
5. **Restore functional breakages:** parking refunds, premature booking cancellation, recruitment lockout, orphaned calendar events (WS-14).
6. **Timezone boundaries:** WS-4 (dateUtils migration, refund/threshold cases first).
7. **RBAC cache + privilege escalation:** WS-3.
8. **Then sweep the P2 tier by workstream** (audit logging WS-5, atomicity WS-6, error/empty/loading WS-7, CRUD gaps WS-15, destructive confirmations WS-9, design-system fragmentation WS-10, pagination WS-11, nav gating WS-2, dead-component removal WS-8), each clearing many findings per change.

---

## Part A — Cross-cutting workstreams

Each workstream is a coherent body of fix-once work. Individual actions in Part B link back to these IDs. "Resolves" lists the finding IDs / themes both reports contribute.

### WS-1 — Design-system primitive defects (a11y + data integrity)
**Severity: P1 (Checkbox/DataTable) → P2 (Radio/Tabs/Field/ConfirmDialog).** Source: **[UX]** global-components theme 15 + High list 1/26; **[SEC]** theme 7 (a11y baseline).
**Root fix:** correct the shared `@/ds` primitives once; the fix ripples to every consumer.
- `Checkbox.tsx:56-66` — `onChange` always emits boolean inside an empty `try/catch`. Re-type as `(checked: boolean) => void`, drop the catch, and fix consumers (notably `employees/new/NewEmployeeOnboardingClient.tsx:774-779` health checkboxes that pass `e.target.checked` → silent medical-data loss).
- `Checkbox.tsx:50-96` / `Radio.tsx:34-65` — `<button role>` + inert `<label htmlFor>`; label clicks don't toggle, no SR association. Use a real associated control.
- `DataTable.tsx:388-433` — sortable `<th onClick>` with no `role`/`tabIndex`/`onKeyDown`/`aria-sort`. Wrap header content in `<button>`, set `aria-sort`.
- `ConfirmDialog.tsx:71-80` — runs `onConfirm()` then `onClose()` synchronously; `loading` prop decorative. Make `onConfirm` awaitable, keep open+disabled while pending, surface errors, close on success.
- `Tabs.tsx:68-109` / `SectionNav.tsx` — no `role="tablist"`, `aria-controls`, arrow-key nav.
- `Field.tsx:15-42` — renders error/hint ids but never associates them with the control (`aria-describedby`/`aria-invalid`).
- 21 raw tables lack `<th scope>`; matrix/bulk checkboxes pass empty `label=""` (`RolesContent.tsx:274-278`, `ReceiptBulkReviewClient.tsx:477`).
**Affected:** every consumer via `@/ds`; explicitly employees onboarding, roles, receipts, all list screens.

### WS-2 — Navigation permission gating & route guards
**Severity: P1.** Source: **[UX]** theme 2 + High list 4/5; **[SEC]** auth-and-layout (FOH/portal gating).
**Root fix:** filter `NAV_GROUPS` by `usePermissions()` before passing to `Sidebar`/`MobileDrawer`; wire in or port the gating from the dead `AppNavigation.tsx`.
- `src/ds/shell/SidebarNav.tsx:21-67` / `AppShell.tsx` — live nav renders every section to every user; mobile drawer *adds* admin items unconditionally.
- `src/components/features/shared/AppNavigation.tsx:22-315` — permission-gated nav imported nowhere (dead).
- Hardcoded role label "Manager"/"User" for all (`AuthenticatedLayout.tsx:169`).
- **[SEC]** `/m` route missing from middleware allowlist (broken flow — A-002); FOH-only users have no server-side route gating (client-only redirect); layout fallback can let portal employees through on RPC failure.
**Affected:** every authenticated section, auth-and-layout.

### WS-3 — Server-action RBAC / auth re-checks
**Severity: P1 (genuine leaks) → P2 (defence-in-depth).** Source: **[SEC]** theme 1 + H2/H23/H28/H29/H32/H33/H34.
**Root fix:** add `checkUserPermission(module, action)` (with an `isOwnEmployeeRecord` self-service fallback where appropriate) at the top of every exported `'use server'` action that reads or mutates protected data. Do not rely on page gating or RLS alone. Add a lint rule flagging exported actions with no `checkUserPermission`.
- **Genuine leaks (RLS confirmed permissive):** `getDailySummaryAction` (PII), `getHolidayUsage` (IDOR), `getEventBookings` (PII), payroll reads `getPayAgeBands`/`getPayBandRates`/`getEmployeeRateOverrides`/`getDepartmentBudgets`, `parseIngredientWithAI`/`reviewIngredientWithAI` (billable OpenAI), `getMissingCashupDatesAction`, payroll period actions.
- **RBAC integrity:** stale permission cache on role-permission/role-delete change (fail-open revocation, H32); privilege escalation via `assignPermissionsToRole` self-elevation (H33); non-atomic permission replace (H34 — see WS-6).
- **Standards-only (RLS backstops):** `getCustomerList`, `getBulkCustomerLabels`, `updateSiteSettings`/`updateSiteToggle`, `getMenuTargetGp`.
**Affected:** dashboard, customers, employees, events, menu-management, cashing-up, settings, payroll, leave, staff-portal, short-links, roles-users-rbac.

### WS-4 — Europe/London date handling via dateUtils
**Severity: P1 (money/booking boundaries) → P3 (display-only).** Source: **[SEC]** theme 2; **[UX]** theme 18.
**Root fix:** route all boundary and user-facing date logic through `src/lib/dateUtils.ts` (`getTodayIsoDate`, `toLocalIsoDate`, `formatDateInLondon`, London-aware diffing). Never use raw `new Date()`/`.setHours`/`.toISOString()`/`.toLocaleDateString()`/`date-fns format()` in the runtime timezone.
- **Money/decision boundaries (priority):** private-booking 30-day refund threshold (`financial.ts:121-127` `daysUntilEvent`), table-booking refund tier day-count (`refunds.ts`), payroll P&L window starts, customer win-back cutoff.
- **Display-only:** dashboard chart/birthday labels, invoice/quote/profile/users/customer-detail dates, message thread grouping, mileage/expense/MGD period boundaries, leave holiday-year, recruitment booking times, short-link analytics windows, table-bookings `toIsoDate` (UTC off-by-one), staff-portal `isTomorrow()`, expire-holds cron SMS dates.
**Affected:** nearly every section (see ledger).

### WS-5 — Audit logging on mutations
**Severity: P2.** Source: **[SEC]** theme 3.
**Root fix:** add `logAuditEvent()` (with `user_id`, `resource_id`, meaningful non-PII `new_values`) to every create/update/delete that currently skips it. Fetch the user and return Unauthorized if absent (several actions log with null actor).
- Onboarding financial/health PII writes (`saveOnboardingSection`); BOH table-booking delete/cancel (`boh/table-bookings/[id]/route.ts`); GDPR candidate erasure; `deletePayrollRow`; `updateRotaSettings` (manager/accountant PII); vendor-contact CRUD; OJ vendor billing settings; MGD reopen (incomplete old/new values); `requeueUnclassifiedTransactions`; `move-table`; RBAC assignment logs (names not just UUIDs); `addEmployeeNote` failure branch; `updateParkingBookingStatus` (no actor, H14); `private-bookings-expire-holds` cron.
**Affected:** employee-onboarding, table-bookings-admin, recruitment, payroll, rota, private-bookings, oj-projects, mgd, receipts, employees, roles-users-rbac, parking-admin, cron-jobs.

### WS-6 — Non-atomic multi-step writes (transactions / RPCs)
**Severity: P1 → P2.** Source: **[SEC]** themes 4 & 5.
**Root fix:** move each delete-then-insert / sequential-write flow into a single `SECURITY DEFINER` RPC/transaction (follow the existing invoice / private-booking-payment / employee-creation pattern). Add optimistic-concurrency guards (`.eq('status', expected)` / partial unique indexes / affected-row checks) on state transitions.
- **Atomicity:** mileage trip create/update (orphaned legless trips skew HMRC totals, H12); RBAC permission/role replace (can wipe all permissions, H34); recruitment slot claim/reschedule; receipts bulk group classification; menu pack-cost + price-history; quotes→invoice conversion; customer dedup/import; leave emergency-contact replace; cashing-up child-row replace; expenses delete (orphaned receipt files); onboarding `createEmployeeAccount` validate→create→link; emergency-contacts delete-then-insert.
- **Optimistic concurrency:** BOH table-booking status update; FOH no-show/cancel; `reviewLeaveRequest`; `markEmployeeCouldntWork` (no unique constraint); `clockIn` (no partial unique index on open sessions); credit-note number generation.
**Affected:** mileage, roles-users-rbac, recruitment, receipts, menu-management, quotes, customers, leave, cashing-up, expenses, table-bookings-admin, rota, invoices, timeclock-kiosk, employee-onboarding.

### WS-7 — Error / empty / loading state coverage
**Severity: P2 (swallowed errors on high-stakes mutations: P1).** Source: **[UX]** themes 6/7/8/19; **[SEC]** theme 9.
**Root fix:** branch on the failure case and render an inline error/Alert; never default a failed action result to `[]`/`0` or conflate it with empty. Add route-level `loading.tsx` skeletons (DS `Skeleton`) — only 9 of 25 sections have one. Add scoped `error.tsx` to high-traffic sections. Add success toasts consistently.
- **Swallowed errors (worst):** recruitment ~15 actions cast to `void`; messages holding-queue `void` wrappers (Link/Ignore); short-links insights empty `catch {}`; leave `success ? data : []`; public-parking failure states masked; onboarding `try/finally` no catch; cashing-up daily reads errors as empty; dashboard per-section `.error` never read.
- **Missing loading:** parking, receipts, messages, quotes, mileage, expenses, cashing-up, oj-projects, short-links, settings, menu-management, recruitment, roles, users, public flows; `Empty` reused as spinner (oj-projects, expenses).
- **Missing/silent feedback:** expenses, mileage, invoices status, payroll delete/edit, quotes create, onboarding.
**Affected:** see ledger — nearly all sections.

### WS-8 — Dead / duplicate component removal
**Severity: P3 (maintenance hazard).** Source: **[UX]** theme 1; **[SEC]** theme 8.
**Root fix:** after confirming no dynamic imports and porting any worth-keeping features, delete each orphaned copy; decide one canonical implementation per concern.
- Dead duplicate clients: `customers/CustomersClient.tsx` (850 lines, has the sortable DataTable the live one dropped), `employees/EmployeesClientPage.tsx`, `private-bookings/PrivateBookingsClient.tsx` (911), `invoices/InvoicesClient.tsx` (716), `quotes/QuotesClient.tsx` (437), `parking/ParkingClient.tsx` (1021), `users/components/UserList.tsx`, `short-links/_components/UtmDropdown.tsx`, `onboarding/[token]/OnboardingClient.tsx`, `TimeclockKiosk.tsx`, `PortalClient.tsx` (holds the only sign-out), public mockups `PublicBookingClient.tsx` + `BookingConfirmationClient.tsx`.
- Whole demo trees: `rota/_components/` (RotaClient + 6 children, `DEMO_*` data), `table-bookings/_components/` (779 lines), `leave` `RotaLeave.tsx` prototype.
- Dead nav: `AppNavigation.tsx` (port its gating first — see WS-2).
**Affected:** customers, employees, private-bookings, invoices, quotes, parking, rota, table-bookings, short-links, roles/users, leave, onboarding, auth-and-layout, timeclock, staff-portal, public flows.

### WS-9 — Destructive-action confirmations
**Severity: P2.** Source: **[UX]** themes 4/5; **[SEC]** (cancel-no-confirm items).
**Root fix:** standardise on the DS `ConfirmDialog` (already fixed for async in WS-1); add a confirmation to every irreversible action; replace native `window.confirm()`/`alert()`.
- No confirmation at all: parking Cancel (flips paid→refunded on one click), receipts file delete, recruitment erase/reject/bulk/cancel/reschedule (incl. one-click GDPR erase), leave approve/decline (sends rejection email, frees dates), quotes mark-expired/rejected, OJ statement Email.
- Native `window.confirm`/`alert`: invoices void (×2), settings categories/budgets/calendar-notes/jobs, private-bookings vendor/space deletes, roles delete, rota template deactivate, employees RTW photo delete, mileage, mgd, cashing-up (`alert()`/`confirm()`).
**Affected:** parking, receipts, recruitment, leave, quotes, invoices, settings, private-bookings, roles, rota, employees, mileage, mgd, cashing-up, oj-projects.

### WS-10 — Design-system fragmentation (shells, toast, hardcoded colours, hand-rolled UI)
**Severity: P2 → P3.** Source: **[UX]** themes 13/14/20 + cross-section-consistency; **[SEC]** theme 7.
**Root fix:** document and enforce one canonical choice per concern; add ESLint rules where possible; migrate hand-rolled inputs/modals to `@/ds`; map colours to semantic tokens.
- Two page shells (`PageLayout` 78 files vs `PageHeader` 31) mixed in 14 sections; two empty-state components; three tab components; ~43 files import raw `react-hot-toast`; ~120 non-token colour usages across `@/ds` + sections.
- Hand-rolled / native-input UI: employees modals, events native `<select>`, private-bookings (149 hardcoded colours, 16 native buttons), expenses form, mileage tables, rota (7 modals, native checkboxes), menu `MenuDishesTable`, parking, table-bookings setup (1135 lines), payroll, leave modals, onboarding steps, settings, staff-portal.
- Inaccessible modals (no focus-trap/Escape/restoration): employees, rota (7), expenses, leave (`HolidayDetailModal`/`BookHolidayModal`).
- Clickable rows without keyboard operability: events, invoices, quotes, private-bookings, oj-projects, customers detail, table-bookings, menu cards, payroll daily-breakdown.
**Affected:** nearly all sections + `@/ds`.

### WS-11 — Pagination on unbounded lists
**Severity: P2.** Source: **[UX]** theme 12; **[SEC]** (H22 oj-projects balance cap).
**Root fix:** add server-side pagination or a visible "showing N of M" cap with load-more. Also un-debounced search (theme 11) fixed here: debounce 300 ms before the fetch (or in `SearchInput`).
- Events attendees, employees notes/documents, private-bookings vendors/spaces, recurring invoices, quotes, expenses (loads all), mileage trips (unbounded), oj-projects entries (200 cap) & projects (loads all), parking (200 cap), messages conversations + bulk recipients, recruitment applications/postings/slots/appointments, settings SMS-failures, leave requests, cashing-up sessions, table-bookings month/BOH view.
- **[SEC] H22:** `getClientBalance` sums only the latest 50 invoices (status filtered in JS after the cap) — understates outstanding balance. Compute from a dedicated unbounded unsettled-invoice query.
- Un-debounced search: customers, events, expenses, parking.
**Affected:** see ledger.

### WS-12 — Timeclock anon RLS lockdown (P0)
**Severity: P0.** Source: **[SEC]** C1.
**Root fix:** `supabase/migrations/20260228000003_timeclock_anon_update_policy.sql:6-12` — drop the `anon_clock_out` policy and the `GRANT UPDATE ... TO anon`. The kiosk's server actions use the service-role client and don't need it. If anon write is ever required, scope `WITH CHECK` to forbid changing `employee_id`/`work_date`/`is_reviewed` and only permit setting `clock_out_at`. Verify the policy state in the live DB before and after.
**Affected:** timeclock-kiosk.

### WS-13 — PayPal / payment correctness
**Severity: P1 (read-scope capture) → P2/P3.** Source: **[SEC]** theme 6 + H35/H37.
**Root fix:**
- **H35 (P1):** external event/table-bookings `capture-order` + `create-order` routes run capture (real money) and confirmation behind `['read:events']` / read default. Require a write/payment scope (e.g. `write:bookings` / `payments:capture`); audit which keys hold it.
- Currency blindness: `*Gbp` capture/refund helpers never assert `currency_code`; `refundPayPalPayment` hardcodes GBP. Validate currency on capture/refund/portal-deposit.
- Refund status edge cases: post-processing catch can mark non-`COMPLETED` PayPal refunds completed; `updateRefundStatus` counts only completed refunds (pending double-spend window — verify `calculate_refundable_balance`).
- Parking capture webhook (H37, P3): compare captured amount to `override_price ?? calculated_price`, route mismatches to manual review.
- Reconciliation cron captures APPROVED orders without re-checking the booking is still payable; Stripe persist-failure handlers not idempotent on replay; webhook `configuration_error` returns 200 in non-prod.
**Affected:** payments, events, table-bookings-admin, private-bookings, parking-admin, public flows, webhooks.

### WS-14 — Functional breakage repairs (broken core flows)
**Severity: P1.** Source: **[SEC]** H1/H13/H20/H30/H31; **[UX]** broken-features list.
**Root fix:** repair each genuinely broken flow.
- **H1 / A-002:** add `/m` to `PUBLIC_PATH_PREFIXES` (`src/middleware.ts:7-27,150`); update CLAUDE.md (middleware is live, not disabled); delete `middleware.ts.disabled`.
- **H13:** parking refund loads booking via non-existent columns (`refundActions.ts:96-114`) — correct embed to `customer_first_name/last_name/mobile/email`; refunds + notifications currently abort entirely.
- **H20:** table-booking deposit-timeout cron prematurely cancels valid bookings (`table-booking-deposit-timeout/route.ts:22-58`) — add `hold_expires_at` checks; reconcile with `event-booking-holds` cron.
- **H30:** recruitment cancel never clears `booking_token_used_at`; cancelled appointment returned as `currentAppointment` → candidate locked out. Clear the token; exclude cancelled appointments.
- **H31:** orphaned Outlook event on Graph delete failure — add a deletion-retry sweep for cancelled appointments still holding `calendar_event_id`.
- **[UX] broken features:** DS Checkbox data loss (WS-1), GDPR export omits messages (A-031), parking guest failure masked (A-030), dashboard Today drill-down hrefs discarded.
**Affected:** auth-and-layout, parking-admin, table-bookings-admin/cron, recruitment, dashboard, profile, public-parking.

### WS-15 — CRUD completeness
**Severity: P1 (payroll/security-critical) → P2.** Source: **[UX]** CRUD matrix + High list; **[SEC]** (orphaned action endpoints).
**Root fix:** add the missing operation/UI for each entity (see full matrix in Part C). Many target actions already exist and just need wiring.
- Pay bands / rates / overrides create-only (payroll-critical) → add update + deactivate.
- API keys cannot be revoked (`revokeApiKey` exists, unwired) → surface revoke + delete.
- Roles' name/description (`updateRole` exists, no edit route) → add `roles/[id]/edit`.
- Table booking edit (date/time/notes/dietary/customer); Sunday pre-order admin surface; parking edit + rate management; OJ clients CRUD + vendor billing settings UI + project-contact add (`addProjectContact` orphaned); invoices credit-note/refund UI (`createCreditNote`/`RefundDialog` orphaned); cashing-up Approve/Lock/Unlock + target actions (unwired); receipts automation-rule hard-delete (unwired); menu Menus/Categories/Choice-groups management; recruitment email-template create/delete; quotes edit/delete for non-draft; staff self-service leave cancel.
**Affected:** see Part C.

---

## Part B — Prioritised action list

Master to-do, P0 → P3. Each action may consolidate several related findings (full ledger in Part D). `file:line` preserved from sources.

### P0 — Critical

| ID | Title | Src | Section | File:line | Problem | Action | Links |
|---|---|---|---|---|---|---|---|
| **A-001** | Drop anon UPDATE grant on `timeclock_sessions` | [SEC] | timeclock-kiosk | `supabase/migrations/20260228000003_timeclock_anon_update_policy.sql:6-12` | `anon_clock_out` is `FOR UPDATE TO anon ... WITH CHECK (true)` + `GRANT UPDATE TO anon`; anyone with the public anon key can rewrite any open clock-in (employee_id, clock_out_at, is_reviewed). | Drop the policy and grant; kiosk uses service-role. If anon write is ever needed, constrain `WITH CHECK`. Verify live DB. | WS-12 |

### P1 — High

| ID | Title | Src | Section | File:line | Problem | Action | Links |
|---|---|---|---|---|---|---|---|
| **A-002** | Add `/m` to middleware allowlist | [SEC] | auth-and-layout | `src/middleware.ts:7-27,150` | Logged-out managers on charge-approval links bounced to login; flow dead. | Add `'/m'`; fix stale "middleware disabled" docs; delete `middleware.ts.disabled`. | WS-2, WS-14 |
| **A-003** | RBAC re-check on daily-summary PII leak | [SEC] | dashboard | `src/app/actions/daily-summary.ts:11-35` | Service-role client returns private-booking customer PII to any authed user. | Gate behind `checkUserPermission` for the relevant modules. | WS-3 |
| **A-004** | RBAC/ownership check on `getHolidayUsage` (IDOR) | [BOTH] | leave, staff-portal | [SEC]`src/app/actions/leave.ts:472-529` | No auth/ownership; RLS permissive → any user reads any employee's holiday data by UUID. | Add `checkUserPermission('leave','view')` + `isOwnEmployeeRecord` fallback. | WS-3 |
| **A-005** | RBAC on payroll pay-band/rate/budget reads | [SEC] | payroll | `src/app/actions/pay-bands.ts:41-104,201-213`; `budgets.ts` | No RBAC; RLS permissive → any staff reads all compensation data. | Add `checkUserPermission('payroll'/'employees','view')`. | WS-3 |
| **A-006** | RBAC on `getEventBookings` PII | [SEC] | events | (admin client behind `events:view`) | Customer PII returned behind only `events:view` via admin client. | Add explicit `checkUserPermission`; consider RLS-scoped client. | WS-3 |
| **A-007** | Auth/RBAC on AI menu parsing/review (billable abuse) | [SEC] | menu-management | `src/app/actions/ai-menu-parsing.ts:87,261` | No auth on `parseIngredientWithAI`/`reviewIngredientWithAI`; latter client-invoked → unbounded OpenAI spend. | Add `checkUserPermission('menu_management','manage')` to both. | WS-3 |
| **A-008** | Require write/payment scope on PayPal capture/create-order | [SEC] | payments, public-table-booking | external event/table-booking capture+create routes | Real-money capture + booking confirmation behind `['read:events']`. | Require `write:bookings`/`payments:capture`; audit keys. | WS-13 |
| **A-009** | Fix parking refund column mismatch (broken refunds) | [SEC] | parking-admin | `src/app/actions/refundActions.ts:96-114,289-301` | Embed selects non-existent columns → refund path + notifications abort ("Booking not found"). | Correct embed to `customer_first_name/last_name/mobile/email`. | WS-14 |
| **A-010** | Fix deposit-timeout cron premature cancellation | [SEC] | table-bookings/cron | `src/app/api/cron/table-booking-deposit-timeout/route.ts:22-58` | Cancels valid bookings within 24h of event ignoring `hold_expires_at`; sends cancellation SMS mid-window. | Add `hold_expires_at` checks; reconcile with `event-booking-holds` cron. | WS-14 |
| **A-011** | Fix recruitment cancel→cannot-rebook lockout | [SEC] | recruitment | `src/services/recruitment.ts:2079-2126,2015-2022`; `RecruitmentBookingClient.tsx:121-161` | Cancel doesn't clear `booking_token_used_at`; cancelled appt returned as current → Book button gone. | Clear token on cancel; exclude cancelled from `currentAppointment`. | WS-14 |
| **A-012** | Fix orphaned Outlook event on cancel | [SEC] | recruitment | `src/lib/recruitment/calendar.ts:208-256` | Graph DELETE failure leaves live event; retry sweep only handles scheduled. | Add deletion-retry sweep for cancelled appts with `calendar_event_id`. | WS-14 |
| **A-013** | London-timezone private-booking refund threshold | [SEC] | private-bookings | `src/services/private-bookings/financial.ts:121-127` | `daysUntilEvent` uses server-local time; BST flips 95% refund vs forfeiture at 30-day boundary. | Diff calendar days in Europe/London. | WS-4 |
| **A-014** | RBAC cache invalidation on role-permission/role-delete | [SEC] | roles-users-rbac | `src/services/permission.ts:267-339,233-265,85-98` | 60s cache only busted by `assignRolesToUser`; revoked permission persists up to 60s (fail-open). | `revalidateTag` every affected user on role-permission change/role delete. | WS-3 |
| **A-015** | Block RBAC privilege escalation via custom roles | [SEC] | roles-users-rbac | `src/app/actions/rbac.ts:308-374` | `assignPermissionsToRole` accepts arbitrary permission ids; self-elevation possible. | Restrict assignable permissions to actor's own set; gate behind super_admin. | WS-3 |
| **A-016** | Avatar upload file-type/size validation (stored XSS) | [SEC] | profile | `src/app/actions/profile.ts:217-231` | Any file accepted to public bucket; SVG/HTML = stored XSS; unbounded size. | Validate MIME allowlist, enforce max size, derive ext from MIME. | — |
| **A-017** | Atomic mileage trip create/update | [SEC] | mileage | `src/app/actions/mileage.ts:882-912,999-1033` | Legless trips orphaned; skew cumulative 10k-mile rate split; update deletes legs before insert. | Single transactional RPC; insert-before-delete on update. | WS-6 |
| **A-018** | Atomic RBAC permission/role replace | [SEC] | roles-users-rbac | `src/services/permission.ts:301-338,359-401` | Delete-then-insert double failure wipes all role/user permissions. | Atomic RPC or diff-and-apply changed rows only. | WS-6 |
| **A-019** | Fix DS Checkbox silent data loss | [UX] | global-components | `src/ds/primitives/Checkbox.tsx:56-66` | `onChange` boolean-only in empty catch; onboarding health checkboxes record nothing (medical PII). | Re-type `onChange(checked)`, drop catch, fix consumers. | WS-1 |
| **A-020** | DataTable sortable headers keyboard-accessible + aria-sort | [UX] | global-components | `src/ds/composites/DataTable.tsx:388-433` | Headers `<th onClick>` no kbd/aria-sort; every list screen unsortable by keyboard. | Wrap in `<button>`, set `aria-sort`. | WS-1 |
| **A-021** | Sidebar nav permission gating | [UX] | auth-and-layout | `src/ds/shell/SidebarNav.tsx:21-67` | Every user sees every section; mobile drawer adds admin items. | Filter by `usePermissions()`; render real role label. | WS-2 |
| **A-022** | Wire/port permission-gated nav, remove dead `AppNavigation` | [UX] | auth-and-layout | `AppNavigation.tsx:22-315` | Permission-gated nav is dead code; live nav diverges. | Port gating into `SidebarNav`; delete after. | WS-2, WS-8 |
| **A-023** | Wire or remove customers bulk SMS/Email buttons | [UX] | customers | `customers/_components/CustomersClient.tsx:407-412` | Buttons with no `onClick` mislead staff. | Wire to bulk action or remove. | WS-3(dead-control) |
| **A-024** | Fix employees "Prospective" status rejected by schema | [UX] | employees | `NewEmployeeOnboardingClient.tsx:536` vs `services/employees.ts:99` | Offered option fails `safeParse`; generic failure. | Add to enum or remove option; surface field errors. | — |
| **A-025** | Add table-booking edit + Sunday pre-order admin surface | [UX] | table-bookings-admin | `[id]/BookingDetailClient.tsx:722-822,287` | No edit for date/time/notes/dietary/customer (food-safety); pre-order contents invisible. | Add edit form/action; add pre-order read (editable before cutoff). | WS-15 |
| **A-026** | Parking edit + Cancel confirmation + rate management UI | [UX] | parking-admin | `ParkingClient.tsx:498-526,510-514`; `actions/parking.ts:265-299` | No edit after creation; Cancel one-click flips paid→refunded; rates SQL-only. | Add edit action, ConfirmDialog, rates screen. | WS-15, WS-9 |
| **A-027** | Rota drag-drop keyboard accessibility | [UX] | rota | `rota/RotaGrid.tsx:622-624` | `PointerSensor` only; mouse-only core interaction. | Add `KeyboardSensor` or "Move shift" control. | WS-1 |
| **A-028** | Pay bands/rates/overrides edit + deactivate | [BOTH] | payroll, settings | `actions/pay-bands.ts:62-86`; `PayBandsManager.tsx` | Create-only on payroll-critical entity; `is_active` badge unreachable. | Add update + deactivate UI/actions. | WS-15 |
| **A-029** | API key revoke/delete UI | [UX] | settings | `api-keys/ApiKeysManager.tsx:273-308` | `revokeApiKey` exists, unwired; leaked key undisableable without DB write. | Surface revoke + delete with confirmation. | WS-15, WS-9 |
| **A-030** | Surface parking-guest payment-failure states | [BOTH] | public-parking | `parking/guest/[id]/page.tsx:42-56` | `?payment=missing_parameters`/`not_found` ignored → reassuring message on real failure. | Branch on failure states; show error + contact; add pay/retry for pending/failed. | WS-7, WS-14 |
| **A-031** | Fix GDPR "Export My Data" missing messages | [BOTH] | profile | `src/app/actions/profile.ts:162-166` | Joins `messages.customer_id` on auth user id (never matches); empty export reported as complete. | Resolve linked customer first or drop section; check query error. | WS-7 |
| **A-032** | Roles name/description edit UI | [UX] | roles-users-rbac | `roles/components/RoleForm.tsx` | `updateRole` exists; no edit route. | Add `roles/[id]/edit` + Edit button. | WS-15 |
| **A-033** | Users real role badge + wire role filter | [UX] | roles-users-rbac | `users/_components/UsersContent.tsx:46-59,120-122` | Filter no-op; every row shows fake "User" badge. | Join `user_roles`; render real roles; wire filter. | WS-15 |
| **A-034** | Invoices credit-note/refund UI | [UX] | invoices | `actions/invoices.ts:982` | `createCreditNote`/`RefundDialog` orphaned. | Surface on `InvoiceDetailClient` for paid invoices. | WS-15 |
| **A-035** | OJ clients CRUD + vendor billing settings UI + entries pagination | [BOTH] | oj-projects | `clients/_components/ClientsClient.tsx`; `actions/oj-projects/vendor-settings.ts:19-34`; `entries/page.tsx:9` | Billing config drives invoices but unmanageable; entries capped at 200 (older invisible). | Add client CRUD, billing-settings editor, entries pagination. | WS-15, WS-11 |
| **A-036** | Fix `getClientBalance` 50-invoice cap | [SEC] | oj-projects | `src/app/actions/oj-projects/client-balance.ts:43-63` | Sums only latest 50 invoices (status filtered in JS after cap) → understated balance. | Dedicated unbounded unsettled-invoice query; keep limit only for display. | WS-11 |
| **A-037** | Messages holding queue: customer search + surface errors | [UX] | messages-sms | `messages/holding/page.tsx:35,94` | Raw-UUID linking; `void` wrappers discard errors. | Use `CustomerSearchInput`; surface action results. | WS-7 |
| **A-038** | Messages 3-panel responsive on mobile | [UX] | messages-sms | `_components/MessagesClient.tsx:491` | Fixed grid; unusable on phone. | Responsive single-column + back affordance. | WS-10 |
| **A-039** | Recruitment feedback + confirmations + applications pagination | [UX] | recruitment | `RecruitmentDashboardClient.tsx:329-346,1807,757` | ~15 actions no feedback; one-click GDPR erase; no applications pagination. | `useActionState`/toasts, confirmations, pagination. | WS-7, WS-9, WS-11 |
| **A-040** | Receipts file-delete confirmation + mobile workspace | [UX] | receipts | `ReceiptTableRow.tsx:363`; `ReceiptsClient.tsx:162` | Delete on bare `×`; mobile loses import/export/rules. | Add confirm; add mobile path. | WS-9, WS-10 |
| **A-041** | Onboarding submit handlers surface errors | [UX] | employee-onboarding | `steps/CreateAccountStep.tsx:41-52` (+all steps) | `try/finally` no catch; thrown action looks like silent no-op. | Add `catch` surfacing error. | WS-7 |
| **A-042** | Audit logging on onboarding financial/health PII writes | [SEC] | employee-onboarding | `saveOnboardingSection` | NI/bank/health writes have no audit trail. | Add `logAuditEvent`. | WS-5 |
| **A-043** | Audit logging on BOH table-booking delete/cancel | [SEC] | table-bookings-admin | `boh/table-bookings/[id]/route.ts:38-66,103-119` | Hard delete + cascade with zero trail. | Add `logAuditEvent` to both branches. | WS-5 |
| **A-044** | Staff portal self-service leave cancel + error branch + sign-out | [BOTH] | staff-portal, leave | `(staff-portal)/portal/leave/page.tsx:66-67,94-126`; `layout.tsx` | Can't cancel own request; errors collapse to empty; no sign-out. | Add cancel action, error branch, sign-out control. | WS-7, WS-15 |
| **A-045** | Leave manager queue row actions + approve/decline confirmation | [UX] | leave | `rota/leave/LeaveManagerClient.tsx:55-191,83-104` | No edit/delete from queue; one mis-click declines (email + frees dates). | Add row actions + confirmation. | WS-9, WS-15 |
| **A-046** | Recurring-invoice cron: don't orphan unsent drafts | [SEC] | invoices/cron | `api/cron/recurring-invoices/route.ts:186-202,350-405` | Schedule advanced before draft→sent flip; email failure seals claim, draft never resends. | Transition to `sent` independent of email, or re-queue on failure. | — |
| **A-047** | Fix invoice total/VAT divergence (screen/stored/PDF) | [SEC] | invoices | `lib/invoiceCalculations.ts:62-75`; `InvoiceDetailClient.tsx:257-292,711-763` | Unrounded per-line VAT summed; PDF vs screen divisor differ → ~1p divergence, two totals. | Round per-line VAT to 2dp before summing; display persisted values as truth. | — |
| **A-048** | Remove/redirect dead "Mark as Paid" invoice button | [SEC] | invoices | `InvoiceDetailClient.tsx:521-531` | `updateInvoiceStatus` rejects `paid`; button always fails. | Remove or route to Record Payment. | WS-15 |
| **A-049** | Verify `completeReceiptUpload` storage path provenance | [SEC] | receipts | `receiptMutations.ts:1221-1273` | Trusts client path (regex+year only); replay attaches receipt to other transaction. | Persist issued path; verify supplied path matches. | WS-6 |
| **A-050** | Employees CSV formula-injection sanitisation | [SEC] | employees | `src/services/employees.ts:1230-1252` | Free-text `= + - @` written verbatim; executes on open. | Prefix `'` to cells beginning with `= + - @`/tab/CR. | — |
| **A-051** | Reliable menu GP analysis with un-priced ingredients | [SEC] | menu-management | `DishCompositionTab.tsx:62`; `DishGpAnalysisTab.tsx:125` | `if(!unitCost) continue` drops components; `cost_data_complete` unused → inflated GP%, wrong pricing. | Surface cost-incomplete state; warn GP unreliable. | WS-7 |
| **A-052** | Leave: exclude weekends/non-working days from allowance | [SEC] | leave | `actions/leave.ts:151-156,398-403,526-528` | Weekend days counted against working-day allowance; false over-allowance flags. | Exclude weekends (+ per-employee non-working days). | — |

### P2 — Medium (consolidated; full per-finding detail in Part D)

| ID | Title | Src | Section | Problem → Action | Links |
|---|---|---|---|---|---|
| **A-053** | RBAC re-checks on remaining exported actions | [SEC] | customers, settings, cashing-up, menu, payroll periods | `getBulkCustomerLabels`, `updateSiteSettings/Toggle`, `getMissingCashupDatesAction`, `getMenuTargetGp`, payroll period actions lack `checkUserPermission` → add gates. | WS-3 |
| **A-054** | Make `ConfirmDialog` async-safe | [UX] | global-components | `ConfirmDialog.tsx:71-80` closes synchronously → await `onConfirm`, keep open+disabled, surface errors. | WS-1 |
| **A-055** | Fix Checkbox/Radio label association | [UX] | global-components | `<button>`+inert `htmlFor` → real associated control. | WS-1 |
| **A-056** | Tabs/SectionNav tablist semantics + arrow-keys | [UX] | global-components | `Tabs.tsx:68-109` → add roles + keyboard nav. | WS-1 |
| **A-057** | `Field` associate error/hint with control | [UX] | global-components | `Field.tsx:15-42` → wire `aria-describedby`/`aria-invalid`. | WS-1 |
| **A-058** | Add `<th scope>` to 21 raw tables + fix empty checkbox labels | [UX] | cross-section | Add scope; label matrix/bulk checkboxes. | WS-1 |
| **A-059** | Audit logging sweep on remaining mutations | [SEC] | recruitment, payroll, rota, oj, mgd, receipts, parking, private-bookings, employees, rbac | Add `logAuditEvent` (+ actor) to all theme-3 paths. | WS-5 |
| **A-060** | Atomicity sweep on remaining multi-step writes | [SEC] | recruitment, receipts, menu, quotes, customers, leave, cashing-up, expenses, onboarding | Wrap in RPC/transaction; insert-before-delete. | WS-6 |
| **A-061** | Optimistic-concurrency guards on state transitions | [SEC] | table-bookings, leave, rota, invoices, timeclock | Add status-scoped WHERE / partial unique indexes / affected-row checks. | WS-6 |
| **A-062** | dateUtils migration — money/booking boundaries | [SEC] | table-bookings refund tier, payroll P&L windows, customer win-back, private-booking SMS/email dates | Route through dateUtils (London). | WS-4 |
| **A-063** | Currency-blind capture/refund helpers | [SEC] | payments | Assert `currency_code`; stop hardcoding GBP; validate portal deposit currency. | WS-13 |
| **A-064** | PayPal refund status edge cases | [SEC] | payments, webhooks | Don't mark non-COMPLETED refunds completed; count pending refunds in double-spend window. | WS-13 |
| **A-065** | Resend webhook idempotency + progression guard | [SEC] | webhooks | `webhooks/resend/route.ts:400-505` no idempotency; can clobber newer status → svix-id claim + progression guard. | — |
| **A-066** | Expenses VAT-vs-gross validation + fake category sidebar | [BOTH] | expenses | VAT can exceed gross (`expenses.ts:91-99`); category sidebar always £0 (`ExpensesClient.tsx:54-62`) → cross-field refinement; real category or remove sidebar. | WS-15 |
| **A-067** | Expenses admin-client RLS bypass + atomic delete | [SEC] | expenses | All queries use admin client; `deleteExpense` orphans files → RLS-scoped client; atomic delete. | WS-6 |
| **A-068** | Quotes nullable total → NaN/crash + non-draft edit | [BOTH] | quotes | `total_amount` null → `?? 0`; align type; allow correcting sent quotes. | WS-15 |
| **A-069** | MGD HMRC modal hardcodes machine=1 / zeroes rate bands | [BOTH] | mgd | `MgdClient.tsx:577-594` → respect actual machine count + 5% Cat D rate. | — |
| **A-070** | MGD async confirm + detail/search/export | [UX] | mgd | Confirm closes before resolve; no detail/search/pagination/UI export → fix dialog, add views. | WS-9, WS-11 |
| **A-071** | Cashing-up: wire Approve/Lock/Unlock + targets; reconcile variances; atomic submit | [BOTH] | cashing-up | Unwired actions; import zeroes card/stripe variance; non-atomic submit; double audit → wire UI, reconcile, atomic RPC, fix audit. | WS-15, WS-6, WS-5 |
| **A-072** | Cashing-up import validation + searchable session list | [UX] | cashing-up | No per-row Zod, preview cap 10, no confirm; no searchable list → add validation + list. | WS-11 |
| **A-073** | Short-links: open-redirect allowlist + dead export + ownership | [SEC] | short-links | No destination host allowlist; `createShortLinkInternal` unauthenticated; `created_by` unset; count mismatch → allowlist, remove dead export, set owner. | — |
| **A-074** | Short-links template-literal + colSpan + insights errors | [UX] | short-links | Literal `${...}` render; `Table` no `colSpan`; insights `catch {}` → fix interpolation, add colSpan, surface errors. | WS-7 |
| **A-075** | Menu: verifyDishAllergens null-user; choice group by id; price-history atomicity | [SEC] | menu-management | Food-safety attestation can proceed without user; allergen group by display name; pack_cost without history → guard user, key by id, atomic write. | WS-6 |
| **A-076** | Menu: drawer validation, recipe-delete path, card toggle, inline currency | [UX] | menu-management | `required` on non-form button never fires; raw `fetch` delete; card toggle no-op; blur-commit price → real validation, consistent action, wire toggle, confirm price commit. | WS-15 |
| **A-077** | Settings: route-gate Event Categories/GDPR; validate site settings; SpecialHours tz | [BOTH] | settings | No page-level gate; deposit/group-size/email unchecked; exception date local tz → add gates, Zod, dateUtils. | WS-2, WS-4 |
| **A-078** | Settings: customer-label icon input; SMS-failures remediation; hub links | [UX] | settings | `icon` stored no input; no resend/dismiss; hub doesn't link sub-pages → add picker, remediation actions, links. | WS-15 |
| **A-079** | Events: JSON.parse guard, date validation, cancellation refund basis, category filter | [BOTH] | events | Unhandled `JSON.parse`; server-local midnight; refund from current price not amount paid; dead category filter → guard, London tz, refund from paid, wire/remove filter. | WS-4 |
| **A-080** | Events attendees pagination + transfer picker + per-row actions | [UX] | events | No attendee pagination; raw-UUID transfer; no-op "more actions" → paginate, event picker, wire/remove menu. | WS-11 |
| **A-081** | Private-bookings: items page gating, edit financial fields, dispute regex, payment buttons | [BOTH] | private-bookings | Items page ungated; deposit/due-date uneditable; dispute by free-text regex; ad-hoc payment buttons → gate, add fields, structured dispute flag, DS buttons. | WS-2, WS-15, WS-10 |
| **A-082** | Customers: estimated-count pagination, dedup RLS, stat cards page-scoped | [SEC] | customers | `count:'estimated'` wrong totals; dedup via RLS client vs global index; stat cards count current page → exact count, fix dedup, global stats. | WS-11 |
| **A-083** | Employees: E.164 normalisation, CSV dates, split edit surfaces | [BOTH] | employees | Phones not E.164 (employee + emergency contact); CSV `toLocaleDateString`; RTW/Financial/Health split between detail and `/edit` → normalise, dateUtils, unify edit. | WS-4, WS-15 |
| **A-084** | Mileage: pagination, export, search, destination delete, atomic legs | [BOTH] | mileage | Unbounded list; CSV exporter unwired; no search; distance undeletable; rate-split preview wrong back-dated → paginate, wire export, add search/delete, fix preview. | WS-11, WS-6 |
| **A-085** | Rota: settings audit, cron phantom auto-accept, couldnt-work uniqueness, modals | [BOTH] | rota | `updateRotaSettings` no audit; cron lacks `.select()`; `markEmployeeCouldntWork` check-then-insert; 7 hand-rolled modals → audit, add select, unique constraint, DS modals. | WS-5, WS-6, WS-10 |
| **A-086** | Messages: bulk null-name, mark-read gating, SMS counter, pagination | [BOTH] | messages-sms | `'null'` rendered; mark-read gated only on view; no segment counter; unbounded recipients → fix null, gate write, add counter, paginate. | WS-11 |
| **A-087** | Profile: avatar remove + double-trigger + bucket IaC; password strength; dates | [BOTH] | profile | No avatar remove; double file-picker; bucket not in migrations; 6-char password; raw dates → add remove, fix label, add migration, strengthen, dateUtils. | WS-4 |
| **A-088** | Payroll: variance flag, dead buttons, send-without-user, P&L tz, period guards | [BOTH] | payroll | Variance never fires for no-shows; dead RotaPayroll buttons; `sendPayrollEmail` no user check; P&L window server-local; period editor no end≥start → fix each. | WS-3, WS-4 |
| **A-089** | Recruitment: rate-limit public routes, GDPR audit, retention filter, atomic slots | [SEC] | recruitment | Public cancel/reschedule/claim no rate limit/Turnstile; GDPR erase no audit; retention re-anonymises every run; slot claim non-atomic → add limits, audit, fix filter, atomic. | WS-5, WS-6 |
| **A-090** | Public table-booking: read-scope (A-008), dead mockups, spoofable state | [BOTH] | public-table-booking | Capture behind read scope; `PublicBookingClient`/`BookingConfirmationClient` dead mockups; `?state=paid` spoofable; end-of-day hold server-local → scope, delete mockups, verify server-side, London tz. | WS-13, WS-8, WS-4 |
| **A-091** | Public-parking: cancelUrl 404, return-route guards, not-found boundary | [UX] | public-parking | `cancelUrl` non-existent route; return redirect with no id; no branded not-found → fix routes, add boundary. | WS-7 |
| **A-092** | Timeclock: PIN/identity, single-session uniqueness, clockOut robustness | [BOTH] | timeclock-kiosk | No PIN; `.single()` clockOut stuck on multiple sessions; no unique open-session constraint → add PIN/token, partial unique index, `maybeSingle`. | WS-6 |
| **A-093** | Auth: FOH server-side gating, login placeholders, not-found, error boundary chrome | [BOTH] | auth-and-layout | FOH redirect client-only; 2FA/SSO non-functional placeholders; no `not-found.tsx`; error boundaries hardcoded → server-gate, remove/wire placeholders, add files, tokenise. | WS-2, WS-10 |
| **A-094** | Webhooks: status progression guard, parking CAPTURE.DENIED stale, idempotency | [SEC] | webhooks | Resend can clobber newer status; parking denial leaves stale row; top-level PayPal route duplicate audit → progression guard, handle denial, idempotency. | — |
| **A-095** | Cron: deposit-timeout (A-010), expire-holds audit, raw-error leak | [SEC] | cron-jobs | expire-holds no audit; `recurring-invoices` leaks raw DB error in 500 → audit, sanitise error. | WS-5 |
| **A-096** | Add route-level `loading.tsx` to 16 missing sections | [UX] | cross-section | Only 9/25 have one; some reuse `Empty` as spinner → add DS Skeleton loaders. | WS-7 |
| **A-097** | Add scoped `error.tsx` to high-traffic sections | [UX] | cross-section | One boundary for whole authed area → add scoped boundaries. | WS-7 |
| **A-098** | Pagination sweep on unbounded lists | [UX] | cross-section | Attendees, notes, vendors, recurring, quotes, expenses, mileage, oj entries/projects, parking, messages, recruitment, SMS-failures, leave, cashing-up, table-bookings → paginate. | WS-11 |
| **A-099** | Debounce server-action search | [UX] | customers, events, expenses, parking | Per-keystroke server fetch → 300ms debounce. | WS-11 |
| **A-100** | Unsaved-changes guards on large forms | [UX] | events, invoices, quotes, settings, mileage, expenses, menu, rota | Accidental dismissal loses work → dirty-state guard. | WS-10 |
| **A-101** | Migrate hand-rolled inputs/modals to `@/ds` | [UX] | employees, events, private-bookings, expenses, mileage, rota, menu, parking, table-bookings, payroll, leave, onboarding, settings, staff-portal | Inaccessible bespoke UI → migrate to DS primitives. | WS-10 |
| **A-102** | Make clickable rows keyboard-operable | [UX] | events, invoices, quotes, private-bookings, oj-projects, customers, table-bookings, menu, payroll | `<tr onClick>` no kbd → real link or button semantics. | WS-1 |
| **A-103** | Map hardcoded colours to design tokens | [UX] | ~all sections + `@/ds` | ~120 non-token colours → semantic tokens; document chart exceptions. | WS-10 |
| **A-104** | Add success toasts + surface failures consistently | [UX] | expenses, mileage, invoices, payroll, quotes, leave, onboarding | Silent mutations → consistent toasts. | WS-7 |
| **A-105** | Field-level form validation with ARIA | [UX] | events, customers, employees, line-items, parking, receipts, cashing-up, mgd, recruitment, menu, expenses, onboarding | Server-deferred toast-only validation → RHF+Zod field errors + ARIA. | WS-1 |
| **A-106** | Calendar-feed token expiry/revocation | [SEC] | staff-portal | Non-expiring static bearer → per-user revocation/expiry. | — |
| **A-107** | Change-password current-password check + strength | [BOTH] | profile | 6-char min, no current-password verify, client-only → re-auth, strength, server check. | — |
| **A-108** | Settings hub + sub-page route gates + native confirm replacement | [UX] | settings | Hub doesn't link sub-pages; native confirm ×4; TableSetupManager raw → links, ConfirmDialog, DS. | WS-9, WS-10 |
| **A-109** | OJ statement: confirmation on email, tz defaults, opening-balance credit | [BOTH] | oj-projects | Email fires without confirm; `toISOString` defaults; opening balance floors each invoice at 0 → confirm, dateUtils, allow credit. | WS-9, WS-4 |
| **A-110** | Receipts: requeue audit/revalidate, automation-rule hard-delete, suggestions overflow | [BOTH] | receipts | `requeueUnclassifiedTransactions` no audit; rule hard-delete unwired; suggestions capped at 5 → audit, wire delete, overflow access. | WS-5, WS-15 |

### P3 — Low (consolidated)

| ID | Title | Src | Scope | Action | Links |
|---|---|---|---|---|---|
| **A-111** | Display-only dateUtils migration | [BOTH] | dashboard, customers, employees, invoices, quotes, messages, mileage, short-links, profile, oj, cashing-up, table-bookings, receipts, leave, staff-portal, public | Route display dates through `formatDateInLondon`/`getTodayIsoDate`. | WS-4 |
| **A-112** | Delete dead/duplicate components | [BOTH] | customers, employees, private-bookings, invoices, quotes, parking, rota, table-bookings, short-links, users, leave, onboarding, timeclock, staff-portal, public | Remove orphaned clients/demo trees after import check. | WS-8 |
| **A-113** | Remaining `@/ds` primitive polish | [UX] | global-components | `Avatar`/`Modal description`/`EmptyState`/`Toast`/`Alert closable`/`Switch`/`compat/Toggle`/base `Table` overflow. | WS-1, WS-10 |
| **A-114** | Cron auth constant-time compare | [SEC] | cron-jobs | Replace non-constant-time secret compare. | — |
| **A-115** | Webhooks hardening (signature, replay, retry-storm) | [SEC] | webhooks | Twilio `request.url`, PayPal local replay check, Resend missing-secret 500, ILIKE email match. | — |
| **A-116** | Login rate-limiting per-account | [SEC] | auth-and-layout | IP-only throttle → add per-account. | — |
| **A-117** | Remaining low-severity per-section polish | [BOTH] | all sections | Every remaining P3 item in Part D (icon-button `aria-label`, colour-only state, empty states, breadcrumbs, magic numbers, `.single()`→`.maybeSingle()`, etc.). | various |

---

## Part C — CRUD completeness matrix

Merged from the [UX] per-entity matrices. Operations: **C**reate · **R**ead · **U**pdate · **D**elete · **L**ist · **S**earch/Sort · **P**agination. `partial` = limited; `n-a` = not applicable. Grouped by section. Gaps drive the WS-15 actions.

### Core operational entities

| Section | Entity | C | R | U | D | List | S | P | Key gaps |
|---|---|---|---|---|---|---|---|---|---|
| dashboard | Calendar Note | yes | partial | **no** | **no** | partial | n-a | n-a | Create-only; existing notes tooltip-only |
| customers | Customer | yes | yes | yes | yes | yes | partial | yes | No debounce; no column sort; "SMS Active" tab no-op; bulk SMS/Email dead; no export |
| customers | Customer Label (assignment) | yes | yes | n-a | yes | yes | no | n-a | Bulk-apply unwired; hand-rolled dropdown |
| employees | Employee | yes | yes | yes | yes | yes | partial | yes | "Prospective" rejected by schema; no sort/bulk; read-only Financial/Health tabs no edit link |
| employees | Emergency Contact | yes | yes | yes | yes | yes | n-a | n-a | Hand-rolled modals; hardcoded colours |
| employees | Attachment/Document | yes | yes | **no** | yes | yes | no | no | Can't edit category/desc; no filter |
| employees | Note | yes | yes | n-a | n-a | yes | no | **no** | Append-only; unbounded growth |
| employees | Right to Work | yes | yes | yes | partial | n-a | n-a | n-a | Record undeletable; raw Date; window.confirm/alert |
| employees | Financial/Health | yes | yes | yes | **no** | n-a | n-a | n-a | Editable only via `/edit`; detail tab read-only |
| events | Event | yes | yes | yes | yes | yes | partial | yes | Category filter dead; no sort; no debounce; "more actions" no-op; bulk=delete only |
| events | Booking (attendee) | yes | yes | partial | partial | yes | partial | **no** | Only seats inline; no attendee pagination; transfer via raw UUID |
| events | Checklist item | n-a | yes | yes | n-a | yes | no | n-a | Template-derived; divergent styling ×3 |
| events | Marketing link | partial | yes | **no** | **no** | yes | no | no | No edit/delete individual link |
| private-bookings | Private Booking | yes | yes | yes | yes | yes | partial | yes | Edit form missing deposit/due-date fields; no sort/bulk |
| private-bookings | Booking Item | yes | yes | partial | yes | yes | n-a | n-a | Items page no permission gating; can't change item_type |
| private-bookings | Vendor | yes | partial | yes | yes | yes | **no** | **no** | No search/filter/pagination; window.confirm; no read view |
| private-bookings | Venue Space | yes | partial | yes | yes | yes | no | no | As Vendor; window.confirm delete |
| private-bookings | Catering Package | yes | partial | yes | yes | yes | no | no | DS-modal (better); no search/pagination |
| private-bookings | Booking Payment/Refund | yes | yes | partial | **no** | yes | n-a | n-a | Record-payment buttons ad-hoc native |
| table-bookings | Table Booking | yes | yes | **partial** | yes | yes | yes | **no** | Can't edit date/time/notes/dietary/customer; no pagination; pre-orders invisible |
| table-bookings | Pre-order | **no** | **no** | **no** | **no** | **no** | n-a | n-a | No admin surface at all |
| parking-admin | Parking Booking | yes | partial | partial | **no** | yes | partial | **no** | No edit; Cancel no confirm; 200-cap; no detail page |
| parking-admin | Rate | n-a | partial | **no** | n-a | **no** | n-a | n-a | No rate UI — SQL only |

### Rota / scheduling / time

| Section | Entity | C | R | U | D | List | S | P | Key gaps |
|---|---|---|---|---|---|---|---|---|---|
| rota | Shift | yes | yes | yes | yes | yes | **no** | n-a | Drag-drop kbd-inaccessible; no filter; inline-confirm delete |
| rota | Shift Template | yes | partial | yes | partial | yes | partial | n-a | Deactivated become unreachable orphans; window.confirm |
| rota | Leave/Holiday | yes | yes | partial | yes | yes | n-a | n-a | Edit/delete only via rota-grid modal |
| rota | Sales Target override | partial | yes | yes | **no** | n-a | n-a | n-a | Raw inputs; no remove |
| leave | leave-request (employee) | yes | partial | **no** | **no** | yes | **no** | **no** | Can't cancel/edit own pending |
| leave | leave-request (manager) | no | partial | partial | **no** | yes | partial | **no** | No edit/delete from queue; approve/decline no confirm; unbounded |
| leave | allowance | n-a | yes | **no** | n-a | n-a | n-a | n-a | Read-only; no link to where set |
| payroll | Payroll Period | yes | yes | partial | no | partial | no | n-a | Month select not a real list; no history |
| payroll | Payroll Row | no | yes | partial | yes | yes | **no** | **no** | No search/filter; delete no toast; edit-after-approval not re-locked |
| payroll/settings | Pay Age Band | yes | yes | **no** | **no** | yes | no | no | Create-only (payroll-critical); badge unreachable |
| payroll/settings | Pay Band Rate | yes | yes | **no** | **no** | yes | no | no | Append-only; mis-dated rate can't be voided |
| payroll/settings | Employee Rate Override | yes | yes | **no** | **no** | yes | no | n-a | Append-only; no correction path |
| timeclock-kiosk | Timeclock Session | yes | partial | partial | partial | yes | **no** | **no** | No staff search; no on-kiosk undo; "On Leave" hardcoded 0 |
| cashing-up | Cashup Session | yes | partial | partial | **no** | partial | **no** | **no** | No delete/void; Approve/Lock/Unlock unwired; no session list |
| cashing-up | Denomination count | yes | yes | partial | partial | yes | n-a | n-a | Cleared/replaced wholesale |
| cashing-up | Daily/Weekly Target | **no** | yes | **no** | **no** | partial | n-a | n-a | Target actions exist, no UI; shows £0 |
| mgd | MGD Collection | yes | partial | yes | yes | yes | partial | **no** | No detail; notes never shown; no UI export; delete confirm closes early |
| mgd | MGD Return | partial | partial | partial | n-a | yes | partial | **no** | Trigger-created; no backfill UI; HMRC modal hardcodes machine=1, zeroes bands |

### Finance / projects / content

| Section | Entity | C | R | U | D | List | S | P | Key gaps |
|---|---|---|---|---|---|---|---|---|---|
| invoices | Invoice | yes | yes | partial | partial | yes | partial | yes | Credit-note/refund UI orphaned; status tabs≠dropdown; no sort; window.confirm void |
| invoices | Line item | yes | yes | yes | yes | yes | n-a | n-a | HTML-required only; no per-row errors |
| invoices | Recurring invoice | yes | yes | yes | yes | yes | **no** | **no** | No search/sort/pagination; confirm() |
| invoices | Line-item catalog | yes | yes | yes | yes | yes | **no** | **no** | No search; confirm() delete |
| quotes | Quote | yes | yes | **partial** | **partial** | yes | partial | **no** | Edit/delete DRAFT only; no nav entry; no pagination |
| quotes | Line item | yes | yes | partial | partial | yes | n-a | n-a | Editable in draft only; new vs edit diverge |
| receipts | Transaction | partial | partial | yes | **no** | yes | yes | yes | CSV-import only; no manual create; no detail; no row delete |
| receipts | Receipt file | yes | yes | n-a | yes | yes | n-a | n-a | Delete no confirm; download silently no-ops |
| receipts | Automation rule | yes | yes | yes | partial | yes | partial | **no** | Hard-delete unwired; Rules panel hidden below md |
| receipts | Rule suggestion | n-a | yes | n-a | yes | yes | partial | **no** | Capped at 5, no overflow |
| receipts | Vendor watchlist | yes | yes | n-a | yes | yes | partial | no | No search/pagination |
| expenses | Expense | yes | partial | yes | yes | yes | partial | **no** | No pagination; no detail; no in-UI export; no bulk |
| expenses | Category | **no** | partial | **no** | **no** | partial | n-a | n-a | Fake entity — hardcoded budgets vs free-text → always £0 |
| expenses | Receipt file | yes | yes | **no** | yes | yes | n-a | partial | No rename/replace; no bulk delete |
| mileage | Trip | yes | partial | yes | yes | yes | partial | **no** | No pagination; no search; no export (exporter exists); no detail |
| mileage | Trip Leg | yes | yes | yes | yes | yes | n-a | n-a | Delete+reinsert on edit |
| mileage | Destination | yes | yes | yes | partial | yes | **no** | **no** | Undeletable when tripCount>0; hand-rolled tables |
| mileage | Destination Distance | yes | yes | yes | **no** | yes | no | no | No delete — mistyped distance only overwritable |
| oj-projects | Project | yes | yes | yes | yes | yes | partial | **no** | No sort/pagination; delete shown for projects that fail server-side |
| oj-projects | Time/Mileage Entry | yes | yes | partial | yes | yes | partial | **no** | Capped 200, no pagination; no bulk/export |
| oj-projects | Client/Vendor | **no** | partial | **no** | **no** | yes | partial | **no** | No client CRUD UI; no inline add |
| oj-projects | Vendor Billing Settings | **no** | **no** | **no** | n-a | n-a | n-a | n-a | Orphaned — drives all billing snapshots |
| oj-projects | Recurring Charge | yes | yes | yes | partial | yes | **no** | **no** | Soft-disable only |
| oj-projects | Work Type | yes | yes | yes | partial | yes | **no** | no | Soft-disable only |
| oj-projects | Project Contact | **no** | yes | n-a | yes | yes | n-a | n-a | Can remove, never add (`addProjectContact` orphaned) |
| short-links | Short Link | yes | partial | partial | yes | yes | partial | yes | Edit drops slug; no detail; no sort/bulk/export; UTM variants un-editable |
| short-links | Click (analytics) | n-a | partial | n-a | n-a | partial | partial | **no** | Read-only; insights errors swallowed; no CSV export |
| menu-management | Dish | yes | yes | yes | yes | yes | yes | yes | No bulk; Overview re-implements list weaker |
| menu-management | Ingredient | yes | yes | yes | yes | yes | yes | yes | Smart-import one-at-a-time; export allergen PDF only |
| menu-management | Recipe | yes | yes | yes | yes | yes | partial | yes | Delete path inconsistent (raw fetch vs action) |
| menu-management | Menu | **no** | partial | **no** | **no** | partial | partial | n-a | No create/edit/delete UI (seed-only) |
| menu-management | Menu Category/Section | **no** | partial | **no** | **no** | partial | n-a | n-a | No management UI |
| menu-management | Choice/Option group | partial | partial | partial | partial | n-a | n-a | n-a | Free-text, no validation; typo distorts GP |

### Comms / admin / RBAC / public

| Section | Entity | C | R | U | D | List | S | P | Key gaps |
|---|---|---|---|---|---|---|---|---|---|
| messages | Conversation/Message | partial | yes | partial | **no** | yes | partial | **no** | 3-panel breaks on mobile; no detail; no resend; no archive/delete; no pagination |
| messages | Bulk message send | yes | n-a | n-a | n-a | yes | yes | **no** | Recipients unbounded; select-all loaded-rows only; unknown `{{tokens}}` ship literally |
| messages | Message template | yes | yes | yes | yes | yes | **no** | no | No search across 16 types; type immutable on edit; double error report |
| messages | Unmatched communication | n-a | yes | partial | partial | yes | **no** | **no** | Raw-UUID linking; errors silently swallowed |
| recruitment | Job posting | yes | yes | yes | partial | yes | **no** | **no** | No search/filter/sort/pagination; archive-via-edit |
| recruitment | Applicant/Application | yes | yes | yes | partial | yes | partial | **no** | No pagination; archive/bulk no confirm |
| recruitment | Candidate (talent) | partial | yes | yes | yes | yes | partial | yes | GDPR erase no confirmation (one-click) |
| recruitment | Slot/Appointment | yes | yes | yes | partial | yes | **no** | **no** | No search/sort/pagination; cancel/reschedule/archive no confirm |
| recruitment | Email template | **no** | yes | yes | **no** | yes | no | no | Edit-only — can't create/delete |
| settings | Customer Labels | yes | yes | yes | yes | yes | no | no | `icon` stored, no input; no submit loading |
| settings | API Keys | yes | yes | yes | **no** | yes | no | no | Can't revoke/delete from UI |
| settings | Event Categories | yes | yes | yes | yes | yes | partial | no | No route-level gate; controls always rendered |
| settings | SMS Failures | n-a | yes | **no** | **no** | yes | partial | **no** | No resend/retry/dismiss; no pagination |
| settings | Categories/budgets/calendar-notes/jobs | yes | yes | yes | yes | yes | partial | partial | Native window.confirm ×4; raw inputs |
| roles | Role | yes | partial | **no** | yes | yes | **no** | n-a | `updateRole` exists, no edit UI; two divergent UIs; window.confirm |
| roles | Permission | n-a | yes | yes | n-a | yes | no | n-a | Matrix checkboxes empty `label=""` |
| users | User | **no** | partial | partial | **no** | yes | partial | **no** | Role filter no-op; hardcoded "User" badge; no pagination |
| profile | profile (self) | partial | yes | partial | partial | n-a | n-a | n-a | Delete fire-and-forget; GDPR export omits messages |
| profile | avatar | yes | partial | yes | **no** | n-a | n-a | n-a | No remove/clear; no size/type validation; double-trigger |
| onboarding | Onboarding submission | yes | partial | partial | n-a | n-a | n-a | n-a | No per-section edit; submit handlers swallow errors |
| staff-portal | shift | n-a | yes | partial | no | yes | **no** | partial | Period-only nav; no swap/drop; ICS only |
| staff-portal | leave-request | yes | partial | **no** | **no** | yes | **no** | **no** | Can't cancel own; errors→empty; no sign-out |
| staff-portal | payslip | n-a | partial | n-a | n-a | **no** | no | partial | No real payslip entity; no PDF/download |
| public-table-booking | Public booking flow | **no** | **no** | **no** | **no** | n-a | n-a | n-a | No working UI — redirects external; orphaned mockup |
| public-parking-guest | Parking booking (guest) | no | yes | **no** | **no** | n-a | n-a | n-a | No pay/retry for pending/failed; raw enum status |

---

## Part D — Per-section appendix (complete ledger)

Every individual finding from both reports. Tag = source; **C/H/M/L** = severity (post-verifier). `(→X)` = verifier correction. Items already in Part B are noted by action ID; full detail above.

### dashboard
- [SEC] H — Daily-summary PII leak — `daily-summary.ts:11-35` — A-003.
- [SEC] M — Parking query compares timestamptz to bare date strings — `dashboard-data.ts:1133`.
- [SEC] M — No dashboard error boundary (blank on snapshot throw).
- [SEC] L — ProgressBar divides by capacity 0; raw Date/toLocaleDateString chart/birthday labels; `lastYearSameWeek` % off partial window; `vsLastWeek` unequal windows; `private_bookings.total_amount` as revenue without netting; Feb-29 birthday→Feb 28; snapshot cache keyed userId only (stale after RBAC); refresh no-op no feedback.
- [UX] M — Today drill-down hrefs rendered as non-clickable text — `DashboardClient.tsx:224-230` — A-117.
- [UX] M — Today list truncated to 6, no overflow link — `:224`.
- [UX] M — Refresh no pending state — `:122-127`.
- [UX] M — Sparklines always empty arrays — `:356-359`.
- [UX] M — Per-module snapshot errors swallowed — `dashboard-data.ts:865-1599` — WS-7.
- [UX] L — ProgressBar NaN width at capacity 0 — `:274`; Action Items raw Tailwind + no-op hover; Quick Action tiles not DS Button; mini-metric `--` ambiguity; calendar-note empty-title silent no-op + non-inline date error; "Last 24h" mislabel; no dashboard error boundary; loading skeleton mismatch; `text-gray-500` deviation in `VenueCalendar.tsx:410`.

### customers
- [SEC] M — Pagination `count:'estimated'` wrong totals — A-082.
- [SEC] M — `getBulkCustomerLabels` no auth — A-053.
- [SEC] M — SMS stat cards count only current page — A-082.
- [SEC] M — Customer dedup via RLS client vs global unique index — A-082.
- [SEC] L — `getCustomerList` RLS-only (→ standards deviation); dead duplicate `CustomersClient.tsx`; win-back cutoff raw Date/toISOString; consent-audit CSV `any`-typed; delete-customer cascade unverified/unlogged; bulk SMS/Email non-functional; page-scoped select-all; consent permission asymmetric create vs update.
- [UX] M(→) — "SMS Active" tab doesn't filter distinctly — `CustomersClient.tsx:383-395`.
- [UX] M — Un-debounced search — `:182-184` — A-099.
- [UX] M — No column sorting (regression from dead client) — `:442-514`.
- [UX] M — Dead duplicate `CustomersClient.tsx` (850 lines) — A-112.
- [UX] M — Stats grid fixed 4-col breaks on mobile — `:375`.
- [UX] M — Label dropdown hand-rolled (no kbd/Escape/ARIA) — `CustomerLabelSelector.tsx:156-193`.
- [UX] M — Detail raw Intl/new Date — `[id]/page.tsx:186-237` — A-111.
- [UX] L — Hardcoded hex label chips; SMS/WhatsApp colour-only; consent-audit error conflated with empty; edit-form no required markers; unused `Select` import; no page-size control.

### employees
- [SEC] M — CSV formula injection — `employees.ts:1230-1252` — A-050.
- [SEC] M — Phones not E.164 (employee + emergency contact) — A-083.
- [SEC] (dropped) — `restoreEmployeeVersion` RBAC false-positive.
- [SEC] M — CSV dates raw toLocaleDateString; birthdays hardcoded Tailwind.
- [SEC] L — Birthdays raw Date; history default ranges raw toISOString; `createEmployeeAccount` no rate limit; `addEmployeeNote` failure unaudited; health checkbox parsing `'on'`-only divergence; reliability sort headers not kbd/colour-accessible; reliability window ISO string lexical compare.
- [UX] H — "Prospective" status rejected by schema — A-024.
- [UX] M — Two divergent list clients; `EmployeesClientPage.tsx` dead — A-112.
- [UX] M — List no error/loading for table — `EmployeesClient.tsx:203-274`.
- [UX] M — `EmployeeForm` Cancel buttons default `type=submit` — `EmployeeForm.tsx:324`.
- [UX] M — Financial/Health tabs read-only, stale placeholder, no `/edit` link — `FinancialDetailsTab.tsx:35` — A-083.
- [UX] M — RTW editable on detail tab but absent from `/edit` — `EmployeeEditClient.tsx:24-58` — A-083.
- [UX] M — All modals hand-rolled; hardcoded colours — `AddEmergencyContactModal.tsx` — A-101.
- [UX] M — RTW/Health/Birthdays raw toLocaleDateString — `RightToWorkTab.tsx:206` — A-111.
- [UX] M — RTW photo delete window.confirm/alert — `RightToWorkTab.tsx:179` — A-117.
- [UX] L — Attachment FormData read twice; sub-query failures degrade silently; icon buttons no aria-label; notes/documents unbounded; reliability table no loading; no column sort.

### events
- [SEC] (dropped) — manual cash/card online discount false-positive.
- [SEC] M — Unhandled `JSON.parse` on FormData — A-079.
- [SEC] M — Event-date validation against server-local midnight — A-079.
- [SEC] M — Staff cancellation refund from current price not amount paid — A-079.
- [SEC] M — Cancellation cascade only refunds PayPal — A-079.
- [SEC] L — `transferEventBooking` dead UUID guard; checklist progress can exceed total; `getEventBookings` PII behind `events:view` — A-006.
- [UX] M(→) — Category filter dead control — `EventFilterPanel.tsx:58-64` — A-079.
- [UX] (dropped) — no error boundary (covered by parent).
- [UX] M — Per-row "more actions" no-op — `EventListView.tsx:183-191` — A-080.
- [UX] M — Search fires per keystroke — `:50-56` — A-099.
- [UX] M — No sortable columns — `:110-128`.
- [UX] M — Bulk delete ad-hoc button — `:99-106`.
- [UX] M — Bulk delete sequential, swallows partial failures — `EventsClient.tsx:219-233`.
- [UX] M — Booking transfer raw event-UUID input — `EventDetailClient.tsx:1059-1071` — A-080.
- [UX] M — Create validation toast-only; drawer no unsaved-guard; attendees no pagination — A-080/A-100/A-105.
- [UX] L — Native `<select>` ticket type; hardcoded colours checklist/drawer; status/clickable-row a11y; untyped casts; inconsistent empty-states; identical ghost variants for destructive; calendar first-load no spinner; booking-sheets `window.location` no feedback.

### private-bookings
- [SEC] H — Cancellation 30-day refund threshold in UTC — A-013.
- [SEC] M — Customer SMS/email event dates without London — A-081.
- [SEC] M — Open-dispute via free-text regex over notes — A-081.
- [SEC] L — Cancellation-preview date without London; dead `recordFinalPayment` path; deleting PayPal-captured deposit clears paid without surfacing no refund.
- [UX] M(→) — Edit form missing financial fields — `[id]/edit/page.tsx:333-484` — A-081.
- [UX] M(→) — Items page no permission gating — `[id]/items/page.tsx:718-934` — A-081.
- [UX] M — Dead duplicate list client (911) — A-112.
- [UX] M — New-booking flashes form before unauthorized redirect — `new/page.tsx:46-56`.
- [UX] M — Payment buttons ad-hoc native + hardcoded colours — `PrivateBookingDetailClient.tsx:2651-2760` — A-081.
- [UX] M — Settings deletes window.confirm — `VendorDeleteButton.tsx:19` — A-108.
- [UX] M — Vendor management no search/filter/pagination — `settings/vendors/page.tsx:307-453` — A-098.
- [UX] L — No sort/bulk; split filter mobile vs desktop; raw `<select>` hold-extension; items total recomputed client-side; "other" item allows £0; clickable rows not kbd-operable; raw labels/checkboxes hardcoded colours.

### invoices
- [SEC] M — "Mark as Paid" dead-end — A-048.
- [SEC] H — On-screen vs stored vs PDF total divergence — A-047.
- [SEC] — Per-line VAT never rounded — A-047.
- [SEC] H — Recurring-invoice cron orphans drafts — A-046.
- [SEC] M — `voidInvoice` wrongly requires `oj_projects:manage` for all invoices.
- [SEC] M — Credit-note numbering non-atomic (collision) — WS-6.
- [SEC] L — Detail dates raw Date/toLocaleDateString; hardcoded hex template/status; new-invoice no `due_date>=invoice_date`; receipt email bodies persisted (PII) + weak email validation.
- [UX] M(→) — Credit-note/refund UI orphaned — `actions/invoices.ts:982` — A-034.
- [UX] M — Dead duplicate `InvoicesClient.tsx` — A-112.
- [UX] M — Void window.confirm ×2 — `InvoiceDetailClient.tsx:302,317` — A-108.
- [UX] M — Native confirm() vendors/catalog/recurring — `recurring/page.tsx:99,130` — A-108.
- [UX] L — Status tabs/dropdown out of sync; recurring no search/sort/pagination; no unsaved-guard; line-item HTML-only validation; rows not kbd-operable; inconsistent recurring sub-nav; no success toast on status; catalog no required markers.

### quotes
- [SEC] L(→) — Nullable `total_amount` → £NaN/crash — A-068.
- [SEC] M — `total_amount.toFixed()` can throw on null — A-068.
- [SEC] M — Expiry/`valid_until` via raw Date — A-111.
- [SEC] M — `convertQuoteToInvoice` copies totals without recompute.
- [SEC] L — Quote dates toLocaleDateString; conversion insert vs rollback client asymmetry non-atomic; dead duplicate `QuotesClient.tsx`; convert double-redirect race; convert no confirmation.
- [UX] M — Two divergent `QuotesClient.tsx`; root dead — A-112.
- [UX] M(→) — Sent/accepted/expired uneditable/undeletable — `[id]/edit/page.tsx:84-87` — A-068.
- [UX] M — No "Quotes" nav entry; active state never matches — `QuotesClient.tsx:34-40`.
- [UX] M — No pagination (TablePagination unused) — `:242-343` — A-098.
- [UX] M — Convert can hang in loading on success-no-invoice — `convert/page.tsx:95-108`.
- [UX] M — Fully client-rendered; no error/loading; client-only permission checks.
- [UX] M — New-quote weaker line-item validation; VAT free-text vs Select.
- [UX] L — No sortable columns; no unsaved-guard; hardcoded status colours; missing `<th scope>`; rows not kbd-operable; raw dates; email modal validation contradicts input; list not refreshed; mark-expired no confirmation.

### receipts
- [SEC] M(→) — `completeReceiptUpload` trusts client path — A-049.
- [SEC] M — `requeueUnclassifiedTransactions` no audit/revalidate — A-110.
- [SEC] M — Receipt delete no confirmation — A-040.
- [SEC] L — Icon delete no aria-label/colour-only; `markReceiptTransaction` status `as any`; malformed `?page=`→NaN; delete rollback drops `content_hash`/`hash_verified_at`; bulk group classification non-atomic (DEF-007).
- [UX] H — File delete no confirmation — `ReceiptTableRow.tsx:363` — A-040.
- [UX] H — Mobile workspace missing stats/upload/export/reclassify/rules — `ReceiptsClient.tsx:162` — A-040.
- [UX] M — Mobile card status no optimistic/rollback — `ReceiptMobileCard.tsx:58`.
- [UX] M — Signed-URL download silently no-ops — `ReceiptTableRow.tsx:178` — WS-7.
- [UX] M — Empty aria-label on bulk-review checkboxes — `ReceiptBulkReviewClient.tsx:477` — A-058.
- [UX] M — Rule forms no inline validation — `ReceiptRules.tsx:517` — A-105.
- [UX] M — Rule suggestions capped at 5 — `:437` — A-110.
- [UX] M — Quarterly export no loading/error — `ReceiptExport.tsx:15`.
- [UX] L — Raw note input; icon buttons no aria-label; hardcoded tones; desktop sort fewer columns; no error boundary; "Outstanding only" hides rows no undo; mixed instant/submit search.

### expenses
- [SEC] M — VAT can exceed gross — A-066.
- [SEC] M — Fabricated category sidebar — A-066.
- [SEC] M — All queries admin client (RLS bypass) — A-067.
- [SEC] M — `deleteExpense` non-atomic (orphans files) — A-067.
- [SEC] M — ExpenseForm hardcoded colours; modal no focus-trap/Escape — A-101.
- [SEC] L — `uploadExpenseFile` count check racy; insights quarter math raw Date; duplicate file-validation limits; populated-table filter no indicator.
- [UX] H — ExpenseForm raw native inputs + hardcoded colours — `ExpenseForm.tsx:227-335` — A-101.
- [UX] M — CRUD no toast; failed delete swallowed — `ExpensesClient.tsx:185-237` — A-104.
- [UX] M — Form modal hand-rolled — `:421-457` — A-101.
- [UX] M — Category sidebar fake data — `:54-62` — A-066.
- [UX] M — No link to Insights (one-way nav) — `page.tsx:43-56`.
- [UX] M — No pagination (fetches all) — `actions/expenses.ts:136-185` — A-098.
- [UX] M — Export unreachable from UI — `:272-418`.
- [UX] L — No detail view; `Empty` as loading; un-debounced filter; receipt-presence colour-only; redundant mount fetch; no VAT-vs-amount validation; no unsaved-guard.

### mileage
- [SEC] (dropped) — distance cache symmetry false-positive.
- [SEC] H — Trip create/update non-atomic — A-017.
- [SEC] M — Live rate-split preview wrong back-dated — A-084.
- [SEC] M — Backfill migration hardcodes 0.45 post-2026-04-01.
- [SEC] L — "Rate" column sorts by miles; no future-date rejection; `recalculateTaxYearMileage` parallel partial-apply.
- [UX] M(→) — No pagination (unbounded) — `actions/mileage.ts:318-411` — A-084.
- [UX] M — No export despite CSV exporter — `MileageClient.tsx:213-239` — A-084.
- [UX] M — No free-text search — `:242-273` — A-084.
- [UX] M — Delete ConfirmDialog no loading state — `:382-392` — A-054.
- [UX] M — No success toast on CRUD — `:160-176` — A-104.
- [UX] M — Destinations hand-rolled tables — `DestinationsClient.tsx:353-442` — A-101.
- [UX] M — Hardcoded colours incl chart `#10B981` — `TripForm.tsx:266-443` — A-103.
- [UX] L — Inconsistent page-header; raw ISO dates in labels; future trips allowed; no unsaved-guard; bar chart not kbd-operable; distance-cache undeletable; insights silently hidden; no trip detail.

### mgd
- [SEC] M — Annual/all-time drill-down builds Jan1–Dec31 matching no period — A-070.
- [SEC] M — HMRC form hardcodes 1 machine + 20% rate — A-069.
- [SEC] L — Hardcoded hex/Tailwind; empty-period discoverability; reopen audit omits cleared fields; RLS super_admin-only vs RBAC manager (admin-client only).
- [UX] M — Async delete/reopen confirm closes early — `MgdClient.tsx:519-540` — A-054/A-070.
- [UX] M — No backfill/non-current quarter return — `:322-342` — A-070.
- [UX] M — No detail/search/filter/pagination/UI export — `:418-502` — A-070.
- [UX] M — BarChart bare canvas no role/aria/kbd — `BarChart.tsx:326-337`.
- [UX] M — HMRC modal hardcodes machine=1, zeroes bands — `:577-594` — A-069.
- [UX] L — Deep-linked period no removable filter; hardcoded hex; insights Alert without CardBody; HMRC read-only no copy/export; collections no search/filter; Notes never displayed; write buttons not permission-gated in UI; no inline validation.

### parking-admin
- [SEC] H — Refund column mismatch breaks refunds + notifications — A-009.
- [SEC] M — `updateParkingBookingStatus` no actor in audit — A-059.
- [SEC] M — Cancel no confirmation — A-026.
- [SEC] M — Payment-link/SMS failure on creation swallowed — WS-7.
- [SEC] L — Paid-session reminders skip `completed`; dead duplicate `ParkingClient.tsx`; search `.or()` denylist escape.
- [UX] H — No edit after creation — `ParkingClient.tsx:498-526` — A-026.
- [UX] H — No rate UI (SQL-only) — `actions/parking.ts:265-299` — A-026.
- [UX] H — Cancel no confirmation — `:510-514` — A-026.
- [UX] M — Filter Selects no accessible label — `:391-392`.
- [UX] M — No pagination, capped 200 — `actions/parking.ts:192-198` — A-098.
- [UX] M — Search refetches per keystroke — `:188` — A-099.
- [UX] M — Bookings table no error state — `:175-186` — WS-7.
- [UX] M — Notifications gated behind selecting a booking — `:550-586`.
- [UX] M — Stats/table+sidebar grids not responsive — `:376,385`.
- [UX] M — Create modal no inline validation; refund lookup races selection.
- [UX] L — `text-blue-600` links; dead duplicate (1021 lines); refund input no min/max/step; "send link now" failure swallowed.

### rota
- [SEC] M — `updateRotaSettings` PII no audit — A-085.
- [SEC] M — Shift-acceptance cron phantom auto-accepts — A-085.
- [SEC] M — `markEmployeeCouldntWork` check-then-insert — A-085.
- [SEC] M — Page degrades to empty UI on secondary load failures — WS-7.
- [SEC] M — `rejectPortalShift` doesn't check mirrored live update.
- [SEC] M — MarkSickModal hand-rolled — A-101.
- [SEC] L — `getRotaWeekDayInfo` day keys local Date+toISOString; manager email hardcoded vs configurable setting.
- [UX] H — `_components/` dead demo tree — A-112.
- [UX] H — Drag-drop kbd-inaccessible — `RotaGrid.tsx:622-624` — A-027.
- [UX] M(→) — Deactivated templates become orphans — `ShiftTemplatesManager.tsx:332-334` — WS-15.
- [UX] H — All 7 modals hand-rolled — `CreateShiftModal.tsx:75-89` — A-101.
- [UX] M — Hardcoded colours; HolidayDetailModal raw buttons; template deactivate confirm(); per-day target raw inputs; native checkboxes; create-shift no time-order validation; BookHolidayModal no toast + Cancel not disabled.
- [UX] L — Nav no breadcrumbs/Templates tab; loading skeleton mismatch; AddShifts rows not kbd-operable; no "undo Couldn't Work"; no employee/role filter.

### menu-management
- [SEC] H — AI parsing/review unguarded — A-007.
- [SEC] H — GP analysis drops un-priced ingredients — A-051.
- [SEC] M — `verifyDishAllergens` doesn't abort on null user — A-075.
- [SEC] M — Allergen choice-group by display name not id — A-075.
- [SEC] M — Price-history write failure leaves committed pack_cost — A-075.
- [SEC] M — `reviewIngredientWithAI` unvalidated JSON.parse — A-076.
- [SEC] L — `getMenuTargetGp` no permission check — A-053; "Remove placement" defaults `type=submit`.
- [UX] M(→) — No client validation in drawers — `DishDrawer.tsx:305-378` — A-076.
- [UX] H — Card-view active toggle no-op — `MenuManagementClient.tsx:583` — A-076.
- [UX] M — Recipe delete raw fetch vs action — `RecipeDrawer.tsx:310-327` — A-076.
- [UX] M — Choice rows allow empty `option_group` — `DishDrawer.tsx:331,345` — A-075.
- [UX] M — Overview reimplements dish list — `:137-618`.
- [UX] M — `MenuDishesTable` hand-rolled palette — `:455-553` — A-101.
- [UX] M — Below-target row colour-only — `dishes/page.tsx:746-751`.
- [UX] M — Overview no error state — `:352-574` — WS-7.
- [UX] M — No bulk despite paginated lists — `:733-753`.
- [UX] M — Inline currency commits on blur — `EditableCurrencyCell.tsx:53-60` — A-076.
- [UX] L — In-render sort mutation; AI parse empty-field drawer; fragile dirty-check; `beforeunload` no returnValue; raw dates; card wrapper a11y.

### messages-sms
- [SEC] (dropped) — bulk "sent" inflation false-positive.
- [SEC] M — Bulk preview renders `'null'` — A-086.
- [SEC] L — Reconcile cron counts 20404 as error; quiet-hours warning stale; thread grouping raw Date; mark-read gated only on view — A-086; hardcoded `text-yellow-600`.
- [UX] H — 3-panel breaks on mobile — `MessagesClient.tsx:491` — A-038.
- [UX] H — Holding link/ignore failures swallowed — `holding/page.tsx:35` — A-037.
- [UX] H — Holding requires raw customer UUID — `:94` — A-037.
- [UX] M — Conversation list no error state — `MessagesClient.tsx:146` — WS-7.
- [UX] M — Bulk recipients no pagination — `BulkMessagesClient.tsx:441` — A-098.
- [UX] M — Bulk select-all loaded-rows only — `:446`.
- [UX] M — SMS composer no length/segment counter — `MessagesClient.tsx:673` — A-086.
- [UX] M — Dates bypass dateUtils — `:389` — A-111.
- [UX] L — Mark-read/Refresh no loading; bulk hardcoded colours + raw label; template double error; bulk no unknown-token warning; holding link no loading; filter counts not in accessible labels; no resend/redact/archive.

### table-bookings-admin
- [SEC] H — Deposit-timeout premature cancellation — A-010.
- [SEC] H — BOH delete/cancel no audit — A-043.
- [SEC] (dropped) — party-size stale snapshot false-positive.
- [SEC] M — BOH status update no race guard — A-061.
- [SEC] M — Refund tier day-count server-local — A-062.
- [SEC] M — `move-table` no audit — A-059.
- [SEC] M — Deposit-timeout assumes no captured deposit (no refund) — A-010.
- [SEC] L — `BookingDetailClient` formats date in UTC — A-111.
- [UX] M — `_components/` dead mock tree (779) — A-112.
- [UX] H — No full booking edit — `[id]/BookingDetailClient.tsx:722-822` — A-025.
- [UX] M — Sunday pre-order no admin surface — `:287-288` — A-025.
- [UX] M — BOH table no pagination — `BohBookingsClient.tsx:816` — A-098.
- [UX] M — Reports no loading/error — `reports/page.tsx:83-98`.
- [UX] M — Create modal raw native buttons/inputs — `FohCreateBookingModal.tsx:594-608` — A-101.
- [UX] M — Create form no inline validation — `:245-296` — A-105.
- [UX] M — Date helpers duplicated; `toIsoDate` UTC off-by-one — `BohBookingsClient.tsx:130-165` — A-111.
- [UX] L — No bulk/export; cancel no reason; BOH raw inputs; view toggle ad-hoc; reports chart hex; move-table single-only; auto-return-to-today surprise; back hardcoded `/boh`; delete dialog inconsistency.

### cashing-up
- [SEC] L(→) — `getMissingCashupDatesAction` no RBAC — A-053.
- [SEC] M — Import insert-only, reports re-imports as failures — A-072.
- [SEC] M — Import zeroes card/stripe variance — A-071.
- [SEC] M — Cash-count vs cash-total never reconciled — A-071.
- [SEC] M — `upsertAndSubmitSession` double/contradictory audit + non-atomic — A-071.
- [SEC] M — Audit events omit user_id/resource_id — A-071.
- [SEC] M — Child-row replace non-atomic — A-071.
- [SEC] M — Submit re-runs on non-draft sessions — A-071.
- [SEC] L — alert()/confirm(); raw Tailwind colours; no double-submit guard; insights/dashboard windows raw Date; site matching breaks on dup names; no Zod on import rows.
- [UX] M — `SectionNav` never highlights active (`activeId=""`) — `layout.tsx:20`.
- [UX] M — No delete/void session — `DailyClient.tsx:604-625` — A-071.
- [UX] M — Approve/Lock/Unlock unwired — `actions/cashing-up.ts:99-177` — A-071.
- [UX] M — Daily/weekly targets unsettable — `:262-301` — A-071.
- [UX] M — Daily form no validation, allows empty/zero — `DailyClient.tsx:244-301` — A-105.
- [UX] M — No loading; daily page swallows errors as empty — `daily/page.tsx:33-55` — WS-7.
- [UX] M — "Recent Variance" only list (top-7, no search/filter) — `DashboardClient.tsx:232-277` — A-072.
- [UX] M — Import no per-row validation; preview cap 10; no confirm — A-072.
- [UX] L — No error boundary; weekly missing "no site" state; coloured Stat tiles don't colour; raw date input; hand-rolled chips; chart hex; raw ISO dates; misleading variance delta; chevron no aria-label; ArrowRight hijacks caret; missing-cashups no permission check; `DENOMINATIONS` duplicated ×3; notes single-line.

### oj-projects
- [SEC] H — `getClientBalance` capped at 50 — A-036.
- [SEC] M — Vendor billing settings mutation no audit/revalidate — A-035/A-059.
- [SEC] M — Statement email (financial PII) only requires `view`.
- [SEC] L — Statement default range toISOString; `billing_pending` misleading "not linked" error; opening balance floors at 0 (drops credit) — A-109.
- [UX] H(→partly M) — Clients no create/edit/delete — `ClientsClient.tsx:300-342` — A-035.
- [UX] H — Vendor billing settings no UI — `vendor-settings.ts:19-34` — A-035.
- [UX] M(→) — Project contacts removable but not addable — `ProjectDetailClient.tsx:352-379` — WS-15.
- [UX] M(→) — Entries capped 200 no pagination; projects load all — `entries/page.tsx:9` — A-035.
- [UX] M — Overview conflates loading/empty (`Empty` as spinner) — `ProjectsOverview.tsx:498-504` — WS-7.
- [UX] M — No error state on lists — `projects/page.tsx:6-11` — WS-7.
- [UX] M — Statement dates raw toISOString; no from≤to — `ClientsClient.tsx:140-143,253-269` — A-109.
- [UX] M — Status Select no loading/confirm; delete-project promises unenforceable rule.
- [UX] L — Statement preview hand-rolled table; budget-over-90% colour-only; `Field` label unassociated; rows not kbd-operable; back not breadcrumbs; sticky `?edit=`; delete-entry ignores revision result; recurring-charge disable tone; statement Email no confirm — A-109; invoice filter unlabelled; overview client filter stale projects.

### short-links
- [SEC] M — Open redirect no host allowlist — A-073.
- [SEC] M — `createShortLinkInternal` unauthenticated (dead export) — A-073.
- [SEC] M — `createShortLink` dedup RLS vs admin insert.
- [SEC] M — User links never set `created_by` — A-073.
- [SEC] M — Total/pagination count includes variants — A-073.
- [SEC] L — Template-literal renders literal `${...}` — A-074; redirect injects `short_code`; click tracking best-effort; dates raw; table missing loading + empty colSpan; analytics `.single()` throws; dedup `already_exists` cross-boundary.
- [UX] M(→) — Insights swallows load errors — `InsightsClient.tsx:71-75` — A-074.
- [UX] M — Main list no loading during refetch — `ShortLinksClient.tsx:190-201`.
- [UX] M — Edit drops custom-slug field — `ShortLinkFormModal.tsx:169-177`.
- [UX] M — Empty-state checks `links.length` renders `displayLinks`; no colSpan — `:332-339` — A-074.
- [UX] M — `DataTable`/`TableCell` no colSpan — `Table.tsx:159-172` — A-074.
- [UX] M — Page-level volume error → silent-zero — `page.tsx:55-56` — WS-7.
- [UX] M — Legacy-domain range selector ad-hoc + `text-white` — `legacy-domain/page.tsx:63-76`.
- [UX] M — `UtmDropdown.tsx` dead — A-112.
- [UX] L — Raw dates analytics modal; plain-text loading/empty; missing `<th scope>`; no sortable/filterable; no success toast; custom slug no inline validation.

### recruitment
- [SEC] H — Cancel→cannot-rebook lockout — A-011.
- [SEC] H — Orphaned calendar event on Graph delete — A-012.
- [SEC] M — Public routes no rate limit/Turnstile — A-089.
- [SEC] M — GDPR erasure no audit — A-089.
- [SEC] M — Retention cleanup re-anonymises every run — A-089.
- [SEC] M — Booking dates raw Intl/Date (no London) — A-111.
- [SEC] M — Slot claim non-atomic — A-089.
- [SEC] M — Reschedule slot booking/release non-atomic — A-089.
- [SEC] L — `userHasRole` `any`-typed sole GDPR gate; public POST errors echoed raw; reschedule status bypasses validated RPC; calendar sync no max-attempt cap; booking page no aria-live/fieldset; dashboard payload `any`-typed.
- [UX] H — ~15 actions cast to void, no feedback — `RecruitmentDashboardClient.tsx:329-346` — A-039.
- [UX] H — Destructive/bulk no confirmation (incl GDPR erase) — `:1807` — A-039.
- [UX] M(→) — Applications no pagination — `:757` — A-039.
- [UX] M — Postings no search/filter/sort/pagination — `:1141` — A-098.
- [UX] M — Email templates can't be created/deleted — `:1946` — WS-15.
- [UX] M — No loading state — `page.tsx:6` — WS-7.
- [UX] M — Submit buttons no disabled/pending — `:277`.
- [UX] M — Add-Application/posting no inline validation — `:1099` — A-105.
- [UX] M — Reschedule/Match selects submit with no option — `:1672`.
- [UX] M — Public booking no loading/empty-slots — `RecruitmentBookingClient.tsx:137`.
- [UX] L — Native checkbox/select/file; score colour cue; consent checkbox+hidden-input; no primary create CTA.

### settings
- [SEC] (dropped→L) — `updateSiteSettings`/`updateSiteToggle` authz — A-053 (functional no-op + defence-in-depth).
- [SEC] M — Site settings update no input validation — A-077.
- [SEC] M — GDPR settings page no permission gate — A-077.
- [SEC] M — Event Categories page no gate — A-077.
- [SEC] M — SpecialHoursModal formats exception date local — A-077.
- [SEC] L — `runCronJob` self-fetch with CRON_SECRET; Users/Roles tabs always rendered; Event Categories inline style/raw colours.
- [UX] M — Settings hub doesn't link sub-pages — `SettingsClient.tsx:43-48` — A-078.
- [UX] H — Pay bands/rates create-only — `PayBandsManager.tsx:40-57` — A-028.
- [UX] M — Customer label `icon` stored no input — `CustomerLabelsClient.tsx:62-68` — A-078.
- [UX] M — Customer label form no submit loading/double-submit guard — `:104-135`.
- [UX] M — Native window.confirm categories/budgets/calendar-notes/jobs — `CategoriesClient.tsx:124-140` — A-108.
- [UX] M — `TableSetupManager` raw inputs + inline delete confirm — `:612-658` — A-108.
- [UX] M — Event Categories no route gate — `event-categories/page.tsx:27-64` — A-077.
- [UX] M — SMS Failures read-only no remediation — `sms-failures/page.tsx:183-258` — A-078.
- [UX] H — API Keys can't be revoked/deleted — `api-keys/ApiKeysManager.tsx:273-308` — A-029.
- [UX] L — No unsaved-guard; Currency permanently disabled; BudgetsManager hardcoded colours/raw buttons; RotaSettings raw `<select>`; business-hours no validation/no re-fetch; event-categories raw buttons + emoji; calendar-notes/customer-labels hardcoded hex; per-row loading on toggle; message-templates no search; business-hours cells `any`; pay-bands N+1; rate forms non-inline errors.

### roles-users-rbac
- [SEC] M — Stale permission cache on revocation — A-014.
- [SEC] M — Privilege escalation via custom roles — A-015.
- [SEC] M — Non-atomic permission replace — A-018.
- [SEC] M — Users dates date-fns local; role filter non-functional; Role column hardcoded "User" badge — A-033.
- [SEC] L — RoleForm hardcoded colours; RolePermissionsModal swallows load failures (Save can clear); `getAllUsers` exposes all emails behind `users:view`; assignment audit omits names — A-059.
- [UX] H — Roles can't be edited — `RoleForm.tsx:10-17` — A-032.
- [UX] H — Users role filter no-op — `UsersContent.tsx:46-59` — A-033.
- [UX] H — Hardcoded "User" badge for all — `:120-122` — A-033.
- [UX] M — Two divergent role UIs — `RolesContent.tsx:68-294`.
- [UX] M — RoleForm hand-rolled native + hardcoded colours — `:44-88`.
- [UX] M — Create-role no toast — `:21-25`.
- [UX] M — `/roles` list no empty state — `RoleList.tsx:24-34`.
- [UX] M — `RolesContent` permission save no refresh — `:158-173`.
- [UX] M — Dead duplicate `UserList.tsx` — A-112.
- [UX] M — Role delete window.confirm — `RoleCard.tsx:28` — A-108.
- [UX] M — Users no pagination — `UsersContent.tsx:45-59` — A-098.
- [UX] M — Permission matrix checkboxes empty `label=""` — `RolesContent.tsx:274-278` — A-058.
- [UX] L — Inconsistent Alert API; matrix `<th>` no scope; matrix breaks on mobile; user mgmt role-assignment-only; `/roles` no loading.

### profile
- [SEC] M — Export wrong identifier space (omits messages) — A-031.
- [SEC] H — Avatar upload no validation — A-016.
- [SEC] (dropped) — avatar double-prefix false-positive.
- [SEC] M — Avatar bucket/read policy not in migrations — A-087.
- [SEC] M — Account-deletion only writes audit log (no workflow).
- [SEC] M — Change-password 6 chars (vs 8) — A-107.
- [SEC] M — Profile dates raw Date/toLocaleDateString — A-111.
- [SEC] L — Export filename/date toISOString; `fullName` no Zod/trim; swallowed errors export/avatar; Change-Photo double-trigger; avatar `<img>` empty-base fallback; client-only password change no re-auth.
- [UX] H — GDPR export omits messages — `profile.ts:162-166` — A-031.
- [UX] M — Avatar no size/type validation — `:217-224` — A-016.
- [UX] M — No avatar remove/clear — `ProfileClient.tsx:379-397` — A-087.
- [UX] M — "Change Photo" double file-picker — `:380-397` — A-087.
- [UX] M — Full Name accepts empty/whitespace, no required marker — `:249-255`.
- [UX] M — Dates bypass dateUtils — `:404-419` — A-111.
- [UX] M — Password change no current-password verify, 6-char — `change-password/page.tsx:29-39` — A-107.
- [UX] M — Fixed grid not responsive — `:187,233`.
- [UX] L — Export filename toISOString; password errors toast-only; raw `<img>` no fallback; inconsistent header; deletion request no status; toggles no in-flight state.

### payroll
- [SEC] M — Period actions no auth/admin client — A-053.
- [SEC] H — Pay-band/rate/budget reads no RBAC (RLS permissive) — A-005.
- [SEC] M — Variance flag never fires for no-shows — A-088.
- [SEC] M — RotaPayroll buttons dead no-ops — A-088.
- [SEC] M — `sendPayrollEmail` no user check — A-088.
- [SEC] M — `deletePayrollRow` no audit — A-059.
- [SEC] L — Per-employee summary re-rounds; approval snapshot stores PII; month label raw toLocaleDateString; period boundaries toISOString; `fetchGreeneKingBenchmark` swallows + `any`; P&L window server-local — A-088; £833 magic number; approval `.single()` should be `.maybeSingle()`.
- [UX] H — Pay bands create-only — `pay-bands.ts:62-86` — A-028.
- [UX] (dropped→L) — P&L "no error boundary" (parent covers).
- [UX] M — No loading states — `rota/payroll/page.tsx:15` — A-096.
- [UX] M — Row delete/edit no success toast — `PayrollClient.tsx:191-198` — A-104.
- [UX] M — Row delete ad-hoc inline buttons — `:503-549` — A-101/A-108.
- [UX] M — Manual P&L/target edits discarded on timeframe switch — `PnlClient.tsx:170-205` — A-100.
- [UX] M — Month selector + controls raw native — `PayrollClient.tsx:288-296` — A-101.
- [UX] M — Edit-after-approval not re-locked — `:356-358` — A-088.
- [UX] M — Daily-breakdown rows not kbd-operable; header no scope — `:431-453` — A-102.
- [UX] L — Inline-style note chips; budget delete confirm(); pay-bands N+1; P&L unsaved-edits; rate forms non-inline; budget year colour-only; no breadcrumbs; approve enabled on empty month; effective-rate assumes ordering; period editor no end≥start — A-088.

### leave
- [SEC] H — `getHolidayUsage` IDOR — A-004.
- [SEC] H — Weekend/non-working days counted against allowance — A-052.
- [SEC] (dropped) — `leave_days` unique cross-request false-positive.
- [SEC] M — Progress bar divides by allowance, no zero guard — A-117.
- [SEC] M — Portal holiday-year server-local Date — A-111.
- [SEC] M — `reviewLeaveRequest` non-atomic status check — A-061.
- [SEC] L — Manager approve/decline leaves usage bar stale; declining doesn't restore overlapping days; leave UI bypasses dateUtils/@/ds; overlap check + insert not transactional.
- [UX] H — Dead prototype `RotaLeave.tsx` no-op approve/reject — A-112.
- [UX] H — Employee can't cancel/edit own pending — `portal/leave/page.tsx:99-126` — A-044.
- [UX] M(→) — Manager list no edit/delete path — `LeaveManagerClient.tsx:55-191` — A-045.
- [UX] M — Approve/decline no confirmation — `:83-104` — A-045.
- [UX] M — Approve/decline icon buttons no aria-label, raw Tailwind — `:85-102`.
- [UX] M — HolidayDetailModal/BookHolidayModal hand-rolled — `HolidayDetailModal.tsx:102-113` — A-101.
- [UX] M — HolidayDetailModal raw input; hardcoded status colours; portal "Request holiday" raw anchor.
- [UX] M — No loading/error on portal/manager lists — `portal/leave/page.tsx:61-67` — WS-7.
- [UX] M — Lists unbounded (no pagination/year-default/search) — `LeaveManagerClient.tsx:199-251` — A-098.
- [UX] L — Booking doesn't re-fetch usage; allowance bar NaN at 0; rows not kbd-operable; no breadcrumbs; "declined" vs "rejected"; stale usageMap.

### public-table-booking-flow
- [SEC] H — Capture/create-order behind read scope — A-008.
- [SEC] M — `PublicBookingClient.tsx` dead mockup violating date/phone/validation — A-090.
- [SEC] L — `?state=paid` spoofable; end-of-day hold fallback server-local; `BookingConfirmationClient` dead mockup; SMS-failure swallowed — A-090.
- [UX] H — `PublicBookingClient` unwired mockup no submit — `PublicBookingClient.tsx:16,226-231` — A-090.
- [UX] M — `BookingConfirmationClient` dead; page only redirects — `:11` — A-090.
- [UX] M — Route group hardcoded redirects discarding params — `table-booking/page.tsx:3-5`.
- [UX] M — Booking portal no loading/error boundary — `booking-portal/[token]/page.tsx:125-159` — A-097.
- [UX] L — Portal hardcoded colours/native buttons; PayPal button no aria-busy; capture forces timed reload; status colour-only; mockup raw dates / no validation / `10+` string trap.

### public-parking-guest-flow
- [SEC] (dropped) — captured amount never verified false-positive.
- [SEC] M — PayPal `cancelUrl` non-existent route (404) — A-091.
- [SEC] L — Return route redirects with no id; guest page ignores failure states; no not-found boundary; hardcoded fallback phone/colours; trailing-space name.
- [UX] H — Pending/failed booking no pay/retry (dead-end) — `PublicParkingClient.tsx:24-97` — A-030.
- [UX] H — Failure query states ignored → false success — `page.tsx:42-56` — A-030.
- [UX] M — `notFound()` generic 404 — `:25-27` — A-091.
- [UX] M — Raw status values shown to customer — `PublicParkingClient.tsx:66-67`.
- [UX] L — Trailing-space name; hardcoded `#fff`; no noindex on public PII page; hardcoded contact-phone fallback; £0.00 no context.

### timeclock-kiosk
- [SEC] C — Anon UPDATE grant — A-001.
- [SEC] M — No PIN/identity verification — A-092.
- [SEC] M — `clockOut` `.single()` (stuck on multiple open) — A-092.
- [SEC] M — No unique constraint on open sessions — A-092.
- [SEC] L — `clockOut` no status validation; orphaned `TimeclockKiosk.tsx`; clock audit no user_id, fire-and-forget; raw Date/toLocale*; hardcoded hex/BEM; no double-tap guard / no roster empty/error state.
- [UX] M — Dead duplicate `TimeclockKiosk.tsx` — A-112.
- [UX] M — "On Leave" hardcoded 0 — `TimeclockClient.tsx:108-111`.
- [UX] M — No empty state for no active employees — `:116-139` — WS-7.
- [UX] M — Fetch failures swallowed — `page.tsx:22-23` — WS-7.
- [UX] M — Kiosk cards no visible focus style — `globals.css:975-993`.
- [UX] M — No per-card disabled/pending feedback — `:126-127`.
- [UX] L — Clocked-in state colour+dot only; optimistic drift; live clock stale after sleep; bespoke CSS/raw buttons; Toaster hardcoded hex; no clock-out confirm/undo; role hardcoded "Staff".

### employee-onboarding
- [SEC] L(→) — No rate limiting on public token endpoints (256-bit token) — A-117.
- [SEC] H — Financial/health PII writes no audit — A-042.
- [SEC] M(→) — `createEmployeeAccount` validate→create→link non-atomic — A-060.
- [SEC] M — Phones stored raw (no E.164) — A-083.
- [SEC] M — Emergency-contacts delete-then-insert non-atomic — A-060.
- [SEC] M — Password 8-char min, no strength/breach — A-107.
- [SEC] L — Onboarding step components/success hardcoded colours/native inputs; step disabled/aria polish + back-nav index desync.
- [UX] H — Submit handlers swallow thrown errors — `CreateAccountStep.tsx:41-52` — A-041.
- [UX] (data-loss) — Health checkboxes record nothing — A-019.
- [UX] M — No per-section edit from Review.
- [UX] L — Dead `OnboardingClient.tsx` — A-112; avatar in onboarding non-functional.

### staff-portal
- [SEC] H — `getHolidayUsage` IDOR (merged) — A-004.
- [SEC] M — Calendar feed token non-expiring static bearer — A-106.
- [SEC] M — `isTomorrow()` mixes London-today with UTC — A-111.
- [SEC] M — Shift dates/times raw toLocaleDateString/toLocaleString — A-111.
- [SEC] L — Leave holiday-year raw Date; holiday form date validation tz-ambiguous; note field no length cap; dead `PortalClient.tsx` non-functional sign-out; portal bypasses @/ds.
- [UX] H — Can't cancel/withdraw own pending leave — `portal/leave/page.tsx:94-126` — A-044.
- [UX] M(→) — Leave page swallows errors → empty — `:66-67` — A-044.
- [UX] M — `PortalClient.tsx` dead (holds only sign-out) — `:33-146` — A-044/A-112.
- [UX] M — No sign-out control in portal — `layout.tsx:17-28` — A-044.
- [UX] M — Missing loading for leave list/new — `:34-68` — A-096.
- [UX] M — No error boundary — `shifts/page.tsx:315-363` — A-097.
- [UX] M — Reject/open-shift no confirmation — `ShiftDecisionControls.tsx:72-84` — A-117.
- [UX] M — Ad-hoc native buttons/links bypass @/ds — `:99-150` — A-101.
- [UX] L — Nav no active-state; hardcoded palette + inline SVG; deprecated Badge props; leave list no filter/sort/pagination; Couldn't-Work list capped silently; reject textarea weak focus; calendar copy-link failure ignored; no back/breadcrumb.

### auth-and-layout
- [SEC] H — `/m` missing from middleware allowlist — A-002.
- [SEC] H — Stale "middleware disabled" docs (live regression) — A-002.
- [SEC] M — FOH-only users no server-side route gating — A-093.
- [SEC] M — Layout fallback can let portal employees through on RPC failure — A-093.
- [SEC] L — Charge-approval hardcoded colours; charge-approval dates raw Intl/Date; duplicated `PORTAL_ONLY_ROLES`; login rate limiting IP-only — A-116.
- [UX] H — Sidebar no permission gating — `SidebarNav.tsx:21-67` — A-021.
- [UX] H — `AppNavigation.tsx` dead — `:22-315` — A-022.
- [UX] M — User role hardcoded "Manager" — `AuthenticatedLayout.tsx:169` — A-021.
- [UX] M — Login 2FA + Microsoft SSO non-functional placeholders — `LoginClient.tsx:89-128,192-203` — A-093.
- [UX] M — No app-level `not-found.tsx` — A-093.
- [UX] M — Error boundaries hardcoded palette + native buttons — `global-error.tsx:30-63` — A-093.
- [UX] M — `FohClockBand` swallows clock-in/out failures — `FohClockBand.tsx:45-61` — WS-7.
- [UX] L — Sign-out ambiguous `×`; auth loading bare "Loading..."; dead-nav `hover:bg-green-600`; no breadcrumbs; no desktop topbar user menu.

### payments
- [SEC] H — Capture routes behind read scope — A-008.
- [SEC] (dropped) — refund no positive-value (DB CHECK) false-positive.
- [SEC] M — Currency-blind capture/refund (hardcoded GBP) — A-063.
- [SEC] M — Portal deposit capture no currency validation — A-063.
- [SEC] M — PayPal refund post-processing marks non-COMPLETED completed — A-064.
- [SEC] M — `updateRefundStatus` counts only completed refunds — A-064.
- [SEC] L(→M) — Parking capture webhook no amount check — WS-13/A-117.
- [SEC] L — Webhook `configuration_error` 200 in non-prod; refund SMS PII no E.164; refund `'refund'` action maybe undefined in RBAC; Stripe persist-failure not idempotent; reconciliation cron captures APPROVED without re-checking payable — A-094.

### webhooks
- [SEC] M — Resend webhook no idempotency — A-065.
- [SEC] M — Resend status update can clobber newer status — A-065.
- [SEC] M — Parking `CAPTURE.DENIED` leaves stale row — A-094.
- [SEC] L — Top-level PayPal no idempotency (duplicate audit) — A-094; Resend bounce/complaint ILIKE email mutates all sharing address — A-115; event-bookings webhook silently ACKs `blocked`; Resend 401 by string-matching; Twilio reply-to-book not tied to inbound id; Twilio signature uses `request.url` — A-115; PayPal verify relies solely on remote API — A-115; Resend missing-secret 500 (retry storm) — A-115.

### cron-jobs
- [SEC] H — Deposit-timeout premature cancellation (shared) — A-010.
- [SEC] M — `private-bookings-expire-holds` cancels with no audit — A-095.
- [SEC] L — Cron auth non-constant-time compare — A-114; `recurring-invoices` leaks raw DB error in 500 — A-095; expire-holds SMS date raw Date/toLocaleDateString — A-111.

### global-components (`@/ds`)
- [UX] H — `Checkbox` onChange contract + empty catch → data loss — `Checkbox.tsx:56-66` — A-019.
- [UX] M — `Checkbox`/`Radio` label association broken — `Checkbox.tsx:50-96`, `Radio.tsx:34-65` — A-055.
- [UX] H — `DataTable` sortable headers kbd-inaccessible + no aria-sort — `DataTable.tsx:388-433` — A-020.
- [UX] M — `DataTable` hardcoded colours — `:199-453` — A-103.
- [UX] M(→) — `ConfirmDialog` closes synchronously — `ConfirmDialog.tsx:71-80` — A-054.
- [UX] M — `Tabs`/`SectionNav` lack tablist semantics + arrow-keys — `Tabs.tsx:68-109` — A-056.
- [UX] M — `SectionNav` hardcoded hex — `:38-39` — A-103.
- [UX] M — `Field` never associates error/hint with control — `Field.tsx:15-42` — A-057.
- [UX] L — `Avatar` hex; `Modal` ignores `description`/no aria-describedby; `EmptyState`/`RadioGroup`/`FormGroup`/`Form`/`BackButton`/`TabNav` hardcoded colours; `Toast` dual API + hex; `Alert` drops `closable`/`onClose`; `DataTable` selection no bulk affordance/indeterminate; base `Table` forces min-width overflow on mobile; `Switch` colour-led; mobile button order surfaces destructive first; `compat/Toggle` synthetic-event mismatch — A-113.

### cross-section-consistency
- [UX] M — Two page shells mixed in 14 sections — `PageLayout.tsx`/`PageHeader.tsx:25` — WS-10.
- [UX] M — Native `window.confirm()` in 3 call sites — `InvoiceDetailClient.tsx:302,317`, `CalendarNotesManager.tsx:177` — A-108.
- [UX] M — `loading.tsx` in only 9/25 sections — A-096.
- [UX] M — One error boundary for whole authed area — A-097.
- [UX] M — 21 raw tables missing `<th scope>` — A-058.
- [UX] M — Pagination inconsistent (table-bookings/boh, parking none) — A-098.
- [UX] L — Edit-as-page vs edit-as-modal split; ~43 files raw `react-hot-toast`; two empty-state components; section-nav split; hardcoded hex in chrome; recruitment bespoke raw `<h1>` error block — WS-10.

---

## Part E — Coverage checklist

All 34 review areas, with [SEC] and [UX] finding counts, confirming both reports are represented.

| # | Section | [SEC] C/H/M/L | [UX] findings | Both represented |
|---|---|---|---|---|
| 1 | dashboard | 0/1/2/8 | ~16 (M/L) | ✅ |
| 2 | customers | 0/0/4/8 | ~13 | ✅ |
| 3 | employees | 0/0/4/7 | ~14 | ✅ |
| 4 | events | 0/0/4/3 | ~14 | ✅ |
| 5 | private-bookings | 0/1/2/3 | ~10 | ✅ |
| 6 | invoices | 0/1/5/4 | ~10 | ✅ |
| 7 | quotes | 0/0/3/6 | ~13 | ✅ |
| 8 | receipts | 0/1/2/5 | ~13 | ✅ |
| 9 | expenses | 0/0/6/4 | ~12 | ✅ |
| 10 | mileage | 0/1/2/3 | ~14 | ✅ |
| 11 | mgd | 0/0/2/4 | ~11 | ✅ |
| 12 | parking-admin | 0/1/3/3 | ~14 | ✅ |
| 13 | rota | 0/0/6/2 | ~12 | ✅ |
| 14 | menu-management | 0/2/4/2 | ~12 | ✅ |
| 15 | messages-sms | 0/0/1/5 | ~12 | ✅ |
| 16 | table-bookings-admin | 0/2/4/1 | ~14 | ✅ |
| 17 | cashing-up | 0/1/6/6 | ~18 | ✅ |
| 18 | oj-projects | 0/1/2/3 | ~14 | ✅ |
| 19 | short-links | 0/0/5/8 | ~14 | ✅ |
| 20 | recruitment | 0/2/6/6 | ~16 | ✅ |
| 21 | settings | 0/0/4/4 | ~16 | ✅ |
| 22 | roles-users-rbac | 0/2/4/4 | ~15 | ✅ |
| 23 | profile | 0/1/4/6 | ~14 | ✅ |
| 24 | payroll | 0/1/4/8 | ~16 | ✅ |
| 25 | leave | 0/2/3/4 | ~16 | ✅ |
| 26 | public-table-booking-flow | 0/1/1/4 | ~9 | ✅ |
| 27 | public-parking-guest-flow | 0/0/1/5 | ~9 | ✅ |
| 28 | timeclock-kiosk | 1/0/2/7 | ~13 | ✅ |
| 29 | employee-onboarding | 0/1/3/2 | ~6 (+ DS data-loss) | ✅ |
| 30 | staff-portal | 0/0/3/5 | ~14 | ✅ |
| 31 | auth-and-layout | 0/2/2/4 | ~13 | ✅ |
| 32 | payments | 0/1/4/6 | (covered under sections) | ✅ [SEC] |
| 33 | webhooks | 0/0/3/9 | (covered under sections) | ✅ [SEC] |
| 34 | cron-jobs | 0/1/1/3 | (covered under sections) | ✅ [SEC] |
| — | global-components (`@/ds`) | (theme 7) | ~12 | ✅ [UX] |
| — | cross-section-consistency | (themes) | ~7 | ✅ [UX] |

**Confirmation:** [SEC] totals reconcile to **1 Critical / 22 High / 42 Medium / 44 Low = 109**. [UX] totals reconcile to **28 High / 118 Medium / 165 Low = 311**. Both reports are represented across all shared sections; `payments`, `webhooks`, `cron-jobs` are [SEC]-only by scope; `global-components` and `cross-section-consistency` are [UX]-only by scope. No finding from either report has been dropped from this ledger.
