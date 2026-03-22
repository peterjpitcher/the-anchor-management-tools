# Critical Finding Validation

## CRIT-001: Invoice status can be set to "paid" without a payment record

**Verdict: CONFIRMED**

The claim is accurate. The flow is:

1. `updateInvoiceStatus` in `src/app/actions/invoices.ts:406-486` accepts any `InvoiceStatus` from FormData (line 415) and delegates directly to `InvoiceService.updateInvoiceStatus()` (line 459). There is no guard that blocks `paid` or `partially_paid` from this generic path.

2. `InvoiceService.updateInvoiceStatus` in `src/services/invoices.ts:403-449` checks `isInvoiceStatusTransitionAllowed()` (line 418), but the transition table in `src/lib/status-transitions.ts:3-11` **explicitly allows** transitions to `paid` from `draft`, `sent`, `partially_paid`, and `overdue`.

3. When `newStatus === 'paid'`, the service sets `paid_amount = currentInvoice.total_amount` (lines 431-433) on the invoice row directly, with no corresponding `invoice_payments` row created.

This means a user with invoice-edit permission can mark any non-terminal invoice as "paid" via the status dropdown, recording the full amount as paid, without any payment transaction record. The `paid_amount` field will show the correct total but there is no audit trail of how payment was received.

**Severity assessment:** The finding accurately describes the code. The severity depends on whether `invoice_payments` is relied upon elsewhere for reconciliation or reporting. The audit log does record the status change (lines 462-470), which partially mitigates the traceability concern, but there is genuinely no payment record created.

---

## CRIT-002: PayPal deposit capture records payment but never confirms the booking

**Verdict: CONFIRMED**

Both PayPal deposit capture paths only stamp deposit fields and never transition booking status:

### Webhook path (`src/app/api/webhooks/paypal/private-bookings/route.ts:307-377`)
The `handleDepositCaptureCompleted` function (line 307) updates only:
- `deposit_paid_date` (line 349)
- `deposit_payment_method` (line 350)
- `paypal_deposit_capture_id` (line 351)
- `updated_at` (line 352)

No `status` field is included in the update. No function is called to transition the booking.

### UI-side capture path (`src/app/actions/privateBookingActions.ts:1495-1551`)
The `capturePayPalDeposit` action updates the same four fields (lines 1501-1506) and then returns `{ success: true }` (line 1543). Again, no booking status transition occurs.

**Impact:** After a customer pays their deposit via PayPal, the booking remains in whatever status it was in (likely `draft` or `provisional`). Staff must manually confirm the booking. Whether this is a bug or intentional design depends on the business process -- if the expectation is that deposit payment auto-confirms the booking, this is a genuine bug. If staff are meant to review and confirm manually after deposit, then it is working as designed but should be documented.

---

## CRIT-003: Booking balance reminders cron is POST-only

**Verdict: CONFIRMED**

`src/app/api/cron/booking-balance-reminders/route.ts` exports only `POST` (line 20). There is no `GET` export anywhere in the file (151 lines total).

Vercel cron jobs invoke endpoints via GET requests. The `vercel.json` schedules this cron at `"0 10 * * *"` (line 129-131). Since there is no GET handler, Vercel's cron invocation will receive a 405 Method Not Allowed, meaning this cron **never executes**.

**Additional finding:** The same issue affects `src/app/api/cron/post-event-followup/route.ts`, which also only exports `POST` (no GET handler) and is scheduled in `vercel.json` at line 133-135. This is a second dead cron with the identical root cause.

**Note:** Most other cron routes in this project correctly export `GET` (as confirmed by grep across all cron route files). Only `booking-balance-reminders` and `post-event-followup` have this problem.
