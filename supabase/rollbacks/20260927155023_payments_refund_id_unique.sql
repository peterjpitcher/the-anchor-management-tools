-- Rollback for 20260927155023_payments_refund_id_unique.sql.
-- Safe at any time: dropping the index removes only the duplicate guard, never data.

DROP INDEX IF EXISTS public.payments_paypal_refund_id_unique;
