# Private Bookings Section — Consolidated Defect Report

**Date:** 2026-05-11
**Scope:** Full section review of `/private-bookings` — pages, components, server actions, services, API routes, crons, and migrations.
**Method:** 4-agent parallel audit (Structural Mapper, Business Rules Auditor, Technical Architect, QA Specialist) + manual review by project owner. All findings cross-referenced and verified against source code.

---

## P1 — Critical (actively causing incorrect behaviour)

### 1. Date-TBD bookings are not truly TBD
**Source:** Owner
When Date TBD is toggled, the form only submits `date_tbd=true` while the disabled date/time fields are omitted. The mutation then falls back to today's date + 12:00 (`toLocalIsoDate(new Date())` / `DEFAULT_TBD_TIME`). Downstream consequences:
- Hold expiry is calculated from this fake date (7 days before "today" = already in the past)
- Customer SMS references the fake date
- The expire-holds cron can cancel these bookings immediately since the hold is already "expired"

| File | Line | Issue |
|------|------|-------|
| `new/page.tsx` | ~120 | Disabled date field omitted from submission |
| `mutations.ts` | 217 | `input.event_date \|\| toLocalIsoDate(new Date())` fallback |
| `mutations.ts` | 244 | Hold expiry calculated from fake date |
| `cron/private-bookings-expire-holds/route.ts` | 18 | Can cancel TBD bookings with "expired" holds |

### 2. List page totals/status go stale after item and payment changes
**Source:** Owner
The list displays `calculated_total`, `balance_remaining`, and `payment_status` from the view, but several item/payment/discount mutations only revalidate the detail page and dashboard — not `/private-bookings`. The client also keeps a 30-second in-memory cache. Result: added/edited/deleted items can leave list totals, balance, and payment status showing old values until the cache expires AND the page is revalidated.

| File | Line | Issue |
|------|------|-------|
| `PrivateBookingsClient.tsx` | 42 | 30s client-side cache |
| `PrivateBookingsClient.tsx` | ~700 | Displays `calculated_total` from cached data |
| `privateBookingActions.ts` | 1483, 1510 | Item mutations only revalidate detail + dashboard, not list |
| `privateBookingActions.ts` | 443, 953, 1017 | Payment mutations only revalidate detail + dashboard |

### 3. Manual deposit recording can confirm a booking with less than the required deposit
**Source:** Owner
The deposit modal allows the user to enter any positive amount. The server action accepts any `amount > 0`. The service's `finalizeDepositPayment` only enforces amount matching for the PayPal path (when `requireAmountMatch` is true). For manual recording, a £1 deposit on a £250 requirement marks the booking as confirmed. The payment history then shows the configured `deposit_amount`, not what was actually taken.

| File | Line | Issue |
|------|------|-------|
| `PrivateBookingDetailClient.tsx` | ~281 | Modal accepts any positive amount for deposit type |
| `privateBookingActions.ts` | ~912 | Action accepts any `amount > 0` |
| `payments.ts` | 328 | `requireAmountMatch` only set for PayPal path |
| `payments.ts` | ~702 | History displays configured amount, not recorded amount |

### 4. Edit page bypasses the validated status-transition flow
**Source:** Owner + QA Specialist agent
The detail page uses `updateBookingStatus()` which validates against `ALLOWED_TRANSITIONS` (e.g. draft can only go to confirmed or cancelled). But the edit page posts a free-choice status dropdown through `updatePrivateBooking` -> `updateBooking()`, which applies the status directly with no transition validation. Staff can jump draft -> completed, reopen cancelled bookings, or make any other invalid transition.

| File | Line | Issue |
|------|------|-------|
| `edit/page.tsx` | 301-310 | All 4 statuses shown unconditionally |
| `privateBookingActions.ts` | ~354 | Calls `updateBooking`, not `updateBookingStatus` |
| `mutations.ts` | ~506 | `updateBooking` applies status without validation |
| `mutations.ts` | 891-913 | `ALLOWED_TRANSITIONS` only in separate `updateBookingStatus` |

### 5. Contract contains legally incorrect deposit terms
**Source:** Business Rules Auditor + QA Specialist
The contract template has multiple hardcoded statements that contradict reality:
- **"The deposit must be paid in cash"** — PayPal deposits are fully operational
- **"All event bookings require a £250 cash deposit"** — hardcoded £250 and cash-only
- **"I will pay a refundable security deposit of [amount] in cash"** — cash-only language in the agreement the customer signs
- **"If an event is cancelled, the deposit becomes non-refundable"** — contradicts the cancellation flow which has a `refundable` outcome that sends SMS promising a refund

| File | Line | Issue |
|------|------|-------|
| `contract-template.ts` | 712 | "deposit must be paid in cash" |
| `contract-template.ts` | 736 | Agreement: "in cash" |
| `contract-template.ts` | 763 | T&C: "£250 cash deposit" hardcoded |
| `contract-template.ts` | 770 | T&C: "deposit becomes non-refundable" contradicts refund SMS |

---

## P2 — High (incorrect behaviour under common conditions)

### 6. Manual private-booking SMS uses wrong permission and history path
**Source:** Owner
The messages page checks `private_bookings` permissions (`send` or `manage`), but the shared SMS send action requires `messages:send` — a different module entirely. Additionally, SMS metadata writes `booking_id` rather than `private_booking_id`, and the history view reads from `private_booking_sms_queue`. Result: sent manual messages can be rejected by the permission check or disappear from the booking's message history.

| File | Line | Issue |
|------|------|-------|
| `messages/page.tsx` | 31 | Checks `private_bookings` permissions |
| `PrivateBookingMessagesClient.tsx` | ~222 | Calls shared SMS action |
| `sms.ts` | 248 | Requires `messages:send` (different module) |

### 7. Permission model inconsistencies
**Source:** Owner
Pages treat `manage` as granting broad access (`actions.has('view') || actions.has('manage')`), but `checkUserPermission` does exact action matching — there's no inheritance. Server actions require specific actions (`view`, `create`, `edit`, `manage_deposits`, etc.). View-only users can also reach item add/edit/delete UI before the server actions reject them, creating a confusing UX.

| File | Line | Issue |
|------|------|-------|
| `[id]/page.tsx` | ~19 | `actions.has('view') \|\| actions.has('manage')` |
| `permission.ts` | ~101 | Exact match: `p.action === action` |
| `privateBookingActions.ts` | ~232 | Requires specific action strings |
| `items/page.tsx` | ~820 | Shows add/edit/delete UI without permission gating |

### 8. Customer-facing totals use stale `total_amount` instead of `calculated_total`
**Source:** Owner
Several customer-facing surfaces read `private_bookings.total_amount` (a static legacy column) rather than the item-derived `calculated_total` from the view. This affects the booking portal, deposit/final-payment emails, and the scheduled SMS preview (which selects from `private_bookings` where `calculated_total` doesn't exist).

| File | Line | Issue |
|------|------|-------|
| `payments.ts` | 177 | Uses `booking.total_amount` in email context |
| `payments.ts` | 637 | Same — total_amount for payment email |
| `scheduled-sms.ts` | 68 | Selects from `private_bookings` table, not view |

### 9. Item discounts can create negative line totals
**Source:** Owner
The DB generated column for `line_total` subtracts percent/fixed discounts without clamping to zero. The add/update item mutations don't validate discount bounds server-side. A 100%+ discount or a fixed discount exceeding the line value produces a negative `line_total`, which reduces the booking total and could produce negative balances.

| File | Line | Issue |
|------|------|-------|
| Squashed migration | ~2876 | Generated `line_total` column has no `GREATEST(0, ...)` clamp |
| `mutations.ts` | ~1502 | Add item has no discount bound validation |
| `mutations.ts` | ~1566 | Update item has no discount bound validation |

### 10. Cancellation doesn't cancel pending scheduled SMS
**Source:** Technical Architect + QA Specialist
`cancelBooking()` updates status, cleans up the calendar, and sends a cancellation SMS — but never cancels existing pending/approved SMS queue entries. Previously scheduled balance reminders, event reminders, or deposit reminders will still fire after the booking is cancelled, sending contradictory messages to the customer.

| File | Line | Issue |
|------|------|-------|
| `mutations.ts` | 998-1117 | Full cancel flow — no SMS queue cleanup step |

### 11. Hold expiry cron cancels bookings without customer notification
**Source:** QA Specialist
The expire-holds cron does a direct DB update to `status='cancelled'` without sending any SMS or email. The customer's booking silently vanishes. The separate `cancelBooking()` function sends variant-specific SMS, but this cron bypasses it entirely.

| File | Line | Issue |
|------|------|-------|
| `cron/private-bookings-expire-holds/route.ts` | Full file | Direct update, no SMS/email |

### 12. Cancelled/completed bookings can be freely edited
**Source:** Owner + QA Specialist
No status guard exists in the edit page or `updateBooking()`. A cancelled booking's event details, customer info, notes, and even status can all be modified through the edit form.

| File | Line | Issue |
|------|------|-------|
| `edit/page.tsx` | Full page | No status check on load |
| `mutations.ts` | ~400 | `updateBooking` has no status guard |

### 13. Deposit can be recorded on completed bookings
**Source:** Business Rules Auditor
`finalizeDepositPayment` only blocks `cancelled` status, not `completed`. The balance payment RPC correctly blocks both. Inconsistent guard.

| File | Line | Issue |
|------|------|-------|
| `payments.ts` | 324 | Only checks `booking.status === 'cancelled'` |

---

## P3 — Medium (edge cases, transaction safety, structural)

### 14. "Today" appears in both past and upcoming on the list
**Source:** Owner
Upcoming uses `gte(today)` and past uses `lte(today)`, so today's bookings appear in both views. The calendar uses `< today` for past (exclusive), creating a third inconsistency.

| File | Line | Issue |
|------|------|-------|
| `queries.ts` | 184-185 | Upcoming: `gte('event_date', todayIso)` |
| `queries.ts` | 190 | Past: `lte('event_date', todayIso)` |
| `CalendarView.tsx` | 94 | Calendar: `< today` (exclusive) |

### 15. PayPal capture-to-DB gap
**Source:** Technical Architect
If PayPal capture succeeds but `finalizeDepositPayment()` fails (Vercel timeout, DB error), money is captured with no local record. Mitigated by a reconciliation cron, but there's a window where the payment is invisible.

### 16. Delete flow: calendar deleted before DB delete
**Source:** Technical Architect
`deletePrivateBooking()` deletes the calendar event, then attempts the DB delete. If the DB trigger rejects the delete (SMS gate), the calendar event is already gone — orphaned state with no rollback.

| File | Line | Issue |
|------|------|-------|
| `mutations.ts` | ~1430 | Calendar delete before DB delete |

### 17. `recordFinalPayment` has no row-level lock
**Source:** Technical Architect
Unlike `recordBalancePayment` (which uses `FOR UPDATE` in the RPC), `recordFinalPayment` does a direct update. Concurrent calls could double-stamp `final_payment_date` and send duplicate SMS.

### 18. Two overlapping public enquiry endpoints
**Source:** Structural Mapper
`/api/public/private-booking/route.ts` (334 lines) and `/api/private-booking-enquiry/route.ts` (317 lines) both create draft bookings from external submissions. Unclear which is canonical.

### 19. Duplicate hold expiry logic across two crons
**Source:** Structural Mapper
Both `private-booking-monitor` (Pass 2) and `private-bookings-expire-holds` cancel expired holds. Potential for double-processing, though idempotency checks prevent duplicate status changes.

### 20. Missing UPDATE/DELETE RLS on `private_booking_payments`
**Source:** Structural Mapper
Only SELECT and INSERT policies exist. Edits and deletes go through the admin client, bypassing RLS entirely.

---

## P4 — Low (tech debt, code quality)

### 21. Feedback system is 470 lines of dead code
`createPrivateBookingFeedbackToken` returns null (retired). Consolidated to Google review but code remains.

### 22. `PrivateBookingDetailClient.tsx` is 2,979 lines
Contains inline modals, drag-and-drop, payment forms, status transitions, audit trail. Decomposition candidate.

### 23. `privateBookingActions.ts` is 2,217 lines
Should be split by subdomain (payments, CRUD, items, vendors).

### 24. No rate limiting on public booking endpoint
Spam could create many draft bookings and trigger manager notification emails.

---

## Summary

| Priority | Count | Key Theme |
|----------|-------|-----------|
| P1 Critical | 5 | Contract legal text, Date TBD, stale list data, deposit underpayment, status bypass |
| P2 High | 8 | SMS permissions, stale customer totals, negative discounts, cancel SMS gap, edit guards |
| P3 Medium | 7 | Transaction safety, structural overlap, RLS gaps |
| P4 Low | 4 | Dead code, file size, rate limiting |
| **Total** | **24** | |
