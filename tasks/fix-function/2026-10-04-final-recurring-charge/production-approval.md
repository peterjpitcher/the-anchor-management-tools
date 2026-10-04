# Final recurring charge: production approval packet

## Delivered locally

OJ Projects > Clients > View > Recurring Charges now has an End charge action. It asks for the last service day, previews uninvoiced amounts and requires confirmation. Calendar-day proration includes the last service day. Earlier debt remains collectable, missing completed cycles are included in the preview, and future service is removed. Monthly caps still apply. The final charge follows the normal billing schedule; ending sends no email and does not create an invoice immediately.

Dates and amounts already attached to an invoice are protected. A proposed end before already-invoiced service is refused and requires a separate invoice correction or credit. Confirmed end dates are immutable; restarting service needs a new charge. No existing customer charge has been ended.

## Exact production change

- Target: the-anchor-management-tools, **tfcasgxopxegwrabvwat**, matching `supabase/.temp/project-ref` and the connected production project.
- Migration name: `oj_recurring_charge_end_date`.
- Exact SQL: [20261004105351_oj_recurring_charge_end_date.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20261004105351_oj_recurring_charge_end_date.sql).
- SHA-256: `c6486cfdecb20f1d5b9e3ccdb294d9b2d53ccb213b93e732f803fe55d3069afe`.
- Latest production migration checked at discovery: `20261002061500_receipts_no_receipt_count_after_lock`. Recheck history immediately before applying.
- Rollback SQL: [rollback.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tasks/fix-function/2026-10-04-final-recurring-charge/rollback.sql).

The production application must use the verified Supabase migration tool after owner approval of this project, this checksum and this rollback plan. This packet also covers packaging only the listed feature files onto current main, pushing and merging that change, deploying it and verifying the resulting Vercel deployment. It does not authorise ending Barons' charge or any other real charge, or sending invoices manually.

## Objects and data

The migration adds one nullable `end_date` column to `oj_vendor_recurring_charges`; it does not end or backfill any existing charge. It adds the authenticated, edit-permission checked `oj_end_recurring_charge` preview/confirmation function, three protected trigger functions and a service-only reissue wrapper. Triggers reserve charge definitions around billing, refuse post-end service and prevent altering confirmed endings. No new anon grants are issued.

The explicit SECURITY DEFINER routines are higher-risk statements: closure needs to update instances under the existing manage-only RLS rule even when the authorised owner has edit permission. The closure RPC verifies the signed-in user and edit permission; trigger functions cannot be called directly by anon or authenticated; the reissue wrapper is restricted to service_role. Confirmation atomically updates the snapshots and audit record, and refuses a changed preview.

Affected live table sizes at discovery: charges 49,152 bytes; instances 147,456 bytes. The two charge tables have no dependent views or application triggers before this change. Adding the nullable column and triggers takes short metadata locks and does not rewrite existing rows. A closure later locks one charge and its instances, prorates uninvoiced service and removes only amounts strictly after the selected date. Processing billing runs and invoice reservations block conflicting changes.

## Validation

- Lint: passed, zero warnings.
- App types: passed with `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit`.
- Test types: passed with `npm run typecheck:tests`.
- London full suite: 1,161 files passed; 10,929 tests passed; two existing skips.
- UTC full suite: 1,161 files passed; 10,929 tests passed; two existing skips.
- Isolated PostgreSQL assertions: passed. Covers preview without mutation, exact confirmation, stale rollback, retained debt, missed cycles, cap penny allocation, future end dates, first-day and leap-year proration, billed coverage, reservations, permissions, RLS and atomic audit.
- Concurrent sessions: billing waits for closure; closure waits for billing then refuses; actual anon role cannot call the RPC.
- Existing reissue transaction smoke test: a £100 October fixture ended on 15 October produced £48.39 ex VAT plus £9.68 VAT, and the real transaction attached that final instance to a draft. A virtual annual charge retained its full coverage dates. All smoke records were rolled back.
- Rollback: tested before first use; tested refusal after an ended charge exists.
- Live anon surface: all nine checks passed, including all 12 website tables and three website RPCs. This is pre-application evidence; repeat after applying.
- Production build: passed, exit 0. Next.js compiled successfully and emitted the route manifest.

The isolated database runs PostgreSQL 17. Production reports PostgreSQL 15; the migration uses syntax available in PostgreSQL 15. The full signed-in production browser path remains unverified until the approved migration and deployment. Component tests exercised the actual DS modal, with server actions mocked; no real customer was used to test a mutation.

## Rollout and rollback

1. Re-confirm project identity, live schema and migration history. Confirm the SQL checksum still matches this packet.
2. Apply the additive migration first. Keep the returned history mapping, then verify definitions, ownership, grants and the anon surface.
3. Package only these feature changes onto current main. Re-run required checks after that integration. The current shared checkout was 63 commits behind origin/main at discovery; the recurring-charge and billing files matched fetched main. Preserve all initially dirty work.
4. Push, merge and deploy the app changes, then verify the exact Vercel deployment.
5. In a signed-in browser, open Clients > View > Recurring Charges > End charge, preview a last service date and cancel. Check logs and balances without ending a real charge or sending an invoice. Any production mutation smoke test needs a rollback transaction or dedicated test data with confirmed cleanup.

Before first use, revert the app change first and apply the linked rollback SQL. The rollback refuses once any charge has an end date. After first use, retain end dates, snapshots and audit evidence and ship a forward fix; do not expose ended clients to the old full-period billing logic.

## Files changed

- [src/app/(authenticated)/oj-projects/clients/_components/ClientsClient.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/clients/_components/ClientsClient.tsx)
- [src/app/(authenticated)/oj-projects/clients/_components/EndRecurringChargeModal.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/clients/_components/EndRecurringChargeModal.tsx)
- [src/app/(authenticated)/oj-projects/clients/_components/EndRecurringChargeModal.test.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/clients/_components/EndRecurringChargeModal.test.tsx)
- [src/app/actions/oj-projects/recurring-charges.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/recurring-charges.ts)
- [src/app/actions/oj-projects/__tests__/recurring-charge-end.test.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/__tests__/recurring-charge-end.test.ts)
- [src/app/actions/oj-projects/invoice-reissue.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/invoice-reissue.ts)
- [src/app/actions/oj-projects/__tests__/invoice-reissue.test.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/__tests__/invoice-reissue.test.ts)
- [src/app/api/cron/oj-projects-billing/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts)
- [src/lib/oj-projects/recurring-proration.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/oj-projects/recurring-proration.ts)
- [src/lib/oj-projects/__tests__/recurring-proration.test.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/oj-projects/__tests__/recurring-proration.test.ts)
- [src/types/database.generated.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts)
- [supabase/migrations/20261004105351_oj_recurring_charge_end_date.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20261004105351_oj_recurring_charge_end_date.sql)
- [tests/integration/oj-recurring-charge-end/README.md](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tests/integration/oj-recurring-charge-end/README.md)
- [tests/integration/oj-recurring-charge-end/assertions.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tests/integration/oj-recurring-charge-end/assertions.sql)
- [tests/integration/oj-recurring-charge-end/concurrency.py](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tests/integration/oj-recurring-charge-end/concurrency.py)
- [tests/integration/oj-recurring-charge-end/reissue-smoke.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tests/integration/oj-recurring-charge-end/reissue-smoke.sql)
- [tests/integration/oj-recurring-charge-end/schema.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tests/integration/oj-recurring-charge-end/schema.sql)

Run artefacts are confined to `tasks/fix-function/2026-10-04-final-recurring-charge`: baseline, discovery, findings, plan, this packet and rollback.

## Files deliberately left

- `src/app/actions/oj-projects/client-balance.ts`, `client-statement.ts` and `work-record.ts`: they already read stored snapshots and retain active-parent arrears. Ended definitions stay billing-eligible, with their end date controlling creation.
- `src/lib/oj-projects/charges.ts` and `recurring-periods.ts`: VAT arithmetic and existing anniversary scheduling remain the source of truth. The new helper wraps coverage only.
- `src/app/actions/recurring-invoices.ts`: recurring invoice templates are a separate feature.
- Existing Disable behaviour in `recurring-charges.ts`: retained as a separate action, with its existing destructive warning; End charge never calls it.
- `supabase/migrations/20260703002000_reissue_oj_invoice_transaction.sql`: unchanged. The wrapper preserves coverage and delegates to that transaction.
- Email, payment collection and invoice sender identity: unchanged.
- Initially dirty marketing files, `tasks/todo.md`, `tasks/lessons.md` and unrelated discovery documents: preserved.

## Status

Local only. No commit, push, merge, production migration, deployment, charge ending or manual invoice send has occurred. Production application and deployment await the owner's explicit approval of this packet. All local checks are recorded; the production browser check follows approved rollout.
