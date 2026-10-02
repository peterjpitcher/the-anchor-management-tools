-- Receipts: the "completed, no receipt" count starts after the lock date.
--
-- The count from 20261001190000 took in every year. On 1 October 2026 it read 7,254, of which
-- 7,135 were from before 2026: closed in bulk when the old statements were imported, and not
-- waiting for anything. The lock date already says which periods are filed, so the count now
-- leaves out transactions on or before it. With no lock date set it counts everything, as before.
--
-- One function replaced. No table, row or grant changes, so the code deployed before this
-- migration keeps working: it calls the function with no arguments and reads one number.

BEGIN;

CREATE OR REPLACE FUNCTION public.count_receipts_completed_without_receipt()
RETURNS integer
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT count(*)::integer
  FROM public.receipt_transactions t
  WHERE t.status = 'completed'
    AND t.completed_reason IS NULL
    AND (public.receipts_locked_before() IS NULL OR t.transaction_date > public.receipts_locked_before())
    AND NOT EXISTS (SELECT 1 FROM public.receipt_files f WHERE f.transaction_id = t.id);
$$;

REVOKE ALL ON FUNCTION public.count_receipts_completed_without_receipt() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_receipts_completed_without_receipt() TO service_role;

COMMIT;
