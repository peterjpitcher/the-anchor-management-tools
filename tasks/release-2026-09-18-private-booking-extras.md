# Production release packet: private booking extras

Status: implemented and tested locally; migration not applied and application not deployed.

## Exact production target and SQL

- Supabase project: `the-anchor-management-tools`, ref `tfcasgxopxegwrabvwat`.
- Identity verified from this repository's environment URL and connected Supabase project.
- Migration name: `private_booking_supplementary_invoices`.
- Exact SQL: [20260918124021_private_booking_supplementary_invoices.sql](../supabase/migrations/20260918124021_private_booking_supplementary_invoices.sql).
- Migration SHA-256: `f71bf783b9158ca9249737ff596fa483ae758339f6dd281c8b07ca246de95077`.
- Exact rollback SQL: [matching rollback](../supabase/rollbacks/20260918124021_private_booking_supplementary_invoices.sql).
- Rollback SHA-256: `92c0d0a85567ea4eb3f5b07cdaf30da409366b7f9a2347457fc9161f89955f27`.
- Both SQL files are complete, unabridged inputs. No production SQL is to be generated or modified during application.

## Live state and impact

Read-only live checks found 69 private bookings, three original invoice associations to backfill, 63 invoices, 54 invoice payments, no credit notes and no existing booking receipts. Largest touched tables were 270,336 and 262,144 bytes. Latest migration at discovery was `20260918122623`. Schema, functions, policies, precision, dependent views and impact evidence are stored in `tests/fixtures/private-booking-settlement/extras-live-*.json`.

Adds three tables: `private_booking_invoices`, `private_booking_charge_batches`, and `private_booking_payment_receipts`. Adds nullable `invoice_payments.receipt_id` and `private_bookings.receipt_version` with a zero default. Preserves original invoice pointers, amounts, historical contracts and existing payments.

## High-risk operations and mitigations

- Backfill: inserts the three existing invoice associations. No existing charges or payment amounts are rewritten.
- Constraints and indexes: foreign keys, unique receipt allocation index, and receipt version column on populated tables. Expected brief metadata locks; five-second lock timeout prevents an indefinite wait. The entire migration is applied transactionally.
- Security: enables RLS and explicit grants for new tables, restricts receipt metadata access to staff with both booking view and pricing access, limits receipt writes to super-admins, and revokes default function access. Service-only payment and delivery functions stay service-only. Credit writes now require invoice create/edit permission.
- Settlement replacements: replaces booking balance, payment locking, payment guards, manual payment and PayPal capture functions to support multiple invoices and credits without counting deposit/payment copies twice. Recreates two dependent booking views and the invoice summary function. Trigger replacements affect invoice/payment/credit settlement, so isolated real-PostgreSQL tests cover both old and new paths.
- New write functions: atomic draft save, issue, cancel, allocation, receipt version reservation, and email delivery claim. Duplicate requests cannot create duplicate invoices or claim two simultaneous sends.
- Existing public website access remains unchanged. New financial tables and service routines are not exposed to anonymous users.

The safer fallback is to retain the currently deployed application until the checked migration is applied. Deploying the new application first would expose controls whose tables do not yet exist.

## Verification evidence

- Full London coverage run: 969 test files, 9,060 passing tests, two existing skips. Coverage: 59.27% lines, 48.78% branches, 65.71% functions, above repository floors.
- Final full UTC suite: 969 files, 9,062 passing tests, two existing skips.
- Final archive action suite: 15 passing tests, including storage failure and immutable resend snapshots.
- Actual isolated PostgreSQL: schema application, transaction rollback, explicit rollback, multiple invoices, deposits, credit totals, exact money, stale revisions, manual allocations, capture/issue concurrency, single delivery claim, actual anon/authenticated roles, pricing permissions and authorised/denied credit writes all pass.
- Chromium with actual billing/receipt components and mocked action boundaries: preview, issue, allocation, final receipt, desktop and mobile. No external requests or browser errors. Multi-page PDF fixtures rendered and visually checked.
- Independent review repaired pricing access, customer refund-note leakage, duplicate delivery, credit balance consumers and invoice archive overwrites.
- Full lint, uncached TypeScript and production build passed. The build reports an generated CSS warning for the wildcard spacing utility; compilation succeeds. Final archive tests also pass under London after the coverage run.

No real customer messages or payments were sent during testing. A real PayPal sandbox checkout has not been exercised because only live provider credentials are available. Browser automation tests actual UI components with isolated server-action fixtures, not a live financial transaction.

## Rollback and forward-fix plan

Before feature use, the supplied rollback restores the exact prior functions, views and policies, then removes the new schema. It refuses to run if a charge batch, allocated receipt or receipt version has been created. Rollback after real feature use is a forward-fix: keep financial records and private PDFs, restrict feature entry points if necessary, and repair without deleting financial history. Reverting the app alone after use must not be treated as a complete financial rollback because the old UI does not show supplementary balances.

## Post-application and release checks

1. Reconfirm project identity, migration checksum and current migration history; apply the exact SQL with Supabase MCP only.
2. Record apply-time version mapping. Re-query changed tables, columns, views, functions, triggers, grants and RLS policies.
3. Exercise new and replaced functions using synthetic rows inside a transaction guaranteed to roll back. Assert happy and rejected paths, service access, anon denial and authenticated pricing permissions.
4. Run the repository's read-only anonymous-surface assertion; confirm no public website access regression.
5. Merge only after CI passes and database checks pass. Verify the exact main commit reaches Vercel Ready and that the canonical production domain resolves to that deployment ID.
6. Use the existing authenticated browser for read-only checks of booking billing, receipt preview and permissions. Check bounded production runtime errors. Do not send an invoice, take a payment or alter customer records as a smoke test.

## Deliberately unchanged

The public website, supplier receipt processing, historical Stripe paths, other OJ-project account ledgers and the user's original dirty checkout are unchanged. Original invoice amounts and signed contracts remain unchanged. No new dependencies or environment variables were added.

## Changed file inventory

- `scripts/testing/private-booking-extras-browser.mjs`
- `scripts/testing/private-booking-extras-postgres.py`
- `src/app/(authenticated)/dashboard/dashboard-data.ts`
- `src/app/(authenticated)/dashboard/private-booking-balances.ts`
- `src/app/(authenticated)/invoices/MobileInvoiceCard.tsx`
- `src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx`
- `src/app/(authenticated)/invoices/[id]/payment/page.tsx`
- `src/app/(authenticated)/invoices/_components/InvoicesClient.tsx`
- `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx`
- `src/app/(authenticated)/private-bookings/[id]/items/page.tsx`
- `src/app/(authenticated)/private-bookings/[id]/page.tsx`
- `src/app/actions/__tests__/invoices-receipt.test.ts`
- `src/app/actions/email.ts`
- `src/app/actions/invoicePayPalActions.ts`
- `src/app/actions/invoices.ts`
- `src/app/actions/privateBookingExtras.ts`
- `src/app/actions/privateBookingInvoice.ts`
- `src/app/actions/privateBookingReceipt.ts`
- `src/app/api/cron/auto-send-invoices/route.ts`
- `src/app/api/cron/invoice-paypal-reconciliation/route.ts`
- `src/app/api/cron/invoice-reminders/route.ts`
- `src/app/api/invoices/export/route.ts`
- `src/app/api/private-bookings/[id]/receipts/[documentId]/route.ts`
- `src/app/api/private-bookings/event-sheet/route.ts`
- `src/app/invoice-portal/[token]/page.tsx`
- `src/components/modals/ChasePaymentModal.tsx`
- `src/components/private-bookings/PrivateBookingBilling.tsx`
- `src/components/private-bookings/PrivateBookingReceiptPanel.tsx`
- `src/lib/brand/palette.ts`
- `src/lib/email/private-booking-emails.ts`
- `src/lib/invoice-template-compact.ts`
- `src/lib/invoices/__tests__/balance.test.ts`
- `src/lib/invoices/__tests__/email-drafts.test.ts`
- `src/lib/invoices/__tests__/payment-link-footer.test.ts`
- `src/lib/invoices/__tests__/paypal-capture.test.ts`
- `src/lib/invoices/balance.ts`
- `src/lib/invoices/email-drafts.ts`
- `src/lib/invoices/payment-link-footer.ts`
- `src/lib/invoices/paypal-capture.ts`
- `src/lib/microsoft-graph.ts`
- `src/lib/private-bookings/booking-receipt-loader.ts`
- `src/lib/private-bookings/booking-receipt-pdf.ts`
- `src/lib/private-bookings/booking-receipt.ts`
- `src/lib/private-bookings/contract-lifecycle.ts`
- `src/lib/private-bookings/extra-charges.ts`
- `src/lib/private-bookings/invoice-access.ts`
- `src/lib/private-bookings/payment-ledger.test.ts`
- `src/lib/private-bookings/payment-ledger.ts`
- `src/lib/private-bookings/payment-statement-loader.ts`
- `src/lib/private-bookings/payment-statement.ts`
- `src/services/invoices.ts`
- `src/services/private-bookings.test.ts`
- `src/services/private-bookings/queries.ts`
- `src/services/private-bookings/scheduled-sms.ts`
- `src/types/invoices.ts`
- `src/types/private-bookings.ts`
- `supabase/migrations/20260918124021_private_booking_supplementary_invoices.sql`
- `supabase/rollbacks/20260918124021_private_booking_supplementary_invoices.sql`
- `tasks/plan-2026-09-18-private-booking-extras.md`
- `tasks/release-2026-09-18-private-booking-extras.md`
- `tasks/spec-2026-09-18-private-booking-additional-charges.md`
- `tests/actions/invoiceChaseCredits.test.ts`
- `tests/actions/privateBookingExtras.test.ts`
- `tests/components/PrivateBookingBilling.test.tsx`
- `tests/ds/brand-palette.test.ts`
- `tests/fixtures/private-booking-settlement/extras-live-document-policies.json`
- `tests/fixtures/private-booking-settlement/extras-live-functions.json`
- `tests/fixtures/private-booking-settlement/extras-live-impact.json`
- `tests/fixtures/private-booking-settlement/extras-live-invoice-summary.json`
- `tests/fixtures/private-booking-settlement/extras-live-precision.json`
- `tests/fixtures/private-booking-settlement/extras-live-schema.json`
- `tests/fixtures/private-booking-settlement/extras-live-views.json`
- `tests/fixtures/private-booking-settlement/regression-extras.sql`
- `tests/lib/pdfTemplates.test.ts`
- `tests/lib/private-bookings/booking-receipt-actions.test.ts`
- `tests/lib/private-bookings/booking-receipt-loader.test.ts`
- `tests/lib/private-bookings/booking-receipt-storage.test.ts`
- `tests/lib/private-bookings/booking-receipt.test.ts`
- `tests/lib/privateBookingAggregateDashboard.test.ts`
- `tests/services/privateBookingsFinancial.test.ts`
- `tests/services/privateBookingsScheduledSms.test.ts`
