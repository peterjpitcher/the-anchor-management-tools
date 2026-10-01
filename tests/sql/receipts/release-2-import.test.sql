-- import_receipt_statement and the batch backfill (spec 6.2 items 1, 4 and 5).
\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_user uuid := '00000000-0000-0000-0000-0000000000d1';
  v_result jsonb;
  v_batch_id uuid;
  v_second_batch uuid;
  v_failed boolean;
  v_count integer;
  v_rows jsonb := '[
    {"transaction_date":"2026-09-01","details":"CARD PURCHASE TESCO","transaction_type":"Card Purchase","amount_out":12.50,"balance":100.00,"dedupe_hash":"r2-a"},
    {"transaction_date":"2026-09-02","details":"CLIENT LTD INV-A1","transaction_type":"Credit","amount_in":250.00,"balance":350.00,"dedupe_hash":"r2-b"},
    {"transaction_date":"2026-09-03","details":"Transaction Charges","transaction_type":"Transaction Charges","amount_out":7.20,"balance":342.80,"dedupe_hash":"r2-c"}
  ]'::jsonb;
  v_batch jsonb := jsonb_build_object(
    'source_type', 'bank', 'source_hash', 'file-hash-1', 'original_filename', 'sept.csv',
    'uploaded_by', '00000000-0000-0000-0000-0000000000d1',
    'records_in_file', 4, 'rejected_count', 1, 'repeated_in_file', 0,
    'rejected_records', '[{"record":4,"reason":"bad_amount","message":"The Out amount \"12abc\" could not be read","excerpt":"04/09/2026 | SOMETHING | 12abc"}]'::jsonb
  );
BEGIN
  -- The backfill: the empty legacy batch is superseded, the one holding the transactions stays.
  ASSERT (SELECT status FROM public.receipt_batches WHERE id = '00000000-0000-0000-0000-0000000000e1') = 'superseded', 'an empty legacy batch is marked superseded';
  ASSERT (SELECT status FROM public.receipt_batches WHERE id = '00000000-0000-0000-0000-0000000000e2') = 'completed', 'the batch that holds the transactions stays completed';
  ASSERT (SELECT followup_status FROM public.receipt_batches WHERE id = '00000000-0000-0000-0000-0000000000e2') = 'done', 'a batch from before this release has no follow-up outstanding';

  -- A new file: batch, lines, history and the follow-up job, together.
  v_result := public.import_receipt_statement(v_batch, v_rows);
  ASSERT v_result->>'outcome' = 'imported', format('first import: %s', v_result->>'outcome');
  ASSERT (v_result->>'inserted_count')::int = 3 AND (v_result->>'duplicate_count')::int = 0, 'three lines went in';
  v_batch_id := (v_result->'batch'->>'id')::uuid;
  ASSERT (SELECT count(*) FROM public.receipt_transactions WHERE batch_id = v_batch_id) = 3, 'the lines belong to the batch';
  ASSERT (SELECT count(*) FROM public.receipt_transaction_logs l JOIN public.receipt_transactions t ON t.id = l.transaction_id WHERE t.batch_id = v_batch_id AND l.action_type = 'import' AND l.performed_by = v_user) = 3, 'one history row per line, naming who imported it';
  ASSERT (SELECT status = 'completed' AND records_in_file = 4 AND inserted_count = 3 AND duplicate_count = 0 AND rejected_count = 1 AND jsonb_array_length(rejected_records) = 1 AND followup_status = 'queued' AND uploaded_by = v_user FROM public.receipt_batches WHERE id = v_batch_id), 'the batch accounts for every record';
  ASSERT (SELECT count(*) FROM public.jobs WHERE type = 'process_receipt_batch' AND status = 'pending' AND payload->>'batch_id' = v_batch_id::text AND payload->>'unique_key' = 'receipts:process_receipt_batch:' || v_batch_id::text AND priority = -10) = 1, 'the follow-up job is committed with the import';
  ASSERT (SELECT status = 'pending' AND receipt_required AND source_type = 'bank' FROM public.receipt_transactions WHERE dedupe_hash = 'r2-a'), 'a bank line defaults to pending';

  -- The same file again: nothing new, no second batch, no second job.
  v_result := public.import_receipt_statement(v_batch, v_rows);
  ASSERT v_result->>'outcome' = 'already_imported' AND (v_result->>'inserted_count')::int = 0 AND (v_result->>'duplicate_count')::int = 3, format('repeat import: %s', v_result);
  ASSERT (v_result->'batch'->>'id')::uuid = v_batch_id, 'the repeat is answered with the original batch';
  ASSERT (SELECT count(*) FROM public.receipt_batches WHERE source_hash = 'file-hash-1') = 1, 'no second batch for the same file';
  ASSERT (SELECT count(*) FROM public.jobs WHERE payload->>'batch_id' = v_batch_id::text) = 1, 'no second follow-up job while one is waiting';
  ASSERT (SELECT inserted_count FROM public.receipt_batches WHERE id = v_batch_id) = 3, 'the repeat does not change the inserted count';

  -- The same file read by a better parser: a line that was skipped before is added to the
  -- original batch, and the follow-up is queued again.
  UPDATE public.receipt_batches SET followup_status = 'done' WHERE id = v_batch_id;
  UPDATE public.jobs SET status = 'completed' WHERE payload->>'batch_id' = v_batch_id::text;
  v_result := public.import_receipt_statement(
    v_batch || jsonb_build_object('records_in_file', 4, 'rejected_count', 0, 'rejected_records', '[]'::jsonb),
    v_rows || '[{"transaction_date":"2026-09-04","details":"Account Maintenance Fee","transaction_type":"Account Maintenance Fee","amount_out":8.50,"balance":334.30,"dedupe_hash":"r2-d"}]'::jsonb
  );
  ASSERT v_result->>'outcome' = 'already_imported' AND (v_result->>'inserted_count')::int = 1, format('recovering a missed line: %s', v_result);
  ASSERT (SELECT batch_id FROM public.receipt_transactions WHERE dedupe_hash = 'r2-d') = v_batch_id, 'the recovered line joins the original batch';
  ASSERT (SELECT inserted_count = 4 AND rejected_count = 0 AND followup_status = 'queued' FROM public.receipt_batches WHERE id = v_batch_id), 'the batch counts and follow-up are brought up to date';
  ASSERT (SELECT count(*) FROM public.jobs WHERE payload->>'batch_id' = v_batch_id::text AND status = 'pending') = 1, 'a new follow-up job is queued for the recovered line';

  -- A different file that overlaps: only the new line goes in.
  v_result := public.import_receipt_statement(
    jsonb_build_object('source_type', 'bank', 'source_hash', 'file-hash-2', 'original_filename', 'sept-overlap.csv', 'uploaded_by', v_user::text, 'records_in_file', 2),
    '[
      {"transaction_date":"2026-09-03","details":"Transaction Charges","transaction_type":"Transaction Charges","amount_out":7.20,"balance":342.80,"dedupe_hash":"r2-c"},
      {"transaction_date":"2026-09-05","details":"NEW LINE","amount_out":1.00,"dedupe_hash":"r2-e"}
    ]'::jsonb
  );
  v_second_batch := (v_result->'batch'->>'id')::uuid;
  ASSERT v_result->>'outcome' = 'imported' AND (v_result->>'inserted_count')::int = 1 AND (v_result->>'duplicate_count')::int = 1, format('overlap: %s', v_result);
  ASSERT (SELECT batch_id FROM public.receipt_transactions WHERE dedupe_hash = 'r2-c') = v_batch_id, 'a line already held keeps its batch';
  ASSERT (SELECT inserted_count = 1 AND duplicate_count = 1 FROM public.receipt_batches WHERE id = v_second_batch), 'the overlapping batch says one in, one already held';

  -- A file whose lines are all held already: a completed batch, nothing to follow up.
  v_result := public.import_receipt_statement(
    jsonb_build_object('source_type', 'bank', 'source_hash', 'file-hash-3', 'original_filename', 'all-held.csv', 'uploaded_by', v_user::text),
    '[{"transaction_date":"2026-09-05","details":"NEW LINE","amount_out":1.00,"dedupe_hash":"r2-e"}]'::jsonb
  );
  ASSERT (v_result->>'inserted_count')::int = 0 AND v_result->'batch'->>'followup_status' = 'done', 'nothing new means no follow-up';
  ASSERT NOT EXISTS (SELECT 1 FROM public.jobs WHERE payload->>'batch_id' = v_result->'batch'->>'id'), 'and no job';

  -- Two identical lines in one file arrive with distinct identities and both go in.
  v_result := public.import_receipt_statement(
    jsonb_build_object('source_type', 'amex', 'source_hash', 'amex-hash-1', 'original_filename', 'amex.csv', 'uploaded_by', v_user::text, 'repeated_in_file', 1),
    '[
      {"source_type":"amex","transaction_date":"2026-09-06","details":"COFFEE SHOP","amount_out":3.50,"dedupe_hash":"amex-x","card_member":"A Person","card_account":"12345","merchant_category":"Restaurants","merchant_town":"STAINES"},
      {"source_type":"amex","transaction_date":"2026-09-06","details":"COFFEE SHOP","amount_out":3.50,"dedupe_hash":"amex-x#2","card_member":"A Person","card_account":"12345"},
      {"source_type":"amex","transaction_date":"2026-09-07","details":"MEMBERSHIP FEE","amount_out":25.00,"dedupe_hash":"amex-fee","status":"no_receipt_required","receipt_required":false,"vendor_name":"American Express","vendor_source":"import","expense_category":"Bank Charges/Credit Card Commission","expense_category_source":"import"}
    ]'::jsonb
  );
  ASSERT (v_result->>'inserted_count')::int = 3, 'both identical lines and the fee go in';
  ASSERT (SELECT count(*) FROM public.receipt_transactions WHERE details = 'COFFEE SHOP' AND source_type = 'amex' AND card_member = 'A Person') = 2, 'two identical purchases are two payments';
  ASSERT (SELECT status = 'no_receipt_required' AND NOT receipt_required AND vendor_source = 'import' AND expense_category_source = 'import' FROM public.receipt_transactions WHERE dedupe_hash = 'amex-fee'), 'what the import decided is stored with the import source';
  ASSERT (SELECT repeated_in_file FROM public.receipt_batches WHERE source_hash = 'amex-hash-1') = 1, 'the batch records the repeat';

  -- The same bytes as a bank file and as an Amex file are different imports.
  v_result := public.import_receipt_statement(
    jsonb_build_object('source_type', 'bank', 'source_hash', 'amex-hash-1', 'original_filename', 'same-bytes.csv', 'uploaded_by', v_user::text),
    '[{"transaction_date":"2026-09-08","details":"BANK SIDE","amount_out":2.00,"dedupe_hash":"r2-f"}]'::jsonb
  );
  ASSERT v_result->>'outcome' = 'imported', 'the file guard is per source';

  -- A line the database refuses takes the whole import with it: no batch, no lines, no job.
  SELECT count(*) INTO v_count FROM public.receipt_batches;
  v_failed := false;
  BEGIN
    v_result := public.import_receipt_statement(
      jsonb_build_object('source_type', 'bank', 'source_hash', 'file-hash-bad', 'original_filename', 'bad.csv', 'uploaded_by', v_user::text),
      '[
        {"transaction_date":"2026-09-09","details":"GOOD LINE","amount_out":5.00,"dedupe_hash":"r2-g"},
        {"transaction_date":"2026-09-09","details":"NEGATIVE","amount_out":-5.00,"dedupe_hash":"r2-h"}
      ]'::jsonb
    );
  EXCEPTION WHEN check_violation THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'a refused line fails the import';
  ASSERT (SELECT count(*) FROM public.receipt_batches) = v_count, 'a failed import leaves no batch';
  ASSERT NOT EXISTS (SELECT 1 FROM public.receipt_transactions WHERE dedupe_hash IN ('r2-g', 'r2-h')), 'and no lines';
  ASSERT NOT EXISTS (SELECT 1 FROM public.receipt_batches WHERE source_hash = 'file-hash-bad'), 'so the file can be uploaded again once it is right';

  -- Bad arguments are refused.
  v_failed := false;
  BEGIN
    PERFORM public.import_receipt_statement(jsonb_build_object('source_type', 'cash', 'source_hash', 'x', 'original_filename', 'x.csv'), '[]'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'an unknown source is refused';

  -- The unique index is what finally stops a second completed batch for one file.
  v_failed := false;
  BEGIN
    INSERT INTO public.receipt_batches (original_filename, source_hash, source_type) VALUES ('sept.csv', 'file-hash-1', 'bank');
  EXCEPTION WHEN unique_violation THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'a second completed batch for the same file is refused by the index';

  -- Service role only.
  ASSERT NOT has_function_privilege('anon', 'public.import_receipt_statement(jsonb, jsonb)', 'EXECUTE'), 'not callable by anon';
  ASSERT NOT has_function_privilege('authenticated', 'public.import_receipt_statement(jsonb, jsonb)', 'EXECUTE'), 'not callable by authenticated';
  ASSERT has_function_privilege('service_role', 'public.import_receipt_statement(jsonb, jsonb)', 'EXECUTE'), 'callable by the service role';
END $$;

ROLLBACK;

\echo 'RECEIPTS IMPORT TESTS PASSED'
