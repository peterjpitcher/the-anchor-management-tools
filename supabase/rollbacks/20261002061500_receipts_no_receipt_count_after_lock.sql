-- Rollback for 20261002061500_receipts_no_receipt_count_after_lock.sql.
-- Safe at any time: puts the count back to every year. No data is touched.

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
    AND NOT EXISTS (SELECT 1 FROM public.receipt_files f WHERE f.transaction_id = t.id);
$$;

REVOKE ALL ON FUNCTION public.count_receipts_completed_without_receipt() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_receipts_completed_without_receipt() TO service_role;

COMMIT;
