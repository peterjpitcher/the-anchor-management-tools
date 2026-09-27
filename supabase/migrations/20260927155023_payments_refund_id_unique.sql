-- One PayPal refund, one refund row, 27 September 2026.
--
-- APPLIED to production project tfcasgxopxegwrabvwat on 27 September 2026 as migration version
-- 20260927155023 (name: payments_refund_id_unique), through the Supabase MCP apply_migration path after the owner
-- approved this exact SQL (sha256 e77e8be4 of the drafted file). Validated first on a
-- throwaway local Postgres; smoke-tested live afterwards in a block that always rolled back.
-- The file is named after the version the ledger recorded, not its drafted timestamp
-- (supabase/migrations/README.md).
-- Rollback: supabase/rollbacks/20260927155023_payments_refund_id_unique.sql
--
-- WHY
--
-- Event-ticket refunds are recorded as payments rows (charge_type 'refund') carrying PayPal's
-- refund id in metadata. Two writers record them: the staff refund (src/lib/events/manage-booking.ts)
-- and the PayPal webhook (src/lib/events/paypal-webhook-refund.ts). Each looks for the other's row
-- first, but a look-then-insert can still race: both look, both miss, both insert, and the refund
-- is counted twice. This index makes the second insert fail, and both writers treat that failure
-- as "already recorded" (commit c92dec8a, shipped first).
--
-- LIVE STATE (read 27 September 2026)
--
-- payments has 36 rows (176 kB) and no refund rows yet, so there is nothing to deduplicate and the
-- build is instant. The lock is a SHARE lock on payments for that instant; reads carry on.

CREATE UNIQUE INDEX IF NOT EXISTS payments_paypal_refund_id_unique
  ON public.payments ((metadata->>'paypal_refund_id'))
  WHERE charge_type = 'refund'
    AND metadata->>'paypal_refund_id' IS NOT NULL;
