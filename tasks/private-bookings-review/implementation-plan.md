# Private Bookings Remediation — Implementation Plan

**Source:** [remediation-spec.md](remediation-spec.md)
**Date:** 2026-05-11
**Complexity score:** 5 (XL) — broken into 12 PRs across 4 waves

---

## Overview

22 active defects across 12 groups (D18 and D24 are already addressed in the current codebase). Organised into 12 PRs with explicit dependency ordering. Each PR is independently deployable and testable.

**Workspace note:** in this checkout, this plan currently exists under the Claude worktree, not the main worktree path `tasks/private-bookings-review/implementation-plan.md`. Copy or move the task directory into the target implementation worktree before starting if the work will happen outside `.claude/worktrees/affectionate-shamir-3d2513`.

**Baseline verification note:** `npx tsc --noEmit` currently has an unrelated pre-existing failure in `src/app/actions/quotes.ts` (`InvoiceService` is undefined). Treat that as a baseline blocker to resolve separately or document as unrelated when verifying these PRs.

**Wave model:** PRs are grouped into waves based on dependencies. All PRs within a wave can be developed in parallel. A wave's PRs must all land before the next wave starts.

```
Wave 1:  PR 1 (status guards)           — foundation for everything
Wave 2:  PR 2 (TBD), PR 3 (deposit),    — depend on PR 1 or independent
         PR 4 (revalidation), PR 5 (contract),
         PR 6 (query fix)
Wave 3:  PR 7 (SMS/cron), PR 8 (discounts), — depend on PR 1
         PR 9 (transaction safety)
Wave 4:  PR 10 (permissions), PR 11 (structural/RLS), — defer until core is stable
         PR 12 (tech debt)
```

---

## PR 1 — Status Guards & Editing Constraints

**Defects:** D4, D12, D13
**Branch:** `codex/fix-pb-status-guards`
**Risk:** Medium — changes the core update path
**Complexity:** 3 (M)

### Tasks

- [ ] **1.1** Extract `ALLOWED_TRANSITIONS` constant from `updateBookingStatus()` (mutations.ts:901-906) into `types.ts`
- [ ] **1.2** Add transition validation to `updateBooking()` (mutations.ts, after line 404) — check `input.status` against `ALLOWED_TRANSITIONS` for `currentBooking.status`
- [ ] **1.3** Add `cancellation_reason` and `cancelled_at` metadata when `updateBooking()` transitions to cancelled
- [ ] **1.4** Add immutable-booking guard to `updateBooking()` — compare the cleaned column payload, not raw `input`, so non-column helpers such as `date_tbd`, `items`, and `default_country_code` do not falsely count as edits
- [ ] **1.5** Add redirect in `edit/page.tsx` for completed/cancelled bookings → detail page
- [ ] **1.6** Replace hardcoded 4-option status dropdown in `edit/page.tsx` (lines 301-311) with `STATUS_OPTIONS[booking.status]` filtered array
- [ ] **1.7** Extend deposit status guard in `payments.ts` (line 324) to block both cancelled AND completed
- [ ] **1.8** Import `ALLOWED_TRANSITIONS` in `updateBookingStatus()` — remove the inline definition

### Files

| File | Change |
|------|--------|
| `src/services/private-bookings/types.ts` | Add `ALLOWED_TRANSITIONS` constant |
| `src/services/private-bookings/mutations.ts` | Transition validation + immutable guard + cancellation metadata in `updateBooking()`, import shared constant in `updateBookingStatus()` |
| `src/services/private-bookings/payments.ts` | Extend deposit guard to block completed |
| `src/app/(authenticated)/private-bookings/[id]/edit/page.tsx` | Redirect + filtered dropdown |

### Verification

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
```

Manual checks:
- [ ] Edit a draft booking → status dropdown shows Draft, Confirmed, Cancelled (not Completed)
- [ ] Edit a confirmed booking → dropdown shows Confirmed, Completed, Cancelled
- [ ] Navigate to `/private-bookings/{id}/edit` for a cancelled booking → redirects to detail
- [ ] Navigate to `/private-bookings/{id}/edit` for a completed booking → redirects to detail
- [ ] Via detail page: change cancelled → draft → succeeds
- [ ] Via detail page: attempt completed → draft → rejected
- [ ] Record deposit on completed booking → rejected with clear error
- [ ] Record deposit on draft booking → succeeds

---

## PR 2 — Date-TBD Lifecycle

**Defects:** D1
**Branch:** `codex/fix-pb-date-tbd-lifecycle`
**Risk:** Medium — changes booking creation + multiple consumers
**Complexity:** 4 (L) — touches many files and includes a migration
**Depends on:** PR 1 (status guards in `updateBooking()`)

### Design decision

Use a real `date_tbd boolean DEFAULT false` column. Do **not** use a sentinel date such as `9999-12-31`: `event_date` is required by the current schema, but sentinel dates leak into ordering, filters, calendar logic, contracts, SMS, and customer-facing pages unless every consumer is perfect.

The current live convention is `internal_notes` containing `DATE_TBD_NOTE`. The migration should backfill the new column from that note, and `isBookingDateTbd()` should temporarily support both the column and the note during rollout.

### Tasks

- [ ] **2.1** Write migration: add `private_bookings.date_tbd boolean NOT NULL DEFAULT false`, backfill from `internal_notes LIKE '%Event date/time to be confirmed%'`, and add it to `private_bookings_with_details`
- [ ] **2.2** Update `calculate_balance_due_date()` trigger to skip calculation when `NEW.date_tbd = true`; this is required because the existing trigger recalculates `balance_due_date` whenever `event_date` is set
- [ ] **2.3** Update `create_private_booking_transaction()` RPC to insert `date_tbd`; the service creates bookings through this RPC, so adding the column alone will not persist the flag
- [ ] **2.4** Modify `createBooking()` (mutations.ts:217): when `input.date_tbd` is true, persist `date_tbd = true`, keep a required placeholder `event_date`/`start_time`, set `hold_expiry = null`, and leave `balance_due_date = null`
- [ ] **2.5** Modify `sendCreationSms()` (mutations.ts:54): import `isBookingDateTbd()` from `tbd-detection.ts`, show "Date to be confirmed" instead of formatted date
- [ ] **2.6** Add TBD→real date transition in `updateBooking()`: when clearing TBD, set `date_tbd = false`, remove `DATE_TBD_NOTE`, compute `hold_expiry`, and set/allow recalculation of `balance_due_date`
- [ ] **2.7** Add real date→TBD transition in `updateBooking()`: when setting TBD, set `date_tbd = true`, add `DATE_TBD_NOTE`, clear `hold_expiry`, and set `balance_due_date = null`
- [ ] **2.8** Update cancellation SMS (mutations.ts:766): check `isBookingDateTbd()` before formatting event date
- [ ] **2.9** Update contract template (`contract-template.ts`): show "Date to be confirmed" when TBD
- [ ] **2.10** Update deposit/final-payment email inputs (`payments.ts`): fetch/select `internal_notes` and `date_tbd`, then pass TBD-aware date strings
- [ ] **2.11** Update detail page display (`PrivateBookingDetailClient.tsx`): show TBD badge and avoid fake date emphasis
- [ ] **2.12** Update list page display (`PrivateBookingsClient.tsx`): use `date_tbd`/`is_date_tbd` and show "TBD" instead of date
- [ ] **2.13** Update `src/lib/private-bookings/tbd-detection.ts` to treat `booking.date_tbd === true` as primary and `DATE_TBD_NOTE` as fallback
- [ ] **2.14** Verify expire-holds cron skips null `hold_expiry`; PR 7 will move expiry notification/cleanup into the service path

### Files

| File | Change |
|------|--------|
| `src/services/private-bookings/mutations.ts` | createBooking TBD branch, updateBooking transitions, cancellation SMS |
| `src/lib/private-bookings/tbd-detection.ts` | Prefer `date_tbd`, fallback to `DATE_TBD_NOTE` |
| `src/lib/contract-template.ts` | TBD-aware date formatting |
| `src/services/private-bookings/payments.ts` | TBD-aware email dates |
| `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx` | TBD badge |
| `src/app/(authenticated)/private-bookings/PrivateBookingsClient.tsx` | TBD display |
| `supabase/migrations/` | `date_tbd` column, trigger update, RPC update, view update |

### Verification

Manual checks:
- [ ] Create a TBD booking → `date_tbd = true`, `hold_expiry` is null, `balance_due_date` remains null after trigger execution
- [ ] TBD creation SMS says "Date to be confirmed"
- [ ] Wait for cron cycle → TBD booking is NOT cancelled
- [ ] Edit TBD booking to set real date → hold_expiry populated, balance_due_date recalculated
- [ ] Edit real-date booking to TBD → hold_expiry cleared
- [ ] Generate contract for TBD booking → "Date to be confirmed" in event date field
- [ ] Record deposit on TBD booking → email says "Date to be confirmed"

---

## PR 3 — Deposit Amount Enforcement

**Defects:** D3
**Branch:** `codex/fix-pb-deposit-exact-match`
**Risk:** Low — narrows accepted amounts
**Complexity:** 2 (S)

### Tasks

- [ ] **3.1** Change `finalizeDepositPaymentWithClient()` (payments.ts:332): enforce exact amount match for all paths, remove `requireAmountMatch` flag
- [ ] **3.2** Update deposit modal in `PrivateBookingDetailClient.tsx`: pre-fill amount as read-only, show required amount label

### Files

| File | Change |
|------|--------|
| `src/services/private-bookings/payments.ts` | Exact match enforcement |
| `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx` | Read-only deposit amount |

### Verification

- [ ] Manual deposit of £1 on £250 requirement → rejected
- [ ] Manual deposit of £250 → accepted
- [ ] Manual deposit of £300 → rejected (exact match)
- [ ] PayPal deposit with matching amount → accepted
- [ ] Payment history shows correct amount

---

## PR 4 — Revalidation & Stale Totals

**Defects:** D2, D8
**Branch:** `codex/fix-pb-revalidation-stale-totals`
**Risk:** Low — additive changes
**Complexity:** 2 (S)

### Tasks

- [ ] **4.1** Add `revalidatePath('/private-bookings')` after the financial mutation call sites around lines 953, 1017, 1142, 1483, 1510, 1529, 1548, 2099, 2151, and 2215 in `privateBookingActions.ts`; do not add it to the note-only action around line 443
- [ ] **4.2** Remove client-side cache (`CACHE_TTL_MS` and associated logic) from `PrivateBookingsClient.tsx`
- [ ] **4.3** Change deposit email (payments.ts:177) to fetch `calculated_total` from view
- [ ] **4.4** Change balance paid email (payments.ts:637) to use `calculated_total`
- [ ] **4.5** Change `scheduled-sms.ts` query (line 68) from `private_bookings` to `private_bookings_with_details`
- [ ] **4.6** Change booking portal query (`booking-portal/[token]/page.tsx:136`) to use view for `calculated_total`
- [ ] **4.7** Update portal balance calculation (line 169) to use `calculated_total`

### Files

| File | Change |
|------|--------|
| `src/app/actions/privateBookingActions.ts` | Add list revalidation to 10 locations |
| `src/app/(authenticated)/private-bookings/PrivateBookingsClient.tsx` | Remove client cache |
| `src/services/private-bookings/payments.ts` | Fetch `calculated_total` for emails |
| `src/services/private-bookings/scheduled-sms.ts` | Query from view |
| `src/app/booking-portal/[token]/page.tsx` | Query from view, fix balance calc |

### Verification

- [ ] Add item to booking → list page shows updated total immediately
- [ ] Record payment → list shows updated balance and status
- [ ] Edit/delete payment → list reflects change
- [ ] Deposit email shows item-derived total, not legacy `total_amount`
- [ ] Booking portal shows correct balance

---

## PR 5 — Contract Template

**Defects:** D5
**Branch:** `codex/fix-pb-contract-deposit-terms`
**Risk:** Low — text-only changes
**Complexity:** 1 (XS)

### Tasks

- [ ] **5.1** Replace "deposit must be paid in cash" (line 712) with payment-method-agnostic language
- [ ] **5.2** Remove "in cash" from agreement section (line 736)
- [ ] **5.3** Replace hardcoded "£250 cash deposit" in T&C (line 763) with dynamic amount reference
- [ ] **5.4** Replace "deposit becomes non-refundable" (line 770) with flexible cancellation policy language

### Files

| File | Change |
|------|--------|
| `src/lib/contract-template.ts` | Four text replacements |

### Verification

- [ ] Generate contract PDF → no "in cash", no "£250", no absolute refund promises
- [ ] Contract renders correctly (check PDF layout hasn't broken)

---

## PR 6 — Query Fix (Today in Both Tabs)

**Defects:** D14
**Branch:** `codex/fix-pb-today-query-overlap`
**Risk:** Low — one-line change
**Complexity:** 1 (XS)

### Tasks

- [ ] **6.1** Change `queries.ts` line 190: `lte('event_date', todayIso)` → `lt('event_date', todayIso)`

### Files

| File | Change |
|------|--------|
| `src/services/private-bookings/queries.ts` | `lte` → `lt` for past filter |

### Verification

- [ ] Create booking for today → appears in Upcoming only, not Past
- [ ] Yesterday's booking → appears in Past only

---

## PR 7 — SMS & Notifications

**Defects:** D6, D10, D11
**Branch:** `codex/fix-pb-sms-notifications`
**Risk:** Medium — cron changes + new server action
**Complexity:** 4 (L)
**Depends on:** PR 1 (status guards)

### Tasks

- [ ] **7.1** Add pending SMS cancellation to `cancelBooking()` (mutations.ts, after line 1027): update `private_booking_sms_queue` entries to cancelled
- [ ] **7.2** Add pending SMS cancellation to `updateBooking()` (mutations.ts, before line 766): same pattern for edit-form cancellations
- [ ] **7.3** Add pending SMS cancellation to `expireBooking()` as well; the dedicated expire-holds cron should not leave old reminders behind
- [ ] **7.4** Rewrite expire-holds cron (`route.ts`) to fetch eligible expired draft IDs, re-check non-TBD/positive-deposit eligibility, and call `PrivateBookingService.expireBooking(id, { sendNotification: true, asSystem: true })` per row rather than duplicating status/calendar/SMS logic in the route
- [ ] **7.5** Create `sendPrivateBookingSms()` server action in `privateBookingActions.ts`: use `SmsQueueService.queueAndSend()` so messages land in `private_booking_sms_queue`, set `trigger_type: 'manual'`, and check `private_bookings:send` or `private_bookings:manage`
- [ ] **7.6** Add/verify the `private_bookings:send` permission row and assignment for the role expected to send private-booking SMS
- [ ] **7.7** Update messages page/client to call new `sendPrivateBookingSms()` instead of the shared `sendSms()` action, which logs `booking_id` metadata instead of `private_booking_id` and does not populate the private-booking queue history

### Files

| File | Change |
|------|--------|
| `src/services/private-bookings/mutations.ts` | Pending SMS cleanup in cancel, status-change cancel, and expire paths |
| `src/app/api/cron/private-bookings-expire-holds/route.ts` | Fetch eligible rows and delegate to `PrivateBookingService.expireBooking()` |
| `src/app/actions/privateBookingActions.ts` | New `sendPrivateBookingSms()` action |
| `src/app/(authenticated)/private-bookings/[id]/messages/page.tsx` | Pass permission state for new action |
| `src/app/(authenticated)/private-bookings/[id]/messages/PrivateBookingMessagesClient.tsx` | Call new action instead of shared `sendSms()` |
| `supabase/migrations/` | Permission row/assignment if missing |

### Verification

- [ ] Cancel a booking with pending reminders → reminders marked as cancelled in `private_booking_sms_queue`
- [ ] Cancel via edit form → same cleanup happens
- [ ] New cancellation SMS still sends after cleanup
- [ ] Expire-holds cron: expired booking gets cancellation SMS
- [ ] Expire-holds cron: calendar event deleted for expired booking
- [ ] Send manual SMS from booking messages page → appears in booking SMS history
- [ ] User with `private_bookings:send` can send SMS
- [ ] User with only `private_bookings:view` cannot send SMS

---

## PR 8 — Discount Bounds

**Defects:** D9
**Branch:** `codex/fix-pb-discount-bounds`
**Risk:** High — migration changes generated column + view must be recreated
**Complexity:** 3 (M)

### Tasks

- [ ] **8.1** Add discount validation to `addBookingItem()` (mutations.ts:1502): negative check, percent > 100, fixed > line value
- [ ] **8.2** Modify `updateBookingItem()` (mutations.ts:1566): fetch full current item first, merge partial data, then validate bounds against effective values
- [ ] **8.3** Write migration: drop dependent `private_bookings_with_details` view, drop/recreate `line_total` generated column with `GREATEST(0, ...)`, then recreate the **latest** view definition from `20260527000000_fix_payment_system_security_and_balance.sql` so `calculated_total`, payment status, and discount-aware balance are preserved

### Files

| File | Change |
|------|--------|
| `src/services/private-bookings/mutations.ts` | Validation in add + update item |
| `supabase/migrations/` | Generated column + view recreation |

### Pre-flight checks

```bash
# Verify what references line_total
rg -n "line_total" src supabase/migrations
# Verify the view definition for recreation
rg -n "CREATE OR REPLACE VIEW public.private_bookings_with_details|CREATE VIEW public.private_bookings_with_details|get_booking_discounted_total|calculate_private_booking_balance" supabase/migrations
```

### Verification

```bash
npx supabase db push --dry-run  # Test migration locally first
```

- [ ] Add item with 150% discount → rejected
- [ ] Add item with fixed discount > line value → rejected
- [ ] Update only `discount_value` on existing item → validates against current quantity/price
- [ ] Reduce quantity such that existing discount exceeds new line value → rejected
- [ ] Existing valid items unaffected after migration

---

## PR 9 — Transaction Safety

**Defects:** D15, D16, D17
**Branch:** `codex/fix-pb-transaction-safety`
**Risk:** Medium — changes delete order + payment flow
**Complexity:** 2 (S)

### Tasks

- [ ] **9.1** Reverse delete order in `deletePrivateBooking()` (mutations.ts:1428): DB delete first, then calendar cleanup
- [ ] **9.2** Update `recordFinalPayment()` in `payments.ts` to select `final_payment_date`, then early-return if it is already set
- [ ] **9.3** Add optimistic lock to `recordFinalPayment()` in `payments.ts`: `.is('final_payment_date', null)` on update, and treat a no-row update as idempotent success without sending SMS
- [ ] **9.4** Add PayPal capture audit log before each `finalizeDepositPayment()` call in the browser-return path (`captureDepositPayment()` in `privateBookingActions.ts`) and the webhook path (`api/webhooks/paypal/private-bookings/route.ts`); if using `private_booking_audit`, set `performed_by` to the user id or `null`, not a literal `'system'` UUID

### Files

| File | Change |
|------|--------|
| `src/services/private-bookings/mutations.ts` | Reverse delete order |
| `src/services/private-bookings/payments.ts` | Final payment idempotency + optimistic lock |
| `src/app/actions/privateBookingActions.ts` | PayPal browser-return capture audit before finalization |
| `src/app/api/webhooks/paypal/private-bookings/route.ts` | PayPal webhook capture audit before finalization |

### Verification

- [ ] Delete booking when calendar API is down → DB record deleted, calendar orphaned (acceptable)
- [ ] Delete booking when DB trigger rejects → calendar event preserved
- [ ] Two concurrent final payment requests → only one succeeds, no duplicate SMS

---

## PR 10 — Permissions

**Defects:** D7
**Branch:** `codex/fix-pb-permission-inheritance`
**Risk:** Low — additive helper + UI gating
**Complexity:** 2 (S)
**Depends on:** PRs 1-7 landed (lowest risk of non-P4 items)

### Tasks

- [ ] **10.1** Create `hasPrivateBookingPermission(actions, required)` helper for page/UI checks that treats `manage` as broad access
- [ ] **10.2** Apply to all private-booking page permission checks
- [ ] **10.3** Update `requirePrivateBookingsPermission()` and direct `checkUserPermission('private_bookings', ...)` calls in `privateBookingActions.ts` so server actions also treat `manage` as broad access where intended; page-only inheritance is not enough
- [ ] **10.4** Gate item add/edit/delete buttons in `PrivateBookingDetailClient.tsx` behind `edit` permission
- [ ] **10.5** Audit exact high-risk permissions (`manage_deposits`, `generate_contracts`, `approve_sms`, refunds) and keep them exact unless the product decision is that `manage` should imply those too

### Files

| File | Change |
|------|--------|
| `src/services/private-bookings/` (new helper or in types.ts) | Private-booking permission helper |
| Various private-booking pages | Use new helper |
| `src/app/actions/privateBookingActions.ts` | Use server-side helper for manage inheritance |
| `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx` | Gate mutation UI |

### Verification

- [ ] User with `manage` → full access everywhere
- [ ] User with `view` → can see detail page, no edit/delete buttons
- [ ] User with `edit` → can edit items, cannot manage deposits

---

## PR 11 — Structural & RLS

**Defects:** D19, D20 (D18 already addressed)
**Branch:** `codex/fix-pb-structural-rls`
**Risk:** Low-Medium — migration + cron change
**Complexity:** 2 (S)

### Tasks

- [ ] **11.1** Remove duplicate hold expiry logic from `private-booking-monitor` (route.ts) — let `private-bookings-expire-holds` own it
- [ ] **11.2** Write migration: add UPDATE/DELETE RLS policies on `private_booking_payments` using `public.user_has_permission()`, add GRANT for authenticated role

### Files

| File | Change |
|------|--------|
| `src/app/api/cron/private-booking-monitor/route.ts` | Remove hold expiry pass |
| `supabase/migrations/` | RLS policies + GRANT |

### Pre-flight checks

```bash
# Verify payment modification code paths use admin client
rg -n "from\\('private_booking_payments'\\)" src | rg -v "select"
```

### Verification

```bash
npx supabase db push --dry-run
```

- [ ] Cron: only `private-bookings-expire-holds` cancels expired holds (not both crons)
- [ ] Auth-client payment edit attempt without `manage` permission → blocked by RLS
- [ ] Admin-client payment operations → unaffected

---

## PR 12 — Tech Debt

**Defects:** D21, D22, D23 (D24 already addressed)
**Branch:** `codex/chore-pb-tech-debt-cleanup`
**Risk:** Low — no functional changes
**Complexity:** 2 (S)

### Tasks

- [ ] **12.1** Do **not** blindly delete `feedback.ts`: current guest routes still import preview/submission functions from it. First decide whether `/g/[token]/private-feedback` should be retired immediately or kept for existing outstanding tokens.
- [ ] **12.2** If retiring the feedback flow, delete both guest feedback routes and the library together; if keeping outstanding-token support, keep `feedback.ts` and only remove unused generation/import paths from the monitor.
- [ ] **12.3** (Separate PR if preferred) Extract `PrivateBookingDetailClient.tsx` into sub-components
- [ ] **12.4** (Separate PR if preferred) Split `privateBookingActions.ts` by subdomain

### Files

| File | Change |
|------|--------|
| `src/lib/private-bookings/feedback.ts` | Keep or delete only with guest route decision |
| `src/app/g/[token]/private-feedback/page.tsx` | Delete only if retiring outstanding-token support |
| `src/app/g/[token]/private-feedback/action/route.ts` | Delete only if retiring outstanding-token support |
| `src/app/api/cron/private-booking-monitor/route.ts` | Remove retired feedback generation/import path if no longer needed |

### Verification

- [ ] Build passes with no import errors
- [ ] If routes are kept, existing private-feedback tokens still render/submit
- [ ] If routes are removed, no links/templates can still send customers to `/g/{token}/private-feedback`

---

## Dependency Graph

```
PR 1 (status guards) ─────────────────────────────────┐
  │                                                     │
  ├─→ PR 2 (TBD lifecycle)                             │
  │                                                     │
  ├─→ PR 7 (SMS/notifications) ←───────────────────────┤
  │                                                     │
  │   PR 3 (deposit) ──── independent ──────────────────┤
  │   PR 4 (revalidation) ── independent ───────────────┤
  │   PR 5 (contract) ──── independent ─────────────────┤
  │   PR 6 (query fix) ──── independent ────────────────┤
  │   PR 8 (discounts) ──── independent (migration) ────┤
  │   PR 9 (transaction safety) ── independent ─────────┤
  │                                                     │
  └─→ PR 10 (permissions) ── after PRs 1-7 ────────────┤
      PR 11 (structural/RLS) ── after PR 7 (cron) ─────┤
      PR 12 (tech debt) ── defer ───────────────────────┘
```

---

## Estimated Effort

| PR | Effort | Notes |
|----|--------|-------|
| 1 | 2-3 hours | Core path, needs careful manual testing |
| 2 | 4-6 hours | Schema, trigger, RPC, view, service, and display changes |
| 3 | 30 min | Small, targeted |
| 4 | 1-2 hours | Many locations but each is a one-liner |
| 5 | 30 min | Text changes only |
| 6 | 15 min | One-line change |
| 7 | 3-4 hours | Cron delegation + service cleanup + new manual SMS action |
| 8 | 2-3 hours | Migration needs careful testing against latest view/functions |
| 9 | 1-2 hours | Delete order, payment idempotency, PayPal audit paths |
| 10 | 2-3 hours | Many files plus server-action permission consistency |
| 11 | 1 hour | Migration + cron trim |
| 12 | 30 min-2 hours | Depends on scope of refactoring |
| **Total** | **~20-28 hours** | Across 4 waves |

---

## Risk Mitigations

| Risk | Mitigation |
|------|------------|
| PR 1 breaks existing status flows | Manual test every transition path before merge |
| PR 2 fake dates leak to UI | Persist `date_tbd`, backfill from notes, update `isBookingDateTbd()`, and use TBD-aware formatting at every customer/staff display point |
| PR 8 migration breaks view | `db push --dry-run` first; verify view recreation in same migration; check for other views/functions referencing `line_total` |
| PR 7 cron changes miss edge cases | Test in staging with real expired bookings; verify SMS delivery |
| PR 11 RLS blocks legitimate operations | Verify all payment write paths use admin client before deploying |

---

## Rollback Strategy

Each PR is independently revertable via `git revert`. The only PRs that require special rollback consideration:

- **PR 2**: Rollback requires a reverse migration to restore the old trigger/RPC/view and drop the `date_tbd` column
- **PR 8**: Rollback requires reverse migration to restore original `line_total` generated column and view
- **PR 11**: Rollback requires reverse migration to drop RLS policies
