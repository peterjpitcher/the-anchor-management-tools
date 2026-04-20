# Workflow & Failure-Path Review: OJ Projects Review Spec

**Date:** 2026-04-14
**Reviewer:** Workflow & Failure-Path Specialist
**Spec:** `docs/superpowers/specs/2026-04-14-oj-projects-review-design.md`

---

## Phase 1: Bug Fixes

### WF-001 — Existing data violating new one_off constraint
**Severity:** Critical
**Scenario:** The migration adds a constraint requiring `duration_minutes_rounded`, `miles`, `hourly_rate_snapshot`, and `mileage_rate_snapshot` to be null for `one_off` entries. If existing rows violate this, the migration fails and the entire deployment is blocked.
**What the spec says:** "Also add a data-fix query to null out any existing spurious values on `one_off` entries."
**What should be specified:** The data-fix query MUST run BEFORE the constraint is added, in the same migration. The spec should include an explicit SQL snippet ordering: (1) UPDATE to null out spurious values, (2) ALTER TABLE to add the constraint. It should also specify a pre-migration audit query to count violating rows so the developer can verify the fix worked. Example:
```sql
-- Audit: SELECT count(*) FROM oj_entries WHERE entry_type = 'one_off' AND (duration_minutes_rounded IS NOT NULL OR miles IS NOT NULL);
-- Fix: UPDATE ... SET ... WHERE ...
-- Then: ALTER TABLE ADD CONSTRAINT ...
```

### WF-002 — Cap-mode proportional split rounding to sub-penny amounts
**Severity:** High
**Scenario:** When splitting by monetary amount proportion, e.g., a cap remaining of £10.33 across three entries worth £100.00 total, proportional allocation produces values like £3.4433... The spec says "split by monetary amount proportion" but does not specify a rounding strategy.
**What the spec says:** "Split by monetary amount proportion rather than time range."
**What should be specified:** The rounding strategy must be explicit. Recommendation: round each split to 2 decimal places using banker's rounding, and apply any remainder (positive or negative penny) to the last entry in the batch. This prevents the sum of splits from exceeding or falling short of the cap. Also specify: what if only one entry partially fits? The remainder entry should get `cap_amount - sum_of_all_other_splits` rather than its own proportional calculation.

### WF-003 — Cap-mode split with zero-cost entries
**Severity:** Medium
**Scenario:** If an entry has `hourly_rate_ex_vat_snapshot = 0` or `duration_minutes_rounded = 0`, its monetary value is £0. Proportional splitting by amount will assign it £0 of the cap, but there may still be entries "below" it that have value. Division by zero risk if total amount of entries in the batch is £0.
**What the spec says:** Nothing about zero-value entries in the split.
**What should be specified:** If total batch monetary value is £0, skip splitting entirely and log a warning. Zero-value entries should pass through without splitting since they consume no cap.

---

## Phase 2: Client Statement

### WF-004 — Vendor with zero transactions in date range
**Severity:** Medium
**Scenario:** User requests a statement for a vendor with no invoices or payments in the selected date range. The opening balance may also be £0 if the vendor is new.
**What the spec says:** Nothing about empty transaction lists.
**What should be specified:** The UI should show a clear "No transactions found for this period" message. The PDF should still be generatable (showing opening balance = closing balance = £0 or whatever the computed opening is). The "Email to Client" button should show a confirmation: "This statement contains no transactions. Send anyway?"

### WF-005 — Opening balance includes voided invoices
**Severity:** High
**Scenario:** The spec computes opening balance as "sum of all unpaid invoice amounts with `created_at < dateFrom`". If a voided invoice exists before the date range, it would inflate the opening balance. The current `client-balance.ts` filters out `void` and `written_off` statuses (line 55), but the spec for the statement doesn't mention this filter.
**What the spec says:** "Opening balance: sum of all unpaid invoice amounts with `created_at < dateFrom`."
**What should be specified:** Explicitly state that voided and written-off invoices are excluded from the opening balance calculation. The query must filter `status NOT IN ('void', 'written_off', 'paid')` for the opening balance, consistent with the existing `client-balance.ts` pattern. Also clarify: should `draft` invoices be included? They are technically unpaid but may not have been sent.

### WF-006 — Vendor has no billing contact email
**Severity:** High
**Scenario:** User clicks "Email to Client" but the vendor has no email in `oj_vendor_billing_settings`, `invoice_vendors`, or `invoice_vendor_contacts`. The current `resolveInvoiceRecipientsForVendor()` (invoices.ts lines 62-110) returns `{ to: null, cc: [] }` in this case.
**What the spec says:** "To: Vendor billing contact email (from `oj_vendor_billing_settings` or `invoice_vendors`)."
**What should be specified:** The "Email to Client" button should be disabled (greyed out with tooltip "No billing email configured") when no email is available. If somehow clicked, the action should return a user-friendly error: "Cannot send statement — no billing email address configured for this vendor." The spec should reference the existing `resolveInvoiceRecipientsForVendor()` pattern for email resolution.

### WF-007 — PDF generation for very long statements (100+ transactions)
**Severity:** Medium
**Scenario:** A vendor with monthly invoices and multiple partial payments could accumulate 100+ transactions over a year. The Puppeteer PDF pipeline may produce a very long PDF.
**What the spec says:** "Uses `generatePDFFromHTML()` (same Puppeteer pipeline as invoices/timesheets)."
**What should be specified:** The PDF template must include proper CSS page-break rules: `page-break-inside: avoid` on table rows, repeat table headers on each page (`thead { display: table-header-group }`), and page numbers in the footer. Also set a sensible max page count or warn if the statement exceeds, say, 20 pages. The existing invoice PDF doesn't face this issue since invoices rarely exceed 2 pages.

### WF-008 — Race condition: statement generated during active billing run
**Severity:** High
**Scenario:** The billing cron sets entries to `billing_pending` status during processing. If a user generates a statement at this moment, entries in `billing_pending` are neither `unbilled` nor `billed` — they exist in limbo. The statement's transaction list (based on invoices) won't include them yet, but the opening/closing balance calculation could be wrong if it relies on entry status.
**What the spec says:** Nothing about the `billing_pending` intermediate state.
**What should be specified:** The statement should be based exclusively on `invoices` and `invoice_payments` tables (which are the final, committed records), NOT on `oj_entries` status. This makes the statement immune to billing cron timing. Add a note: "Statement accuracy depends on committed invoices only. Entries currently in a billing run will appear on the next statement after the billing run completes and the invoice is created." If the statement also shows unbilled totals, those should exclude `billing_pending` entries or include a caveat.

### WF-009 — Microsoft Graph email failure does not block PDF download
**Severity:** Medium
**Scenario:** User generates a statement, then clicks "Email to Client". The email fails (Graph API down, token expired, rate limited). The user should still be able to download the PDF.
**What the spec says:** "Download PDF" and "Email to Client" are listed as separate buttons.
**What should be specified:** Confirm that PDF generation and email sending are independent operations. The PDF should be generated client-side (or cached) before the email is attempted. If email fails, show a toast error but the PDF remains downloadable. The statement data should be fetched once and reused for both operations.

---

## Phase 3: Partial Payment Receipts

### WF-010 — Rapid successive partial payments cause double-send
**Severity:** Critical
**Scenario:** Two payments recorded within seconds (e.g., user double-clicks, or two admins record simultaneously). Both trigger `sendPaymentReceipt()`. The email log dedup check races: both check before either writes, both proceed to send.
**What the spec says:** "Guard against double-send using invoice_email_logs."
**What should be specified:** The dedup key must be defined explicitly. Current `invoice_email_logs` schema has no `payment_id` column — only `invoice_id`, `sent_to`, `sent_at`, and `subject`. The spec should: (1) Add a `payment_id` column to `invoice_email_logs` (or use a composite of `invoice_id` + payment amount + payment date as a unique constraint). (2) Use a SELECT ... FOR UPDATE or an INSERT with ON CONFLICT to make the dedup check atomic. (3) Define the dedup window — e.g., "no receipt for the same invoice within 60 seconds of the last sent receipt." Without a `payment_id` column, there is no reliable way to deduplicate payment-specific receipts.

### WF-011 — Payment recorded but email sending fails
**Severity:** Medium
**Scenario:** `InvoiceService.recordPayment()` succeeds (payment is persisted to DB), but `sendPaymentReceipt()` fails. The payment is recorded but no receipt is sent.
**What the spec says:** The existing code already handles this — the payment is committed first, then email is attempted. The existing code logs failures to `invoice_email_logs` with status `failed`.
**What should be specified:** This is adequately handled by the current architecture. However, the spec should note: (1) The `recordPayment` action should still return `{ success: true }` even if the receipt email fails (currently it does). (2) Add a UI indicator showing "Payment recorded, receipt email failed" so the user can manually resend. (3) Consider a "Resend Receipt" button on the payment detail view.

### WF-012 — Receipt shows specific payment vs total
**Severity:** High
**Scenario:** Invoice has payments from bank transfer (£500) and then card (£200). The partial receipt for the £200 card payment should show that specific payment, not aggregate £700.
**What the spec says:** "For partial payments, ensure `outstandingBalance` is populated with the remaining amount."
**What should be specified:** The receipt must show: (a) This payment amount (the specific payment just recorded), (b) Payment method for this specific payment, (c) Total paid to date, (d) Outstanding balance remaining. The current `sendRemittanceAdviceForPaidInvoice` already does this (line 163-174 picks the latest payment), but the spec should explicitly confirm this pattern carries forward. The PDF `remittance_advice` template should be verified to display "Payment Amount" distinct from "Total Paid to Date".

### WF-013 — Dedup key is undefined
**Severity:** Critical
**Scenario:** The spec says "use the existing `invoice_email_logs` table to check for recent sends against the same invoice + payment combination" but the `invoice_email_logs` table has NO `payment_id` column (confirmed from migration schema). The only available columns are `invoice_id`, `sent_to`, `subject`, `body`, `status`, `sent_at`.
**What the spec says:** "Guard: Ensure we don't double-send if `recordPayment()` is called multiple times (use the existing `invoice_email_logs` table)."
**What should be specified:** Either: (a) Add a `payment_id uuid REFERENCES invoice_payments(id)` column to `invoice_email_logs` in the migration, making dedup trivial — check for existing row with same payment_id. Or (b) Define a compound dedup check using `invoice_id` + `subject LIKE '%Payment Received%'` + `sent_at > now() - interval '5 minutes'`. Option (a) is strongly preferred for correctness.

### WF-014 — Invoice has no vendor/client email
**Severity:** Medium
**Scenario:** A payment is recorded on an invoice whose vendor has no email address. The receipt sending should fail gracefully.
**What the spec says:** Nothing specific about this for the partial payment case.
**What should be specified:** The existing `sendRemittanceAdviceForPaidInvoice` already handles this (line 154: returns `{ sent: false, skippedReason: 'no_recipient' }`). The spec should confirm this pattern is preserved in the renamed `sendPaymentReceipt()`. The `recordPayment` action should return `remittanceAdvice: { sent: false, skippedReason: 'no_recipient' }` and the UI should display "Payment recorded. No receipt sent — vendor has no email address."

---

## Phase 4: Completeness Enhancements

### WF-015 — Voiding an invoice with existing partial payments
**Severity:** Critical
**Scenario:** Invoice has £500 total, £200 already paid. User voids the invoice. What happens to the £200? Is it refunded? Applied as credit? Lost?
**What the spec says:** "Sets status to `void`, records reason and timestamp. Reverses the effect on linked `oj_entries` — sets them back to `unbilled`."
**What should be specified:** The spec MUST address payment reversal explicitly. Options: (a) Prevent voiding invoices with payments — require a credit note instead. (b) Void the invoice AND create an automatic credit note for the paid amount, credited to the vendor's balance. (c) Require the user to manually record a refund before voiding. Recommendation: Option (a) is safest — add a guard: `if (invoice.paid_amount > 0) return { error: 'Cannot void an invoice with payments. Issue a credit note instead.' }` The current `updateInvoiceStatus` already checks for linked OJ entries but not for existing payments.

### WF-016 — Credit note exceeds outstanding balance
**Severity:** High
**Scenario:** Vendor has £100 outstanding. A credit note for £150 is issued. The vendor now has a -£50 balance (they are owed money).
**What the spec says:** "New `credit_notes` table... Server action: `createCreditNote(vendorId, amount, reason, invoiceId?)`."
**What should be specified:** Define whether negative balances are permitted. Options: (a) Allow negative balances — the client statement shows a credit balance, and it's applied to the next invoice. (b) Block credit notes that exceed outstanding — return validation error. (c) Allow but warn with a confirmation dialog. Recommendation: Option (a) with a warning. The `createCreditNote` action should check current balance and warn if the credit note will create a negative balance, but not block it (legitimate use case: refund after overpayment). The client statement must handle negative closing balances correctly (display as "Credit Balance: £50.00" not "-£50.00").

### WF-017 — Billing cron alerting: definition of "failure"
**Severity:** Medium
**Scenario:** The billing cron processes 10 vendors. 8 succeed, 1 throws an exception (caught), 1 produces an invoice with £0 total (anomalous but not an error). What gets reported?
**What the spec says:** "If any vendor billing failed (caught exceptions, partial failures), send an internal alert email... Also fire on zero-vendor runs."
**What should be specified:** Define failure tiers explicitly:
- **Hard failure:** Caught exception during vendor processing — always alert, include stack trace
- **Soft failure:** Invoice created but anomalous (£0 total, no line items, negative amount) — alert as warning
- **Skipped vendor:** Vendor has no billable entries for the period — not a failure, but include in summary count
- **Zero-vendor run:** No vendors processed at all — alert as anomaly
- **Email sending failure:** Invoice created but email failed — alert, but don't block the billing run

The alert email should include: total vendors processed, succeeded, failed (with reasons), skipped, and whether invoice emails were sent successfully. The current cron has no error aggregation — exceptions would crash the entire run. The spec should clarify: does each vendor billing run in a try/catch so one failure doesn't block the rest?

### WF-018 — Void invoice appears as credit on statement (circular reference risk)
**Severity:** Medium
**Scenario:** Phase 4.4 says "Voided invoices appear on the client statement as a credit entry (negative debit)." But Phase 2 defines the statement as reading from `invoices` and `invoice_payments`. If a voided invoice appears as both a debit (when created) and a credit (when voided), the statement needs to handle this correctly.
**What the spec says:** "Voided invoices appear on the client statement as a credit entry (negative debit)."
**What should be specified:** Define exactly how voided invoices render on the statement timeline:
- Invoice creation date: show as debit (original amount) with description "Invoice OJ-2026-001"
- Void date: show as credit (negative of original amount) with description "Invoice OJ-2026-001 — VOIDED"
- Net effect: zero
- The opening balance calculation must exclude voided invoices entirely (they net to zero), or include both the debit and credit entries. Excluding is simpler and less error-prone.

---

## Summary

| Severity | Count | IDs |
|----------|-------|-----|
| Critical | 4 | WF-001, WF-010, WF-013, WF-015 |
| High | 5 | WF-002, WF-005, WF-006, WF-008, WF-012, WF-016 |
| Medium | 7 | WF-003, WF-004, WF-007, WF-009, WF-011, WF-014, WF-017, WF-018 |
| Low | 0 | — |

**Top 3 risks requiring spec revision before implementation:**
1. **WF-015** — Voiding invoices with partial payments has undefined behaviour for the money already received
2. **WF-010/WF-013** — Partial payment receipt dedup is unimplementable without schema changes to `invoice_email_logs`
3. **WF-001** — Migration ordering for the constraint fix must be explicit or the deployment will fail
