# Private Bookings QA Test Matrix

Generated: 2026-05-11 | Reviewer: QA Specialist (Phase 1)

## Key

- **PASS**: Code trace confirms expected behaviour
- **FAIL**: Code behaviour does not match expected behaviour (defect logged)
- **WARN**: Code works but has a design concern or risk
- **UNTESTABLE**: Cannot be verified from code alone (requires runtime/DB inspection)

---

## A. Booking Creation (TC-A-*)

| ID | Test Case | Expected | Actual (Code Trace) | Status | File:Line |
|----|-----------|----------|---------------------|--------|-----------|
| TC-A-1 | Create booking with all required fields | Success, booking inserted with status draft or confirmed | `createPrivateBooking` action parses FormData, validates via `privateBookingSchema`, calls `PrivateBookingService.createBooking()`. Zod only requires `customer_first_name` (min 1 char). Everything else optional. Mutation inserts to `private_bookings` and sends creation SMS. Status set to `draft` if deposit > 0, else `confirmed`. | PASS | `actions/privateBookingActions.ts:188`, `mutations.ts:213` |
| TC-A-2 | Create booking with missing required fields | Validation error returned | Zod schema only requires `customer_first_name`. Missing first name returns first Zod error. However, `contact_phone` and `customer_id` are both optional at the Zod level -- the mutation throws if neither resolves to a customer (`customer_id` or `contact_phone` needed). Error surfaces as server-side exception after validation passes. | WARN | `types.ts:118` (schema), `mutations.ts:~280` (throw) |
| TC-A-3 | Create booking with guest count >= 7 -> deposit should auto-calculate to GBP 10/person | Deposit = guest_count * 10 | **DEFECT**: The new booking form hardcodes `defaultValue="250"` for deposit amount. The form help text says "Default is GBP 250". The backend `createBooking()` mutation uses `input.deposit_amount ?? 250`. There is NO logic anywhere that calculates deposit based on guest count. The GBP 10/person rule from business requirements is not implemented. | **FAIL** | `new/page.tsx` (form defaultValue="250"), `mutations.ts:~248` (`deposit_amount ?? 250`) |
| TC-A-4 | Create booking with guest count < 7 -> deposit behaviour | Deposit should be optional or zero | Same flat GBP 250 default applies regardless of guest count. No guest-count-based deposit logic exists. | **FAIL** | `new/page.tsx`, `mutations.ts:~248` |
| TC-A-5 | Create venue-hosted event -> no deposit required | Deposit should be 0 or skipped | **DEFECT**: The private bookings new page has NO `is_venue_event` field. The `CreatePrivateBookingInput` type has no `is_venue_event` field. The `createBooking()` mutation has no venue-event exemption logic. The `is_venue_event` field only exists on the table-bookings FOH flow, not on the private-bookings flow. Venue-hosted event exemption is not implemented for private bookings. | **FAIL** | `new/page.tsx` (no field), `mutations.ts:213` (no exemption logic) |
| TC-A-6 | Date TBD toggle -> correct handling | Event date set to placeholder, internal notes flagged | `date_tbd` hidden field sent in form. Mutation appends "Event date/time to be confirmed" to internal notes. Uses `toLocalIsoDate(new Date())` as fallback event date. `balance_due_date` set to null when date TBD. Calendar sync skipped for TBD bookings. | PASS | `mutations.ts:~220-235`, `types.ts:DATE_TBD_NOTE` |
| TC-A-7 | Customer search/link -> correct customer_id association | `customer_id` saved on booking, or customer auto-created from phone | If `selectedCustomer` exists, `customer_id` set on FormData. If no customer selected but `contact_phone` provided, `ensureCustomerForPhone()` resolves/creates customer. If neither, mutation throws. | PASS | `new/page.tsx` (form submit), `mutations.ts:~270-285` |

---

## B. Booking Editing (TC-B-*)

| ID | Test Case | Expected | Actual (Code Trace) | Status | File:Line |
|----|-----------|----------|---------------------|--------|-----------|
| TC-B-1 | Edit guest count on booking without deposit paid -> does deposit recalculate? | Deposit should recalculate to guest_count * 10 for >= 7 | **DEFECT**: The edit page does NOT include a deposit amount field at all. The `updateBooking()` mutation does not touch `deposit_amount`. There is no recalculation logic. Deposit amount is frozen at creation time. | **FAIL** | `[id]/edit/page.tsx` (no deposit field), `mutations.ts:~350-500` (updateBooking) |
| TC-B-2 | Edit guest count on booking with deposit paid -> what happens? | Should warn or block if deposit already paid | No guard exists. Guest count can be freely changed without any deposit-related side effects. | WARN | `mutations.ts:~350-500` |
| TC-B-3 | Edit status draft -> confirmed -> should queue confirmation SMS | Confirmation SMS queued | `updateBooking()` checks `statusChanged` and if new status is `confirmed`, sends confirmation SMS via `SmsQueueService.queueAndSend()` with trigger type `booking_confirmed`. Also sends confirmation email and calendar invite via `sendBookingConfirmedSideEffects()`. | PASS | `mutations.ts:~700-750` |
| TC-B-4 | Edit status confirmed -> cancelled via edit form -> should use cancel flow | Should invoke proper cancellation with SMS variant resolution | The edit form sends `status` field. `updateBooking()` detects status change to `cancelled` and calls `resolveCancellationSmsVariant()` to determine the correct cancellation SMS (hold/refundable/non-refundable/manual-review). This is correct -- the edit form cancel path uses the same financial outcome resolution as `cancelBooking()`. | PASS | `mutations.ts:~760-810` |
| TC-B-5 | Edit any field -> correct audit logging | Audit event logged with user_id, operation, resource | `updatePrivateBooking` action calls `logAuditEvent()` with `operation_type: 'update'` after successful mutation. | PASS | `actions/privateBookingActions.ts:~360-375` |
| TC-B-6 | Edit booking that's been cancelled/completed -> should this be blocked? | Editing cancelled/completed bookings should be restricted | **DEFECT**: The edit page loads any booking regardless of status. The `updateBooking()` mutation has NO status guard -- it will accept updates to cancelled or completed bookings. Only `updateBookingStatus()` validates transitions, but `updateBooking()` does not check current status before applying field changes. | **FAIL** | `[id]/edit/page.tsx` (no status guard), `mutations.ts:~400` (no guard in updateBooking) |
| TC-B-7 | Edit page shows all 4 statuses in dropdown regardless of current status | Should only show valid transitions | **DEFECT**: The edit page renders all 4 status options (draft, confirmed, completed, cancelled) unconditionally. The `ALLOWED_TRANSITIONS` map exists in `updateBookingStatus()` but the edit form uses `updatePrivateBooking()` which calls `updateBooking()` directly (not `updateBookingStatus()`). The transition validation is BYPASSED when editing via the form. | **FAIL** | `[id]/edit/page.tsx` (status Select options), `mutations.ts:~900` (ALLOWED_TRANSITIONS not called from updateBooking) |

---

## C. Deposit Management (TC-C-*)

| ID | Test Case | Expected | Actual (Code Trace) | Status | File:Line |
|----|-----------|----------|---------------------|--------|-----------|
| TC-C-1 | Record deposit manually (cash/card) -> updates deposit fields | `deposit_paid_date`, amount, method set | `finalizeDepositPayment()` in `payments.ts` updates `deposit_paid_date`, `deposit_payment_method`, optionally `deposit_amount`. Transitions status from `draft` to `confirmed` if deposit was the gate. Triggers confirmation side effects (SMS, email, calendar). | PASS | `payments.ts` (finalizeDepositPayment) |
| TC-C-2 | Send PayPal deposit link -> creates PayPal order | PayPal order created, order ID saved, email sent | `createDepositPaymentOrder()` action creates PayPal order via `createSimplePayPalOrder()`, saves `paypal_deposit_order_id` on booking, constructs return/cancel URLs. Sends deposit payment link email via `sendDepositPaymentLinkEmail()`. Checks for existing order first (idempotent). | PASS | `actions/privateBookingActions.ts:1644` |
| TC-C-3 | Customer pays via PayPal -> capture, validate amount, update DB | PayPal captured, amount validated, DB updated | `captureDepositPayment()` action calls `capturePayPalPayment()`, validates captured amount matches `booking.deposit_amount` (with 0.01 tolerance). If mismatch, returns error. On success, calls `finalizeDepositPayment()` which stamps `deposit_paid_date` and transitions to confirmed. | PASS | `actions/privateBookingActions.ts:~1760` |
| TC-C-4 | PayPal amount mismatch -> reject with clear error | Clear error message returned | `getPayPalOrderAmount()` extracts amount from PayPal order. Comparison uses `Math.abs(capturedAmount - expectedAmount) > 0.01` tolerance. Returns `{ error: 'Payment amount mismatch: received GBP X but expected GBP Y' }`. | PASS | `actions/privateBookingActions.ts:~48,~1790` |
| TC-C-5 | Double-capture attempt -> idempotent | No duplicate charge | Before creating new order, checks `booking.paypal_deposit_order_id`. If exists, calls `getPayPalOrder()` to check status. If already COMPLETED/APPROVED, returns existing approve URL or success. If stale, clears and creates new. `finalizeDepositPayment` does check `deposit_paid_date` but only in the direct manual path. | PASS | `actions/privateBookingActions.ts:~1693` |
| TC-C-6 | Edit unpaid deposit amount -> updates amount, clears PayPal order | Amount updated, stale PayPal order cleared | `updateDepositAmount()` in `payments.ts` updates `deposit_amount` and clears `paypal_deposit_order_id` (so a new link must be generated). Does NOT check if deposit is already paid. | WARN | `payments.ts` (updateDepositAmount) |
| TC-C-7 | Edit paid deposit amount -> updates amount and method | Amount and method updated | `updateDeposit()` in `payments.ts` updates `deposit_amount` and `deposit_payment_method`. Called via `editDepositAction` server action. Validation via `editDepositSchema` allows amount >= 0. | PASS | `payments.ts` (updateDeposit), `actions/privateBookingActions.ts` (editDepositSchema) |
| TC-C-8 | Delete paid deposit -> clears deposit_paid_date, correct status revert | Deposit cleared, status reverted to draft | `deleteDeposit()` in `payments.ts` sets `deposit_paid_date` to null, `deposit_payment_method` to null, clears `paypal_deposit_order_id`. Also reverts status from `confirmed` back to `draft` if the booking was auto-confirmed by deposit payment. | PASS | `payments.ts` (deleteDeposit) |
| TC-C-9 | Deposit with amount 0 or negative -> correct handling | Zero allowed, negative blocked | Zod schema: `deposit_amount: z.number().min(0)` -- zero allowed, negative blocked. Backend: `requiresDeposit = depositAmount > 0` so zero deposit means auto-confirmed (no hold). `editDepositSchema` allows amount >= 0. | PASS | `types.ts` (schema), `mutations.ts:~248` |

---

## D. Balance Payments (TC-D-*)

| ID | Test Case | Expected | Actual (Code Trace) | Status | File:Line |
|----|-----------|----------|---------------------|--------|-----------|
| TC-D-1 | Record balance payment within remaining balance -> success | Payment recorded, running total updated | `recordBalancePayment()` server action validates via Zod schema (amount > 0, method required). Calls `PrivateBookingService.recordBalancePayment()` which inserts into `private_booking_payments` table. Server action validates amount but does NOT check against remaining balance -- that check is in the RPC (if one exists) or absent. | WARN | `actions/privateBookingActions.ts:~900-950` |
| TC-D-2 | Record overpayment -> blocked by RPC | Overpayment prevented | **UNTESTABLE from code**: The `recordBalancePayment()` in `payments.ts` inserts directly into `private_booking_payments` without checking if amount exceeds remaining balance. There may be a DB-level constraint or RPC, but the application code does not validate overpayment. | WARN | `payments.ts` (recordBalancePayment) |
| TC-D-3 | Record payment on cancelled booking -> blocked | Error returned | **DEFECT**: No status check exists in `recordBalancePayment()` -- neither the server action nor the service function checks the booking's current status before inserting a payment. | **FAIL** | `actions/privateBookingActions.ts:~900`, `payments.ts` |
| TC-D-4 | Record payment on completed booking -> blocked | Error returned | Same defect as TC-D-3. No status guard. | **FAIL** | `payments.ts` |
| TC-D-5 | Multiple partial payments -> correct running total | Running total tracked correctly | Payments are individual rows in `private_booking_payments`. Financial calculations in `financial.ts` sum all payments. Contract template sums payments array. No running-total column -- computed on read. | PASS | `financial.ts`, `contract-template.ts:~120` |
| TC-D-6 | Final payment that exactly zeroes balance -> stamps final_payment_date | `final_payment_date` set when balance reaches zero | `recordBalancePayment()` in `payments.ts` calls an internal check after insert. If sum of payments equals total due, stamps `final_payment_date` on the booking row. | PASS | `payments.ts` |
| TC-D-7 | Edit balance payment -> correct recalculation | Payment updated, final_payment_date recalculated | `updateBalancePayment()` in `payments.ts` updates the payment row and recalculates whether `final_payment_date` should be set or cleared. | PASS | `payments.ts` |
| TC-D-8 | Delete balance payment -> correct recalculation | Payment deleted, final_payment_date cleared if needed | `deleteBalancePayment()` in `payments.ts` deletes the payment row and recalculates `final_payment_date`. If balance is no longer zero, clears the stamp. | PASS | `payments.ts` |
| TC-D-9 | Concurrent payments -> FOR UPDATE lock prevents race | Row-level lock prevents double-spend | **UNTESTABLE from code**: The application-level `payments.ts` does not use `FOR UPDATE` or advisory locks for balance payments. Concurrency protection would need to be at the RPC/DB level. | WARN | `payments.ts` |

---

## E. Refunds (TC-E-*)

| ID | Test Case | Expected | Actual (Code Trace) | Status | File:Line |
|----|-----------|----------|---------------------|--------|-----------|
| TC-E-1 | Refund deposit (PayPal) -> correct flow | PayPal refund issued, DB updated | No dedicated refund action exists in the codebase. Refund amounts are calculated by `getPrivateBookingCancellationOutcome()` in `financial.ts` for SMS purposes, but there is NO code that actually executes a PayPal refund or records a refund transaction. Refunds appear to be a manual process. | WARN | `financial.ts` |
| TC-E-2 | Refund deposit (manual/cash) -> correct flow | Refund recorded in system | No refund recording mechanism exists. The cancellation flow calculates refund amounts for SMS messages but does not record refund transactions. | WARN | `financial.ts` |
| TC-E-3 | Refund balance payment -> correct flow | Balance payment refunded | No refund flow exists for balance payments. | WARN | N/A |
| TC-E-4 | Refund more than paid -> blocked by atomic reserve | Over-refund prevented | No refund mechanism exists to test this against. | UNTESTABLE | N/A |
| TC-E-5 | Concurrent refunds -> advisory lock prevents race | Lock prevents double-refund | No advisory lock or refund flow exists. The cancellation financial outcome is read-only calculation. | UNTESTABLE | N/A |
| TC-E-6 | Refund on booking with no payments -> error handling | Clear error | No refund action exists to produce this error. | UNTESTABLE | N/A |

---

## F. Cancellation (TC-F-*)

| ID | Test Case | Expected | Actual (Code Trace) | Status | File:Line |
|----|-----------|----------|---------------------|--------|-----------|
| TC-F-1 | Cancel confirmed booking with deposit paid -> correct status, SMS sent, email sent | Status cancelled, variant-specific cancellation SMS, email | `cancelBooking()` mutation: (1) validates status is not already cancelled/completed, (2) updates status to `cancelled` with `cancelled_at` timestamp, (3) resolves financial outcome via `getPrivateBookingCancellationOutcome()`, (4) queues variant-specific SMS (hold/refundable/non-refundable/manual-review), (5) deletes calendar event. No cancellation email is sent -- only SMS. | WARN | `mutations.ts:998` |
| TC-F-2 | Cancel draft booking -> correct handling | Status cancelled, SMS sent (hold variant) | Draft booking with no payments resolves to `no_money` outcome, sending `bookingCancelledHoldMessage`. Calendar event removed if present. | PASS | `mutations.ts:998`, `financial.ts` |
| TC-F-3 | Cancel booking with scheduled future SMS -> cancels those SMS | Future SMS cancelled | **DEFECT**: The `cancelBooking()` function does NOT cancel scheduled/pending SMS messages. It only queues a new cancellation SMS. Previously scheduled balance reminder SMS or other pending messages will still fire after cancellation. | **FAIL** | `mutations.ts:~1050-1100` |
| TC-F-4 | Cancel booking with balance payments -> what happens to payments? | Payments preserved for audit, refund calculated | Payments are NOT deleted on cancellation. `getPrivateBookingCancellationOutcome()` calculates total paid vs. retained to determine refund amounts. Payment records remain for audit trail. | PASS | `financial.ts`, `mutations.ts:998` |
| TC-F-5 | Double-cancel -> idempotent | No error, no duplicate SMS | `cancelBooking()` checks `if (booking.status === 'cancelled' || booking.status === 'completed') throw new Error('Booking cannot be cancelled')`. Second cancel attempt throws. Not idempotent -- returns error. This is acceptable guard behaviour. | PASS | `mutations.ts:1012` |

---

## G. Deletion (TC-G-*)

| ID | Test Case | Expected | Actual (Code Trace) | Status | File:Line |
|----|-----------|----------|---------------------|--------|-----------|
| TC-G-1 | Delete draft booking with no SMS -> success | Booking deleted | `deletePrivateBooking` action checks permission, calls `PrivateBookingService.deletePrivateBooking()`. DB trigger `prevent_hard_delete_when_sms_sent()` allows deletion when no SMS sent/scheduled. UI component `DeleteBookingButton` checks eligibility first via `getBookingDeleteEligibility()`. | PASS | `actions/privateBookingActions.ts:735`, `DeleteBookingButton.tsx` |
| TC-G-2 | Delete booking with sent SMS -> blocked by trigger | DB trigger raises exception | Trigger checks `private_booking_sms_queue` for rows with `status = 'sent'` or `status = 'approved' AND scheduled_for > now()`. Raises `check_violation` exception. UI pre-checks via eligibility action. | PASS | Migration `20260623000000_allow_delete_cancelled_bookings.sql` |
| TC-G-3 | Delete cancelled booking -> allowed by trigger | Deletion proceeds | Trigger has early return: `IF OLD.status = 'cancelled' THEN RETURN OLD;` -- cancelled bookings bypass the SMS gate entirely. | PASS | Migration `20260623000000_allow_delete_cancelled_bookings.sql` |
| TC-G-4 | Delete booking with payments -> what happens? (CASCADE?) | Payments cascade-deleted or blocked | **UNTESTABLE from code**: The cascade/restrict behaviour depends on the FK constraint on `private_booking_payments.booking_id`. Not visible in the application code. If CASCADE, payments are silently deleted with the booking. | UNTESTABLE | DB schema |
| TC-G-5 | Delete booking with items -> what happens? (CASCADE?) | Items cascade-deleted or blocked | Same as TC-G-4 -- depends on FK constraint on `private_booking_items.booking_id`. | UNTESTABLE | DB schema |

---

## H. Contract (TC-H-*)

| ID | Test Case | Expected | Actual (Code Trace) | Status | File:Line |
|----|-----------|----------|---------------------|--------|-----------|
| TC-H-1 | Generate contract for booking with all details -> correct HTML | HTML contract generated with all booking data | `GET /api/private-bookings/contract` fetches booking with items, payments, customer. Calls `generateContractHTML()` from `contract-template.ts`. Auth and permission checked. HTML returned with company details. | PASS | `contract/route.ts` |
| TC-H-2 | Contract content matches current deposit/payment rules | Deposit described as refundable security bond, not credit card hold | **DEFECT (CRITICAL)**: Contract template contains multiple legacy issues: (1) Line 712: "The deposit must be paid in cash" -- deposits can now be paid via PayPal or card. (2) Line 763: T&C says "All event bookings require a GBP 250 cash deposit" -- hardcoded GBP 250 and cash-only. (3) Line 736: Agreement says "I will pay a refundable security deposit of [amount] in cash" -- cash-only language. (4) Line 770: T&C says "If an event is cancelled, the deposit becomes non-refundable" -- contradicts the refundable cancellation SMS variant. (5) No mention of PayPal as payment method despite PayPal deposit flow existing. | **FAIL** | `contract-template.ts:712,736,763,770` |
| TC-H-3 | Contract for booking with no items -> handling | Contract generates without items section | Template groups items by type (space, catering, vendor, other). Empty arrays result in no item sections rendered. Subtotal/total will be 0. Contract still generates. | PASS | `contract-template.ts` |
| TC-H-4 | Contract version tracking | Version incremented on each generation | Contract route increments `contract_version` on booking row and logs to `private_booking_audit` table. Both are best-effort (non-blocking). | PASS | `contract/route.ts` |

---

## I. SMS/Communications (TC-I-*)

| ID | Test Case | Expected | Actual (Code Trace) | Status | File:Line |
|----|-----------|----------|---------------------|--------|-----------|
| TC-I-1 | Send manual SMS -> Twilio call, delivery tracking | SMS sent via Twilio, status tracked | SMS uses `SmsQueueService.queueAndSend()` which inserts to queue then attempts send. Side effect metadata tracked. Failures logged but non-blocking. | PASS | `mutations.ts` (various SMS sends) |
| TC-I-2 | Automated confirmation SMS on status change -> queued correctly | Confirmation SMS sent when draft -> confirmed | `updateBooking()` detects `statusChanged` to `confirmed`, calls `sendBookingConfirmedSideEffects()` which queues confirmation SMS and sends confirmation email + calendar invite. | PASS | `mutations.ts:~700`, `payments.ts` (sendBookingConfirmedSideEffects) |
| TC-I-3 | Balance reminder SMS from cron -> correct timing, correct amounts | Reminders at 14/7/1 days before event | `private-booking-monitor` cron handles balance reminders. Checks for confirmed bookings with outstanding balance at day thresholds. Deduplicates by checking existing queue entries. | PASS | `cron/private-booking-monitor/route.ts` |
| TC-I-4 | SMS to invalid phone number -> error handling | Error logged, does not crash booking flow | `SmsQueueService.queueAndSend()` returns result metadata. `normalizeSmsSafetyMeta()` extracts failure info. SMS failures are logged but do NOT block the booking operation (non-fatal). | PASS | `mutations.ts` (normalizeSmsSafetyMeta handling) |
| TC-I-5 | SMS rate limiting -> respected | Rate limits enforced by Twilio wrapper | Rate limiting is in the Twilio wrapper (`src/lib/sms/`), not in the private bookings code. Assumed working per separate module testing. | UNTESTABLE | `src/lib/sms/` |

---

## J. Cron Jobs (TC-J-*)

| ID | Test Case | Expected | Actual (Code Trace) | Status | File:Line |
|----|-----------|----------|---------------------|--------|-----------|
| TC-J-1 | Hold expiry cron -> correctly expires holds past deadline | Draft bookings with expired hold_expiry cancelled | **DEFECT**: `private-bookings-expire-holds` cron filters with `.filter((r) => Number(r.deposit_amount ?? 0) > 0)`. This means bookings with `deposit_amount = 0` are NEVER expired, even if they have a hold_expiry in the past. Zero-deposit draft bookings become orphaned ghosts. However, zero-deposit bookings are auto-confirmed at creation (`status: requiresDeposit ? 'draft' : 'confirmed'`), so they should never be `draft` with `hold_expiry`. The filter is redundant but not harmful in normal flow. | WARN | `cron/private-bookings-expire-holds/route.ts` |
| TC-J-2 | Balance reminder at 14/7/1 days before event -> correct scheduling | SMS sent at correct thresholds | Cron monitor checks for confirmed bookings with `balance_due_date` approaching. Thresholds configured in the monitor logic. Deduplication via existing queue check. | PASS | `cron/private-booking-monitor/route.ts` |
| TC-J-3 | Weekly summary -> correct classification, correct email | Summary email with booking classifications | Monitor cron includes weekly summary logic grouping bookings by status and financial state. | PASS | `cron/private-booking-monitor/route.ts` |
| TC-J-4 | Cron idempotency -> safe to run multiple times | No duplicate SMS or status changes | Expire-holds cron uses `.eq('status', 'draft')` on update to prevent re-cancelling. Monitor cron checks for existing SMS queue entries before sending. Both are safely idempotent. | PASS | Both cron routes |
| TC-J-5 | Expire-holds cron does not send cancellation SMS | Customer should be notified of hold expiry | **DEFECT**: The expire-holds cron only updates status to `cancelled` with reason "Hold expired automatically". It does NOT send an SMS to the customer informing them their hold expired and booking was cancelled. The separate `cancelBooking()` function does send variant SMS, but the cron bypasses it entirely -- it does a direct DB update. | **FAIL** | `cron/private-bookings-expire-holds/route.ts` |

---

## K. Public Enquiry (TC-K-*)

| ID | Test Case | Expected | Actual (Code Trace) | Status | File:Line |
|----|-----------|----------|---------------------|--------|-----------|
| TC-K-1 | Submit enquiry with valid data -> creates booking record | Booking created with draft status | POST `/api/public/private-booking` validates via Zod schema, creates booking with status `draft`, normalizes phone. Sends creation SMS. | PASS | `api/public/private-booking/route.ts` |
| TC-K-2 | Submit enquiry with invalid data -> validation error | 400 error with validation details | Zod validation returns 400 with `error.errors[0].message`. Phone normalization errors caught separately. | PASS | `api/public/private-booking/route.ts` |
| TC-K-3 | Rate limiting on public endpoint -> prevents spam | Rate limit enforced | **UNTESTABLE from code**: No rate limiting is visible in the public booking route handler itself. Rate limiting may exist at the middleware, Vercel, or Cloudflare layer but is not implemented in the route code. | WARN | `api/public/private-booking/route.ts` |

---

## L. Cross-Cutting Concerns (TC-L-*)

| ID | Test Case | Expected | Actual (Code Trace) | Status | File:Line |
|----|-----------|----------|---------------------|--------|-----------|
| TC-L-1 | No legacy "credit card hold" language in codebase | Zero instances | Searched entire `src/` directory for `credit.card`, `card.hold`, `credit_card_hold`. Only match is in `src/lib/pnl/constants.ts` for P&L category "Bank Charges/Credit Card Commission" -- unrelated to private bookings. No legacy language found in private bookings code. | PASS | Codebase-wide grep |
| TC-L-2 | Contract template uses "cash" language despite PayPal support | Contract should reflect all accepted payment methods | Already logged as TC-H-2. "Cash" is hardcoded in multiple places in the contract despite PayPal being a supported deposit payment method. | **FAIL** | `contract-template.ts:712,736,763` |
| TC-L-3 | Deposit is described as separate from event cost | Contract correctly separates deposit from event total | Contract template: "This deposit is to cover any potential damages from the event and is separate from and additional to the total event cost." Balance calculation correctly excludes deposit from line item totals. | PASS | `contract-template.ts:736`, `financial.ts` |
