# QA Specialist Report -- Private Bookings Section

Generated: 2026-05-11 | Phase 1 Remediation Review

---

## Defect Log

| ID | Severity | Summary | Business Impact | Test Case(s) | File:Line |
|----|----------|---------|-----------------|--------------|-----------|
| DEF-001 | **CRITICAL** | Deposit amount hardcoded to GBP 250 -- no per-person calculation | Business rule says GBP 10/person for groups of 7+. All bookings default to flat GBP 250 regardless of guest count. Staff must manually override every time. | TC-A-3, TC-A-4 | `new/page.tsx` (defaultValue="250"), `mutations.ts:~248` |
| DEF-002 | **CRITICAL** | Contract template contains "cash only" deposit language despite PayPal support | Customer-facing legal document says deposit must be paid in cash. Contradicts the actual PayPal deposit flow. T&C hardcodes GBP 250 cash deposit. | TC-H-2, TC-L-2 | `contract-template.ts:712,736,763` |
| DEF-003 | **CRITICAL** | Contract T&C says deposit becomes non-refundable on cancellation but refundable SMS variants exist | T&C line 770 states cancelled deposits are non-refundable. But the cancellation flow has a refundable outcome that sends SMS promising refund. Legal contradiction. | TC-H-2 | `contract-template.ts:770` vs `mutations.ts` |
| DEF-004 | **HIGH** | No venue-hosted event exemption for private bookings | is_venue_event field exists only in table-bookings FOH flow. Private bookings have no toggle and no deposit exemption logic. | TC-A-5 | `new/page.tsx`, `mutations.ts:213` |
| DEF-005 | **HIGH** | Edit form bypasses status transition validation | Edit page shows all 4 statuses unconditionally. updateBooking() does NOT validate transitions. Only updateBookingStatus() has the ALLOWED_TRANSITIONS map. | TC-B-7 | `[id]/edit/page.tsx`, `mutations.ts:~400` |
| DEF-006 | **HIGH** | Cancelled/completed bookings can be edited | No status guard on the edit page or updateBooking() mutation. Staff can modify cancelled booking details. | TC-B-6 | `[id]/edit/page.tsx`, `mutations.ts:~400` |
| DEF-007 | **HIGH** | Balance payments can be recorded on cancelled/completed bookings | Neither the server action nor the service function checks booking status before inserting a payment row. | TC-D-3, TC-D-4 | `actions/privateBookingActions.ts:~900`, `payments.ts` |
| DEF-008 | **HIGH** | Cancellation does not cancel scheduled/pending SMS | cancelBooking() queues a new cancellation SMS but does not cancel previously scheduled messages. Customer could receive contradictory messages. | TC-F-3 | `mutations.ts:~1050-1100` |
| DEF-009 | **HIGH** | Expire-holds cron does not notify customer | Cron directly updates status to cancelled without sending any SMS. Customer booking vanishes without notification. | TC-J-5 | `cron/private-bookings-expire-holds/route.ts` |
| DEF-010 | **MEDIUM** | Edit page has no deposit amount field | Once created, deposit amount cannot be changed through the main edit flow. Only separate deposit management actions can modify it. | TC-B-1 | `[id]/edit/page.tsx` |
| DEF-011 | **MEDIUM** | No overpayment guard in application code for balance payments | recordBalancePayment() inserts payment without checking if amount exceeds remaining balance. | TC-D-2 | `payments.ts` |
| DEF-012 | **LOW** | Zod schema allows booking with only first name | privateBookingSchema only requires customer_first_name. Phone/customer resolution throws at mutation time, not at validation. | TC-A-2 | `types.ts:118` |
| DEF-013 | **LOW** | No rate limiting on public booking endpoint | /api/public/private-booking route has no visible rate limiting. Spam could create many draft bookings and trigger SMS sends. | TC-K-3 | `api/public/private-booking/route.ts` |

---

## Coverage Assessment

### Well-Covered Areas
- Booking creation flow: End-to-end from form to DB insert, including customer resolution, phone normalization, and initial SMS
- Deposit PayPal flow: Order creation, capture, amount validation, idempotency checks, and DB finalization
- Cancellation flow: Financial outcome resolution, variant-specific SMS, audit logging, calendar cleanup
- Delete gate: DB trigger correctly prevents deletion of SMS-contacted bookings, allows cancelled
- SMS side effects: Comprehensive SMS for creation, confirmation, date change, setup reminder, completion, and 4 cancellation variants
- Contract generation: Auth, permission, version tracking, audit logging, HTML generation
- Cron idempotency: Both crons safely handle re-runs

### Gaps and Missing Coverage
- Refund execution: No code exists to actually process refunds (PayPal or manual). Amounts calculated for SMS but never acted on
- Concurrent payment protection: No application-level locking for balance payments
- FK cascade behaviour: Cannot determine from code whether deleting a booking cascades to payments/items
- Public endpoint rate limiting: No application-level protection visible
- Guest count / deposit auto-calculation: Business rule completely unimplemented
- Venue-hosted event exemption: Not implemented for private bookings section

### Cannot Be Tested from Code Alone
- DB-level constraints on overpayment (RPC/check constraints)
- FK cascade behaviour on delete (ON DELETE CASCADE vs RESTRICT)
- Twilio delivery tracking and rate limiting
- Vercel/Cloudflare-level rate limiting on public endpoints
- Actual PayPal refund capability

---

## Critical Findings (Ranked)

### 1. Contract Legal Inconsistencies (DEF-002, DEF-003)
Contract says cash only when PayPal is supported, hardcodes GBP 250, and says deposit is non-refundable when refundable SMS variants exist.

### 2. Deposit Calculation Not Implemented (DEF-001)
GBP 10/person business rule for groups of 7+ is nowhere in the code. Every booking defaults to GBP 250.

### 3. Status Transition Bypass via Edit Form (DEF-005, DEF-006)
Edit form allows any status transition and editing of cancelled/completed bookings because it bypasses ALLOWED_TRANSITIONS validation.

### 4. Silent Cancellation from Cron (DEF-009)
Hold expiry cron cancels bookings without customer notification.

### 5. Orphaned Scheduled SMS After Cancellation (DEF-008)
Cancelling a booking does not cancel previously scheduled messages.

### 6. Balance Payments on Cancelled/Completed Bookings (DEF-007)
No status guard on payment recording allows payments against cancelled bookings.

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| Total test cases | 53 |
| PASS | 30 |
| FAIL | 13 |
| WARN | 8 |
| UNTESTABLE | 7 |
| Defects logged | 13 |
| Critical severity | 3 |
| High severity | 6 |
| Medium severity | 2 |
| Low severity | 2 |
