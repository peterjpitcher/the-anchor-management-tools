# Private booking settlement: local database validation

Production target verified from this repository's Supabase URL and read-only catalogue queries: `tfcasgxopxegwrabvwat`. Both migrations remain local drafts and have not been applied.

## Files to approve

1. `supabase/migrations/20260905180000_private_booking_invoice_settlement.sql` changes the settlement functions, CHECKs, view and guards. Its complete contents are the proposed schema SQL.
2. `supabase/migrations/20260905180100_reconcile_verified_private_booking_capture.sql` is a separate, guarded repair for the verified capture. Its complete contents are the proposed data SQL.

The main agent must calculate both SHA-256 checksums immediately before presenting approval and again before applying. Any edit invalidates the earlier checksum.

## Verified live facts

- `invoice_payments_payment_method_check` excluded `paypal`; `invoice_payments_source_kind_check` also excluded `paypal`. The existing PayPal RPC attempted both values.
- There were no payment-ledger recalculation or synchronisation triggers.
- `calculate_private_booking_balance`, `apply_balance_payment_status` and the detail view used only `private_booking_payments`, missing invoice-origin payments and applied deposits.
- `record_invoice_payment_transaction` locked the invoice before any booking lock. The new entry points consistently lock the booking and then the invoice.
- The live detail view uses `security_invoker=on`; its columns, order and invoker behaviour are preserved.
- The latest applied migration observed was `20260905124510`.
- Approximate live row counts: invoices 60, invoice payments 50, private bookings 43, booking payments 8, invoice line items 158, booking items 79, refunds 3. These tables are small, between 32 KB and 256 KB each.

## Local runtime evidence

Run `python3 scripts/testing/private-booking-settlement-postgres.py` from the repository. The harness creates an isolated PostgreSQL cluster, accepts no connection string, disables TCP listeners, uses a temporary Unix socket and always stops the cluster. It cannot connect to production.

Observed output:

```text
PASS full DDL transaction rollback
PASS settlement ledger, mirrors, invalid states, dates, permissions and retries
PASS verified-capture recovery and repeated recovery
PASS concurrent captures
PASS concurrent manual booking and invoice payments
PASS isolated PostgreSQL settlement migrations and recovery
```

The fixture imports live column, CHECK and financial foreign-key definitions, existing invoice creation/cancellation functions, VAT functions and the real permission wrapper. It reproduces the former PayPal CHECK error before applying the migration. Runtime assertions exercise the successful payment, duplicates, conflicting amount/invoice, non-finite amounts, actual overpayments, capture immutability, booking-payment mirroring and corrections, applied-deposit protection, protected linked prices, booking-only and invoice-only staff permissions, anon denial, service-role execution, London dates, pre-invoice payment copying, cancellation, recovery retries and overlapping settlement calls.

Authentication identities and `user_has_permission` use explicit role-specific fixture settings. Unrelated business triggers, external foreign keys, production RBAC rows and external services are not cloned. This proves the PostgreSQL settlement behaviour, not a production browser or provider integration run.

## Recovery effect

The separate repair validates the booking link, gross invoice total of 994.80, deducted deposit credit of 250 and exact capture identity/amount before recording 744.80. The provider's capture date is 4 September 2026. A retry creates no second payment; it can correct only this exact capture's payment date if an older application instance already recorded it with the reconciliation date.

Expected invoice paid amount after repair: 994.80, status `paid`. Expected booking outstanding: zero, final payment date 4 September 2026 in London, method `paypal`. No customer communication or additional charge is part of either migration.

## Risk, rollback and ordering

The first migration replaces SECURITY DEFINER functions and triggers, changes grants and CHECK constraints and recreates the existing view. These are high-risk financial changes requiring exact SQL approval. It introduces no table/column removal and no historical payment backfill. The second migration inserts or corrects one verified capture and recalculates its records.

CHECK replacement briefly takes an access-exclusive lock on the small invoice payment table. Trigger/view installation also needs table locks. A five-second lock timeout makes contention fail instead of waiting indefinitely. Run each complete migration transactionally through the approved Supabase migration tool.

Before commit, the exact rollback is `ROLLBACK;`. The local harness executes the whole schema migration and rolls it back, then verifies the new helper is absent. Any failed guard in the repair rolls back that entire repair transaction.

After committed payment records exist, there is deliberately no automatic destructive rollback. Restoring the old CHECKs would reject real PayPal rows; restoring old calculations would hide money again. Preserve every payment and capture identity. If a regression appears, inspect the committed state read-only and prepare a separately approved forward-fix migration. Never delete the verified capture or reverse its financial evidence merely to return to old code.

Apply the schema migration before code that supplies the fifth `p_captured_at` argument. The existing four-argument RPC remains compatible. Apply the separately approved recovery next; it is safe to repeat even if reconciliation has already recorded the capture.

After application, re-read definitions, grants and migration history; run the repository's read-only anon-surface assertion; verify the invoice, booking detail and payment history in the actual application; inspect provider and deployment logs. The production smoke test must not create another real payment or send a message.

Status: local only. Production application and browser confirmation remain with the main agent after explicit owner approval.
