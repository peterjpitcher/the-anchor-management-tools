# Private booking payment repair

Kim has paid the £994.80 invoice: £250 already applied plus the verified £744.80 PayPal capture. The capture has not reached the database because the live constraints reject it. Booking calculations separately ignored invoice money.

The local changes address capture validation and recovery, consistent invoice/booking records, deposit treatment, payment history, reminders, refunds, protected financial edits and future contract totals. See [defect log](defect-log.md) and [verified evidence](discovery.md).

## Validation

- Full Vitest suite: 724 test files passed, 6,190 tests passed, two skipped. The final overpayment and contract changes passed a further focused run of 113 tests across four files.
- Full lint and cold TypeScript check passed. Production build passed twice in a separate copy to preserve the running local server, including the final source changes. The generated server-action manifest does not expose the internal capture writer.
- Actual isolated PostgreSQL runner: six PASS results covering DDL rollback, settlement, permissions, retries, repeated verified recovery and concurrent captures/manual payments.
- Actual authenticated booking and invoice pages were opened locally against live existing data, with no browser errors or warnings. Booking now recognises the applied £250 correctly. The £744.80 missing capture remains absent until approved repair.
- Synthetic held-deposit and deducted-deposit contract PDFs rendered without page-body overflow. Existing sent documents were untouched.

No customer payment, refund, message, production migration, commit, push, merge or deployment was performed. Production settlement and the deployed browser path remain unverified until approval and application.

## Changed files

Paths below are relative to `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools`.

- `scripts/testing/private-booking-settlement-postgres.py`
- `src/app/(authenticated)/private-bookings/[id]/PaymentHistoryTable.test.tsx`
- `src/app/(authenticated)/private-bookings/[id]/PaymentHistoryTable.tsx`
- `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx`
- `src/app/(authenticated)/private-bookings/[id]/page.tsx`
- `src/app/actions/__tests__/invoice-paypal.test.ts`
- `src/app/actions/__tests__/refundActions.test.ts`
- `src/app/actions/invoicePayPalActions.ts`
- `src/app/actions/invoices.ts`
- `src/app/actions/refundActions.ts`
- `src/app/api/cron/invoice-paypal-reconciliation/route.ts`
- `src/app/api/webhooks/paypal/invoices/route.ts`
- `src/lib/__tests__/contract-template.test.ts`
- `src/lib/contract-template.ts`
- `src/lib/invoices/paypal-capture.ts`
- `src/lib/private-bookings/contract-lifecycle.ts`
- `src/lib/private-bookings/payment-ledger.test.ts`
- `src/lib/private-bookings/payment-ledger.ts`
- `src/services/private-bookings.test.ts`
- `src/services/private-bookings/financial.ts`
- `src/services/private-bookings/payments.ts`
- `src/services/private-bookings/queries.ts`
- `src/services/private-bookings/scheduled-sms.ts`
- `src/types/invoices.ts`
- `src/types/private-bookings.ts`
- `supabase/migrations/20260905180000_private_booking_invoice_settlement.sql`
- `supabase/migrations/20260905180100_reconcile_verified_private_booking_capture.sql`
- `tasks/fix-function/2026-09-05-174500-private-booking-payments/base-commit.txt`
- `tasks/fix-function/2026-09-05-174500-private-booking-payments/database-validation.md`
- `tasks/fix-function/2026-09-05-174500-private-booking-payments/defect-log.md`
- `tasks/fix-function/2026-09-05-174500-private-booking-payments/discovery.md`
- `tasks/fix-function/2026-09-05-174500-private-booking-payments/todo.md`
- `tests/api/invoicePayPalReconciliation.test.ts`
- `tests/api/invoicePayPalWebhook.test.ts`
- `tests/fixtures/private-booking-settlement/live-extra-columns.json`
- `tests/fixtures/private-booking-settlement/live-functions-before.sql`
- `tests/fixtures/private-booking-settlement/live-schema-before.json`
- `tests/fixtures/private-booking-settlement/regression-after.sql`
- `tests/fixtures/private-booking-settlement/regression-before.sql`
- `tests/fixtures/private-booking-settlement/regression-repair.sql`
- `tests/services/privateBookingsFinancial.test.ts`
- `tests/services/privateBookingsScheduledSms.test.ts`

## Deliberately left unchanged

The pre-existing work in the BOH booking client, OJ Projects billing cron, tasks/todo.md, invoice delivery-state helper/test, OJ Projects billing-run-guard helper/test, design documents/sample pack/scripts, booking growth plan and SEO work was preserved. No website files, shared PayPal transport, historic migration files or sent contracts were changed.

## Production action

See [approval packet](production-approval.md) for the exact database target, SQL checksums, risk and forward-fix plan. The expected result is invoice paid_amount £994.80, status paid; booking outstanding £0 and final payment date 4 September 2026. The approved code will then be integrated, deployed and verified on the live invoice and booking pages.

Status: local only. Both named migrations and production deployment await explicit approval.
