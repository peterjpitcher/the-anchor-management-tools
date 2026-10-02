-- The "completed, no receipt" count starts after the lock date
-- (20261002061500_receipts_no_receipt_count_after_lock.sql).
\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_user uuid := '00000000-0000-0000-0000-000000000071';
  v_batch uuid;
  v_old uuid;
  v_on_lock uuid;
  v_new uuid;
  v_before integer;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.receipt_batches (original_filename, source_hash) VALUES ('lock-count.csv', 'lock-count') RETURNING id INTO v_batch;

  ASSERT public.receipts_locked_before() IS NULL, 'no lock date to begin with';
  v_before := public.count_receipts_completed_without_receipt();

  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_out, dedupe_hash, status, receipt_required)
  VALUES (v_batch, DATE '2025-06-15', 'OLD AND COMPLETED WITH NOTHING', 10, 'lock-count-old', 'completed', false) RETURNING id INTO v_old;
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_out, dedupe_hash, status, receipt_required)
  VALUES (v_batch, DATE '2025-12-31', 'ON THE LOCK DATE AND COMPLETED WITH NOTHING', 10, 'lock-count-on', 'completed', false) RETURNING id INTO v_on_lock;
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_out, dedupe_hash, status, receipt_required)
  VALUES (v_batch, DATE '2026-01-01', 'NEW AND COMPLETED WITH NOTHING', 10, 'lock-count-new', 'completed', false) RETURNING id INTO v_new;

  -- With no lock date every year is counted, as before.
  ASSERT public.count_receipts_completed_without_receipt() = v_before + 3, 'with no lock date all three are counted';

  -- With a lock date, a transaction on or before it is left out.
  PERFORM public.set_receipts_locked_before(DATE '2025-12-31', v_user);
  ASSERT public.count_receipts_completed_without_receipt() = (
    SELECT count(*) FROM public.receipt_transactions t
    WHERE t.status = 'completed' AND t.completed_reason IS NULL
      AND t.transaction_date > DATE '2025-12-31'
      AND NOT EXISTS (SELECT 1 FROM public.receipt_files f WHERE f.transaction_id = t.id)
  ), 'with a lock date the count agrees with the definition';

  DECLARE
    v_locked integer := public.count_receipts_completed_without_receipt();
  BEGIN
    UPDATE public.receipt_transactions SET completed_reason = 'Petty cash' WHERE id = v_new;
    ASSERT public.count_receipts_completed_without_receipt() = v_locked - 1, 'the one after the lock date was being counted';
    UPDATE public.receipt_transactions SET completed_reason = 'Petty cash' WHERE id IN (v_old, v_on_lock);
    ASSERT public.count_receipts_completed_without_receipt() = v_locked - 1, 'the two on or before it were not';
  END;

  -- Moving the lock back brings the earlier ones into view again.
  UPDATE public.receipt_transactions SET completed_reason = NULL WHERE id IN (v_old, v_on_lock, v_new);
  PERFORM public.set_receipts_locked_before(DATE '2025-06-30', v_user);
  ASSERT public.count_receipts_completed_without_receipt() = (
    SELECT count(*) FROM public.receipt_transactions t
    WHERE t.status = 'completed' AND t.completed_reason IS NULL
      AND t.transaction_date > DATE '2025-06-30'
      AND NOT EXISTS (SELECT 1 FROM public.receipt_files f WHERE f.transaction_id = t.id)
  ), 'an earlier lock date counts more';

  ASSERT NOT has_function_privilege('anon', 'public.count_receipts_completed_without_receipt()', 'EXECUTE'), 'anon cannot run the count';
  ASSERT NOT has_function_privilege('authenticated', 'public.count_receipts_completed_without_receipt()', 'EXECUTE'), 'nor can a signed-in user';
  ASSERT has_function_privilege('service_role', 'public.count_receipts_completed_without_receipt()', 'EXECUTE'), 'the service role can';
END $$;

ROLLBACK;

\echo 'RECEIPTS NO RECEIPT COUNT TESTS PASSED'
