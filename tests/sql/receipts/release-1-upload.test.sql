-- complete_receipt_upload and release_receipt_upload_intent (spec 5.3).
\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_user uuid := '00000000-0000-0000-0000-000000000001';
  v_other uuid := '00000000-0000-0000-0000-000000000002';
  v_batch uuid;
  v_tx uuid;
  v_result jsonb;
  v_file_id uuid;
  v_text text;
  v_row public.receipt_transactions%ROWTYPE;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user), (v_other);
  INSERT INTO public.receipt_batches (original_filename, source_hash) VALUES ('t.csv', 'h1') RETURNING id INTO v_batch;
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_out, dedupe_hash)
  VALUES (v_batch, DATE '2026-09-01', 'CARD PURCHASE HARNESS', 20.00, 'd1') RETURNING id INTO v_tx;
  INSERT INTO public.receipt_upload_intents (transaction_id, storage_path, issued_to)
  VALUES (v_tx, '2026/a_1770000000001', v_user);

  -- A path that was never issued, and a path issued to somebody else, attach nothing.
  v_result := public.complete_receipt_upload(v_tx, '2026/forged_1770000000009', v_user, 'u@example.com', 'User', 'f.pdf', 'application/pdf', 100, 'hash-a');
  ASSERT v_result->>'outcome' = 'not_issued', format('forged path: expected not_issued, got %s', v_result);
  v_result := public.complete_receipt_upload(v_tx, '2026/a_1770000000001', v_other, 'o@example.com', 'Other', 'f.pdf', 'application/pdf', 100, 'hash-a');
  ASSERT v_result->>'outcome' = 'not_issued', format('other user: expected not_issued, got %s', v_result);
  ASSERT NOT EXISTS (SELECT 1 FROM public.receipt_files WHERE transaction_id = v_tx), 'a refused completion writes no file row';
  ASSERT (SELECT status FROM public.receipt_transactions WHERE id = v_tx) = 'pending', 'a refused completion leaves the payment pending';

  -- The owner completes it: file, payment, log and intent all move together.
  v_result := public.complete_receipt_upload(v_tx, '2026/a_1770000000001', v_user, 'u@example.com', 'User', 'f.pdf', 'application/pdf', 100, 'hash-a');
  ASSERT v_result->>'outcome' = 'completed', format('owner: expected completed, got %s', v_result);
  ASSERT v_result->>'previous_status' = 'pending', 'the previous status is reported';
  v_file_id := (v_result->'receipt'->>'id')::uuid;
  ASSERT (SELECT count(*) FROM public.receipt_files WHERE transaction_id = v_tx) = 1, 'one file row';
  SELECT * INTO v_row FROM public.receipt_transactions WHERE id = v_tx;
  ASSERT v_row.status = 'completed' AND v_row.receipt_required = false, 'the payment is completed';
  ASSERT v_row.marked_by = v_user AND v_row.marked_method = 'receipt_upload' AND v_row.marked_by_email = 'u@example.com', 'the payment records who attached the file';
  ASSERT (SELECT count(*) FROM public.receipt_transaction_logs WHERE transaction_id = v_tx AND action_type = 'receipt_upload' AND performed_by = v_user AND previous_status = 'pending' AND new_status = 'completed') = 1, 'one log row naming the user';
  ASSERT (SELECT receipt_file_id FROM public.receipt_upload_intents WHERE transaction_id = v_tx) = v_file_id, 'the intent points at the file';
  ASSERT (SELECT hash_verified_at IS NOT NULL FROM public.receipt_files WHERE id = v_file_id), 'a supplied hash is stamped';

  -- A replay returns the stored file and writes nothing more.
  v_result := public.complete_receipt_upload(v_tx, '2026/a_1770000000001', v_user, 'u@example.com', 'User', 'f.pdf', 'application/pdf', 100, 'hash-a');
  ASSERT v_result->>'outcome' = 'replayed', format('replay: expected replayed, got %s', v_result);
  ASSERT (v_result->'receipt'->>'id')::uuid = v_file_id, 'the replay returns the same file';
  ASSERT (SELECT count(*) FROM public.receipt_files WHERE transaction_id = v_tx) = 1, 'the replay adds no file row';
  ASSERT (SELECT count(*) FROM public.receipt_transaction_logs WHERE transaction_id = v_tx) = 1, 'the replay adds no log row';

  -- A completed upload can never be released, so its object is never removed.
  v_text := public.release_receipt_upload_intent(v_tx, '2026/a_1770000000001', v_user);
  ASSERT v_text = 'completed', format('release of a completed intent: expected completed, got %s', v_text);
  ASSERT EXISTS (SELECT 1 FROM public.receipt_upload_intents WHERE transaction_id = v_tx AND storage_path = '2026/a_1770000000001'), 'the completed intent is kept';

  -- An open intent held by the caller is released once, and a later completion finds nothing.
  INSERT INTO public.receipt_upload_intents (transaction_id, storage_path, issued_to)
  VALUES (v_tx, '2026/b_1770000000002', v_user);
  v_text := public.release_receipt_upload_intent(v_tx, '2026/b_1770000000002', v_other);
  ASSERT v_text = 'not_issued', 'another user cannot release the intent';
  v_text := public.release_receipt_upload_intent(v_tx, '2026/b_1770000000002', v_user);
  ASSERT v_text = 'released', format('release of an open intent: expected released, got %s', v_text);
  v_text := public.release_receipt_upload_intent(v_tx, '2026/b_1770000000002', v_user);
  ASSERT v_text = 'not_issued', 'a second release finds nothing';
  v_result := public.complete_receipt_upload(v_tx, '2026/b_1770000000002', v_user, 'u@example.com', 'User', 'g.pdf', 'application/pdf', 100, NULL);
  ASSERT v_result->>'outcome' = 'not_issued', 'a completion after release attaches nothing';

  -- An open intent whose path a file row already references is not released.
  INSERT INTO public.receipt_upload_intents (transaction_id, storage_path, issued_to)
  VALUES (v_tx, '2026/c_1770000000003', v_user);
  INSERT INTO public.receipt_files (transaction_id, storage_path, file_name) VALUES (v_tx, '2026/c_1770000000003', 'c.pdf');
  v_text := public.release_receipt_upload_intent(v_tx, '2026/c_1770000000003', v_user);
  ASSERT v_text = 'referenced', format('release of a referenced path: expected referenced, got %s', v_text);

  -- The file was removed after completion: nothing is attached again.
  DELETE FROM public.receipt_files WHERE id = v_file_id;
  v_result := public.complete_receipt_upload(v_tx, '2026/a_1770000000001', v_user, 'u@example.com', 'User', 'f.pdf', 'application/pdf', 100, 'hash-a');
  ASSERT v_result->>'outcome' = 'already_completed', format('completed then deleted: expected already_completed, got %s', v_result);

  -- No hash: the file is stored without a verification stamp.
  INSERT INTO public.receipt_upload_intents (transaction_id, storage_path, issued_to)
  VALUES (v_tx, '2026/d_1770000000004', v_user);
  v_result := public.complete_receipt_upload(v_tx, '2026/d_1770000000004', v_user, 'u@example.com', 'User', 'd.pdf', '', 100, NULL);
  ASSERT v_result->>'outcome' = 'completed', 'a completion without a hash still completes';
  ASSERT (SELECT hash_verified_at IS NULL AND mime_type IS NULL FROM public.receipt_files WHERE storage_path = '2026/d_1770000000004'), 'no hash means no stamp, and a blank type is stored as null';
END $$;

ROLLBACK;

\echo 'RECEIPTS UPLOAD TESTS PASSED'
