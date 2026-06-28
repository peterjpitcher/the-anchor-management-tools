# AMS Remediation — Validation Report

**Date:** 25 June 2026
**Branch:** main
**Actions sampled:** 29

## Overall verdict: PASS WITH CONCERNS

Code-level verification was run against 29 remediation actions. Of these, **25 pass cleanly** (implemented and correct), **3 carry concerns** (implemented but with caveats, or partially implemented), and **1 was not done** (A-112, dead-code removal).

**Correction after direct re-check (supersedes the original A-112 verdict below):** A-112 is a **P3 cleanup miss, not a production defect**. The `DEMO_*` data lives in dead `_components` files that **no live route imports** — live `rota/page.tsx` renders `RotaGrid`/`RotaPublishStatus`, and live `customers/page.tsx` imports `_components/CustomersClient`. A repo-wide grep found no live import of the `rota/_components` or `table-bookings/_components` trees. **Production does not render demo data.** The only user-facing residue is a minor loss of column sorting on the customers list, plus orphaned duplicate files still in the tree.

| Result | Count |
|---|---|
| Pass (implemented + correct) | 25 |
| Concerns (partial or correct=concerns) | 3 |
| Fail (missing or correct=no) | 1 |
| **Total** | **29** |

Of the 3 concerns, 1 is a `partial` status (A-047).

---

## Per-action results

### Passes

| Action | Status | Correct | Evidence (summary) |
|---|---|---|---|
| A-001 | implemented | yes | Migration drops `anon_clock_out` policy and revokes anon UPDATE on `timeclock_sessions`, exactly reversing the original grant. Kiosk clock-out is unaffected as it runs through the service-role admin client. Anon retains INSERT-only for the FOH page. |
| A-003 | implemented | yes | `daily-summary.ts` adds a real RBAC gate (events/private_bookings/table_bookings view) before any PII-bearing fetch or return. Fails closed; module strings match the `PermissionModule` type. |
| A-004 | implemented | yes | `getHolidayUsage` now gates on `leave:view` with a genuine own-record fallback (`isOwnEmployeeRecord`) before the parallel DB fetches. Consistent with the established pattern in the file. |
| A-005 | implemented | yes | All financially sensitive read actions (pay bands, rates, pay settings, rate overrides, department budgets) call `checkUserPermission` before querying. Gate fails closed for unauthenticated users. |
| A-007 | implemented | yes | AI menu parsing (`parseIngredientWithAI`, `reviewIngredientWithAI`) gates on `menu_management:manage` before any OpenAI call. Correctly typed module/action. |
| A-008 | implemented | yes | Four external PayPal routes now require the new `payments:capture` scope (tightened from `read:events`). Backfill migration grants the scope to existing keys so the website key does not break; tests assert the new scope. |
| A-009 | implemented | yes | `refundActions.ts` parking branch embeds the correct `parking_bookings` columns (all verified to exist), so the refund query no longer errors and the notification path fires. |
| A-010 | implemented | yes | Table-booking deposit-timeout cron gates every cancellation on `hold_expires_at` at query, in-loop, and atomic UPDATE level, closing the capture-vs-cancel race. |
| A-011 | implemented | yes | Recruitment appointment cancel reopens the slot and clears `booking_token_used_at`, enabling rebooking. Cancelled appointments excluded from preview. |
| A-013 | implemented | yes | Private-booking refund `daysUntilEvent` now uses London-timezone string maths (DST-safe UTC-midnight day numbers) feeding the 30-day threshold. |
| A-014 | implemented | yes | Per-user permission cache keyed by tag; role-permission changes and role deletes load affected users before mutating and bust each user's tag. Action layer invokes the service methods. |
| A-015 | implemented | yes | `assignPermissionsToRole` enforces privilege containment (subset-of-actor) before mutating, preventing privilege escalation by a manager with `roles:manage`. |
| A-017 | implemented | yes | Mileage trip create/update wrapped in atomic PL/pgSQL RPCs (insert-before-delete, FOR UPDATE lock). Action code calls the RPCs and checks errors. |
| A-019 | implemented | yes | DS `Checkbox` `onChange` emits a typed boolean; empty try/catch removed. All onboarding consumers pass boolean callbacks. Data-loss path resolved. |
| A-020 | implemented | yes | DataTable sortable headers are native buttons with focus ring and correct `aria-sort` (ascending/descending/none) per WAI-ARIA. |
| A-031 | implemented | yes | `exportProfileData` resolves messages via the linked `customer_id` (correct join key), not `user.id`. Query errors surfaced. |
| A-050 | implemented | yes | Employee CSV export neutralises formula injection (apostrophe prefix) plus RFC-4180 quoting on every field. No bypass. |
| A-052 | implemented | yes | Leave allowance counting excludes weekends and configured non-working weekdays via `isCountedLeaveDate`; storage still records all calendar days for the rota overlay. |
| A-053 | implemented | yes | Four exported read actions (bulk customer labels, missing cashups, menu target GP, site settings) now re-check RBAC. Internal callers bypass the guarded action so no regression. |
| A-060 | implemented | yes | Seven multi-write flows migrated to atomic RPCs that are genuinely called and consumed (receipts, quote→invoice, customer import, emergency contacts, cashup, expense delete, menu ingredient). |
| A-061 | implemented | yes | Optimistic-concurrency guards: partial unique indexes (open timeclock session, couldn't-work marker), credit-note RPC, status-scoped WHEREs with affected-row checks — all used by application code. |
| A-065 | implemented | yes | Resend webhook idempotency via partial unique index on `svix_id` plus status-progression guard; duplicates short-circuit before processing. |
| A-073 | implemented | yes | Short-link destination allowlist (http/https + host allowlist) enforced on all write paths; redirect route only serves pre-validated destinations. Dead internal action wrapper secured (see concerns note below — not a defect). |
| A-094 | implemented | yes | Webhook status-progression guard (Resend) and pending→failed-only transition with terminal-state guards (PayPal parking); duplicate audits prevented by idempotency claim. |
| A-114 | implemented | yes | `cron-auth.ts` uses SHA-256 + `timingSafeEqual` for constant-time secret comparison; all 41 cron routes call `authorizeCronRequest`, no direct `===` on the secret. |

### Concerns

| Action | Status | Correct | Concern (summary) |
|---|---|---|---|
| A-018 | implemented | concerns | Permission/role replacement is diff-applied (non-destructive) rather than truly transactional. Insert and delete are separate round-trips; if one fails the other is not rolled back. Blast radius is small (one missed add/removal, not a full wipe) and the action accepted "RPC or diff-apply", so the bar is met — but "atomic" is technically inaccurate. |
| A-021 | implemented | concerns | Nav permission gating is correctly wired across desktop, mobile drawer, and bottom nav. However the "real role label" part is **not** done: `AuthenticatedLayout.tsx:169` still hardcodes `userRole="Manager"`, so every user is mislabelled "Manager". Cosmetic/misleading, not a privilege escalation. Also: no super_admin bypass in `hasPermission`, so super_admins need explicit permission rows for full nav. |
| A-047 | partial | concerns | Core per-line VAT rounding fix is correct in the shared calculator and matches screen + stored values (tests pass). But the **PDF templates** (`invoice-template.ts`, `invoice-template-compact.ts`) were not migrated to the shared rounded calculation, so individual PDF line totals can differ by a penny from the screen. Grand-total VAT still matches (uses stored value). The action required screen/stored/PDF agreement; the PDF per-line path is unmigrated and untested. |

### Failures

| Action | Status | Correct | Failure (summary) |
|---|---|---|---|
| A-112 | missing | no (P3) | Remediation **not done** on main, but **dead code only** (corrected). (1) Orphaned duplicate `customers/CustomersClient.tsx` (850 lines) still in the tree, dead and unimported. (2) The dead `rota/_components` and `table-bookings/_components` `DEMO_*` trees still exist but are **not imported by any live route** (verified by grep) — production renders the real components, so there is **no demo-data-in-production defect**. (3) Minor: the live customers list lost the sortable-column capability the orphan had. Regression risk: **low** — maintenance hazard + minor UX, not production correctness. |

---

## Concerns section

The following items require attention before this remediation can be considered fully complete.

1. **A-112 (NOT DONE — but P3, corrected).** The dead `rota/_components/RotaClient.tsx` and `table-bookings/_components/TableBookingsClient.tsx` demo trees, and the orphaned 850-line `customers/CustomersClient.tsx`, were never deleted. Re-check confirms **no live route imports them**, so this is a dead-code/maintenance hazard, **not** the production demo-data defect originally reported. The only user-facing item is the customers list losing column sorting. Recommend: port sorting into the live `_components/CustomersClient`, then delete the orphaned duplicates and demo trees.

2. **A-047 (PARTIAL).** Invoice PDF line-item VAT is not computed through the shared rounded calculation, so per-line totals on the PDF can disagree by a penny with the on-screen and stored figures. The grand total is safe. Recommend migrating `invoice-template.ts` and `invoice-template-compact.ts` to the shared `calculateInvoiceTotals`/`lineBreakdown` path and adding PDF-line test coverage.

3. **A-021 (CONCERN).** Every user is displayed as "Manager" because `AuthenticatedLayout.tsx:169` hardcodes the role label; `PermissionContext` exposes no role to plumb through. Misleading but not a security issue. Recommend wiring the genuine role through to the sidebar and drawer footers. Also confirm super_admins hold explicit permission rows for every module, since `hasPermission` has no super_admin bypass.

4. **A-018 (CONCERN).** Role-permission and user-role replacement is diff-applied rather than transactional. The worst case is now a single missed add or removal (not a full wipe), which is acceptable per the action's stated bar, but a single RPC would make the operation genuinely atomic and remove the partial-failure window. Optional hardening.

### Notes (non-blocking, no action required)

- **A-001:** Migration correctness confirmed at the file level; whether it has been applied to the live database cannot be verified from the repository.
- **A-073:** A dead, now-secured `createShortLinkInternal` action wrapper remains in the tree — gated and not exploitable, but deleting it would be cleaner.
- **A-052 / A-114:** Minor missing unit-test coverage for the weekend-exclusion boundary and noted dev-only cron auth bypass when `CRON_SECRET` is unset; neither is a defect.
