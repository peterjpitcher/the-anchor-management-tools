**Findings**

### BUG-001: Generic invoice status updates can fabricate paid invoices without a payment record
- **File:** [src/app/actions/invoices.ts:415](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts#L415), [src/app/actions/invoices.ts:473](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts#L473), [src/services/invoices.ts:418](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/invoices.ts#L418), [src/services/invoices.ts:431](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/invoices.ts#L431)
- **Severity:** Critical
- **Category:** Data Integrity
- **Description:** `updateInvoiceStatus` allows `paid` and `partially_paid` through the generic status path instead of the payment RPC. `paid` writes `paid_amount = total_amount` with no `invoice_payments` row; `partially_paid` changes status without updating payment totals.
- **Impact:** The ledger can show money received when no payment exists, and remittance advice can be emailed for nonexistent payments.
- **Suggested fix:** Block monetary statuses in the generic status action and require `InvoiceService.recordPayment()` for any payment-state transition.

### BUG-002: PayPal private-booking deposit capture records payment but never confirms the booking
- **File:** [src/app/actions/privateBookingActions.ts:1498](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/privateBookingActions.ts#L1498), [src/app/api/webhooks/paypal/private-bookings/route.ts:346](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/webhooks/paypal/private-bookings/route.ts#L346), [src/services/private-bookings.ts:1311](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/private-bookings.ts#L1311)
- **Severity:** Critical
- **Category:** Data Integrity
- **Description:** The PayPal capture paths only stamp `deposit_paid_date`/`deposit_payment_method`. The canonical deposit path also moves `draft -> confirmed` and handles follow-up side effects.
- **Impact:** A customer can pay, but the booking stays `draft`, misses confirmation/calendar flows, and can still be expired or cancelled later.
- **Suggested fix:** Route PayPal captures through the same deposit-recording service/RPC used by manual deposits.

### BUG-003: `booking-balance-reminders` cron route is implemented as `POST`, so Vercel cron will never invoke it
- **File:** [src/app/api/cron/booking-balance-reminders/route.ts:13](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/booking-balance-reminders/route.ts#L13), [src/app/api/cron/booking-balance-reminders/route.ts:20](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/booking-balance-reminders/route.ts#L20)
- **Severity:** Critical
- **Category:** Logic
- **Description:** The file is documented as a Vercel cron handler but only exports `POST`.
- **Impact:** Daily balance reminder SMSes never run in production.
- **Suggested fix:** Export `GET` for the cron entrypoint, or support both `GET` and `POST`.

### BUG-004: Public private-booking endpoint mass-assigns internal fields from unauthenticated input
- **File:** [src/app/api/public/private-booking/route.ts:156](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/public/private-booking/route.ts#L156), [src/services/private-bookings.ts:171](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/private-bookings.ts#L171)
- **Severity:** High
- **Category:** Data Integrity
- **Description:** The route spreads the raw request body into `CreatePrivateBookingInput`. That type includes internal-only fields like `customer_id`, `deposit_amount`, `balance_due_date`, `hold_expiry`, `status`, and `created_by`.
- **Impact:** A public caller can tamper with internal booking/payment state or bind an enquiry to the wrong customer record.
- **Suggested fix:** Replace the spread with a strict public schema and explicit field whitelist.

### BUG-005: Duplicate Twilio status webhooks increment delivery-failure counters again
- **File:** [src/app/api/webhooks/twilio/route.ts:258](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/webhooks/twilio/route.ts#L258), [src/app/api/webhooks/twilio/route.ts:809](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/webhooks/twilio/route.ts#L809)
- **Severity:** High
- **Category:** Data Integrity
- **Description:** Duplicate status callbacks still call `applySmsDeliveryOutcome()`. For failed/undelivered messages, each retry increments `sms_delivery_failures`.
- **Impact:** One failed SMS retried by Twilio can wrongly deactivate a valid customer from future SMS.
- **Suggested fix:** Treat duplicate statuses as a pure no-op, or dedupe outcome application by status transition.

### BUG-006: Payroll approval can proceed with silently missing sessions/rate data
- **File:** [src/app/actions/payroll.ts:143](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/payroll.ts#L143), [src/app/actions/payroll.ts:191](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/payroll.ts#L191), [src/app/actions/payroll.ts:487](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/payroll.ts#L487), [src/app/actions/payroll.ts:554](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/payroll.ts#L554)
- **Severity:** High
- **Category:** Partial Failure
- **Description:** `getPayrollMonthData()` fetches shifts, sessions, pay settings, overrides, age bands, and rates in parallel but only checks `shiftsError`.
- **Impact:** A transient read failure can produce an approvable payroll snapshot with missing actual hours or null pay rates.
- **Suggested fix:** Fail the whole review when any required dataset errors.

### BUG-007: Parking capacity can be oversold under concurrent bookings
- **File:** [src/services/parking.ts:85](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/parking.ts#L85), [src/services/parking.ts:104](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/parking.ts#L104)
- **Severity:** High
- **Category:** Async
- **Description:** Availability is checked first, then the booking is inserted in a separate step.
- **Impact:** Two simultaneous bookings for the last space can both be confirmed.
- **Suggested fix:** Move capacity enforcement into a single transaction/RPC or add a database-level guard.

### BUG-008: Concurrent clock-ins can create multiple open sessions and then break clock-out
- **File:** [src/app/actions/timeclock.ts:84](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/timeclock.ts#L84), [src/app/actions/timeclock.ts:137](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/timeclock.ts#L137)
- **Severity:** High
- **Category:** Async
- **Description:** The code does a read-then-insert to prevent duplicate clock-ins, but there is no lock or uniqueness guarantee.
- **Impact:** Multiple open sessions can exist for one employee, and later `.single()` lookups start failing.
- **Suggested fix:** Enforce one open session per employee with a unique partial index and atomic insert/update logic.

### BUG-009: Booking APIs can create `pending_payment` holds with no usable payment link
- **File:** [src/app/api/table-bookings/route.ts:234](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/table-bookings/route.ts#L234), [src/app/api/table-bookings/route.ts:395](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/table-bookings/route.ts#L395), [src/app/api/event-bookings/route.ts:489](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/event-bookings/route.ts#L489), [src/app/api/event-bookings/route.ts:584](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/event-bookings/route.ts#L584)
- **Severity:** High
- **Category:** Partial Failure
- **Description:** Both routes swallow payment-token creation failures and still return success with `state: 'pending_payment'` and `next_step_url: null`.
- **Impact:** Inventory is held, the customer cannot pay, and idempotency replays the same dead-end response.
- **Suggested fix:** Fail the request or roll back the hold when token generation fails.

### BUG-010: Hold-expiry cron can cancel bookings that were confirmed or extended after selection
- **File:** [src/app/api/cron/private-bookings-expire-holds/route.ts:18](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/private-bookings-expire-holds/route.ts#L18), [src/app/api/cron/private-bookings-expire-holds/route.ts:40](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/private-bookings-expire-holds/route.ts#L40)
- **Severity:** High
- **Category:** Async
- **Description:** The cron first snapshots expired draft IDs, then cancels by ID only.
- **Impact:** A booking confirmed or extended between those two statements can still be cancelled incorrectly.
- **Suggested fix:** Use a single guarded update that still checks `status='draft'` and the old expiry condition.

### BUG-011: Recurring invoice schedules can get permanently wedged after partial success
- **File:** [src/app/api/cron/recurring-invoices/route.ts:58](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/recurring-invoices/route.ts#L58), [src/app/api/cron/recurring-invoices/route.ts:182](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/recurring-invoices/route.ts#L182), [src/app/api/cron/recurring-invoices/route.ts:479](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/recurring-invoices/route.ts#L479)
- **Severity:** High
- **Category:** Partial Failure
- **Description:** If invoice creation succeeds but advancing `next_invoice_date` fails, the job persists `processed_with_error` for that idempotency key.
- **Impact:** Future runs replay-skip the same overdue schedule and no further invoices are generated for it.
- **Suggested fix:** Make invoice creation and schedule advancement atomic, or only seal idempotency after both succeed.

### BUG-012: Bulk receipt-classification rollback wipes prior vendor classification
- **File:** [src/app/actions/receipts.ts:2573](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/receipts.ts#L2573), [src/app/actions/receipts.ts:2620](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/receipts.ts#L2620), [src/app/actions/receipts.ts:2647](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/receipts.ts#L2647), [src/app/actions/receipts.ts:2658](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/receipts.ts#L2658)
- **Severity:** High
- **Category:** Partial Failure
- **Description:** If the vendor update succeeds and the expense update fails, the rollback nulls vendor fields instead of restoring prior values.
- **Impact:** Existing manual/AI vendor classifications are lost on the error path.
- **Suggested fix:** Capture previous values per row and restore them exactly, or move the entire bulk update into one transaction.

### BUG-013: Auto-send invoices can email a draft invoice and then leave it unsent forever
- **File:** [src/app/api/cron/auto-send-invoices/route.ts:51](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/auto-send-invoices/route.ts#L51), [src/app/api/cron/auto-send-invoices/route.ts:149](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/auto-send-invoices/route.ts#L149), [src/app/api/cron/auto-send-invoices/route.ts:206](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/auto-send-invoices/route.ts#L206)
- **Severity:** High
- **Category:** Partial Failure
- **Description:** The email send happens before the `draft -> sent` transition is durably finalized, and partial failure is still sealed via idempotency.
- **Impact:** A vendor can receive the invoice while the system keeps it in `draft`, and later runs stop retrying once the date window passes.
- **Suggested fix:** Use an outbox/transactional send model or only finalize idempotency after the status change succeeds.

### BUG-014: London date helpers use the host timezone, not London
- **File:** [src/lib/dateUtils.ts:27](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/dateUtils.ts#L27), [src/lib/dateUtils.ts:34](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/dateUtils.ts#L34)
- **Severity:** Medium
- **Category:** Edge Case
- **Description:** `getTodayIsoDate()` and `toLocalIsoDate()` adjust by `getTimezoneOffset()` from the server host. They do not use `Europe/London`, unlike the formatter functions in the same file.
- **Impact:** On UTC/non-UK hosts and around DST boundaries, date-based jobs and overdue logic can run a day early or late.
- **Suggested fix:** Compute ISO dates using London-zoned conversions instead of host-local offsets.

I did not include lower-confidence style issues; these are the concrete production-impacting defects I’d prioritize first.