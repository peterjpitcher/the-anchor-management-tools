-- Release 6: the duplicate-file check, deleting a file, completing with a reason, the invoice
-- ledger function, attached invoices, and the narrower grants (spec section 10).
\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- 10.1 A file already on another payment is reported before anything is written
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user uuid := '00000000-0000-0000-0000-000000000061';
  v_batch uuid;
  v_a uuid;
  v_b uuid;
  v_c uuid;
  v_d uuid;
  v_result jsonb;
  v_failed boolean;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.receipt_batches (original_filename, source_hash) VALUES ('r6.csv', 'r6-files') RETURNING id INTO v_batch;
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_out, dedupe_hash)
  VALUES (v_batch, DATE '2026-09-01', 'FIRST PAYMENT', 20.00, 'r6-a') RETURNING id INTO v_a;
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_out, dedupe_hash)
  VALUES (v_batch, DATE '2026-09-02', 'SECOND PAYMENT', 20.00, 'r6-b') RETURNING id INTO v_b;
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_out, dedupe_hash)
  VALUES (v_batch, DATE '2026-09-03', 'THIRD PAYMENT', 20.00, 'r6-c') RETURNING id INTO v_c;
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_out, dedupe_hash)
  VALUES (v_batch, DATE '2026-09-04', 'FOURTH PAYMENT', 20.00, 'r6-d') RETURNING id INTO v_d;
  INSERT INTO public.receipt_upload_intents (transaction_id, storage_path, issued_to) VALUES
    (v_a, '2026/r6_a', v_user), (v_b, '2026/r6_b', v_user), (v_b, '2026/r6_b_unreadable', v_user),
    (v_c, '2026/r6_c', v_user), (v_d, '2026/r6_d', v_user);

  -- The first payment to carry the file: nothing to report.
  v_result := public.complete_receipt_upload(v_a, '2026/r6_a', v_user, 'u@example.com', 'User', 'bill.pdf', 'application/pdf', 100, 'hash-same', 'check');
  ASSERT v_result->>'outcome' = 'completed' AND (v_result->>'shared_with')::int = 0, format('first file: %s', v_result);
  ASSERT (SELECT source FROM public.receipt_files WHERE transaction_id = v_a) = 'upload', 'an uploaded file is marked as an upload';

  -- The same bytes on a second payment: reported, and nothing is written.
  v_result := public.complete_receipt_upload(v_b, '2026/r6_b', v_user, 'u@example.com', 'User', 'bill.pdf', 'application/pdf', 100, 'hash-same', 'check');
  ASSERT v_result->>'outcome' = 'duplicate', format('same file, second payment: expected duplicate, got %s', v_result);
  ASSERT (v_result->>'count')::int = 1, 'one other payment carries it';
  ASSERT (v_result->'payments'->0->>'transaction_id')::uuid = v_a, 'the warning names the payment that has it';
  ASSERT v_result->'payments'->0->>'details' = 'FIRST PAYMENT' AND v_result->'payments'->0->>'file_name' = 'bill.pdf', 'the warning says which payment and which file';
  ASSERT NOT EXISTS (SELECT 1 FROM public.receipt_files WHERE transaction_id = v_b), 'a warning writes no file row';
  ASSERT (SELECT status FROM public.receipt_transactions WHERE id = v_b) = 'pending', 'a warning leaves the payment pending';
  ASSERT (SELECT completed_at IS NULL FROM public.receipt_upload_intents WHERE storage_path = '2026/r6_b'), 'a warning leaves the upload open, to be confirmed or cancelled';
  ASSERT NOT EXISTS (SELECT 1 FROM public.receipt_transaction_logs WHERE transaction_id = v_b), 'a warning writes no history';

  -- The upload is still open, so it can be cancelled: the object is the caller's to remove.
  -- (Released on a copy of the intent, so the confirmation below still has the original.)
  INSERT INTO public.receipt_upload_intents (transaction_id, storage_path, issued_to) VALUES (v_b, '2026/r6_b_cancel', v_user);
  ASSERT public.release_receipt_upload_intent(v_b, '2026/r6_b_cancel', v_user) = 'released', 'an upload that was warned about can be cancelled';

  -- Confirmed: attached, and the history says the person was told.
  v_result := public.complete_receipt_upload(v_b, '2026/r6_b', v_user, 'u@example.com', 'User', 'bill.pdf', 'application/pdf', 100, 'hash-same', 'confirmed');
  ASSERT v_result->>'outcome' = 'completed' AND (v_result->>'shared_with')::int = 1, format('confirmed: %s', v_result);
  ASSERT (SELECT status FROM public.receipt_transactions WHERE id = v_b) = 'completed', 'the confirmed payment is completed';
  ASSERT (SELECT note FROM public.receipt_transaction_logs WHERE transaction_id = v_b AND action_type = 'receipt_upload')
    = 'Receipt uploaded (bill.pdf). The same file is on 1 other transaction: confirmed', 'the history records that the duplicate was confirmed';

  -- A third payment is told about both.
  v_result := public.complete_receipt_upload(v_c, '2026/r6_c', v_user, 'u@example.com', 'User', 'bill.pdf', 'application/pdf', 100, 'hash-same', 'check');
  ASSERT v_result->>'outcome' = 'duplicate' AND (v_result->>'count')::int = 2 AND jsonb_array_length(v_result->'payments') = 2, format('third payment: %s', v_result);
  ASSERT (v_result->'payments'->0->>'transaction_id')::uuid = v_b, 'the newest payment is listed first';

  -- A file that could not be read cannot be checked, so it is refused.
  v_result := public.complete_receipt_upload(v_b, '2026/r6_b_unreadable', v_user, 'u@example.com', 'User', 'x.pdf', 'application/pdf', 100, NULL, 'check');
  ASSERT v_result->>'outcome' = 'unreadable', format('no hash with a check asked for: %s', v_result);
  v_result := public.complete_receipt_upload(v_b, '2026/r6_b_unreadable', v_user, 'u@example.com', 'User', 'x.pdf', 'application/pdf', 100, '   ', 'confirmed');
  ASSERT v_result->>'outcome' = 'unreadable', 'a blank hash is no hash';
  ASSERT (SELECT count(*) FROM public.receipt_files WHERE transaction_id = v_b) = 1, 'a refused upload writes no file row';

  -- The code deployed before this migration sends no mode: it behaves as it did.
  v_result := public.complete_receipt_upload(v_c, '2026/r6_c', v_user, 'u@example.com', 'User', 'bill.pdf', 'application/pdf', 100, 'hash-same');
  ASSERT v_result->>'outcome' = 'completed', format('no mode given: %s', v_result);

  -- A copy of one of our invoices is not a duplicate: one invoice settles several payments.
  INSERT INTO public.receipt_files (transaction_id, storage_path, file_name, content_hash, source)
  VALUES (v_a, '2026/r6_invoice_copy', 'Invoice INV-1.pdf', 'hash-invoice', 'invoice');
  v_result := public.complete_receipt_upload(v_d, '2026/r6_d', v_user, 'u@example.com', 'User', 'other.pdf', 'application/pdf', 100, 'hash-invoice', 'check');
  ASSERT v_result->>'outcome' = 'completed' AND (v_result->>'shared_with')::int = 0, format('same bytes as an invoice copy: %s', v_result);

  -- An unknown mode is a programming error and says so.
  v_failed := false;
  BEGIN
    PERFORM public.complete_receipt_upload(v_d, '2026/r6_d', v_user, 'u@example.com', 'User', 'other.pdf', 'application/pdf', 100, 'h', 'maybe');
  EXCEPTION WHEN raise_exception THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'an unknown duplicate mode is refused';
END $$;

-- ---------------------------------------------------------------------------
-- 10.1 and 10.2 Deleting a file
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user uuid := '00000000-0000-0000-0000-000000000062';
  v_batch uuid;
  v_one uuid;
  v_two uuid;
  v_reason uuid;
  v_invoiced uuid;
  v_by_hand uuid;
  v_inv_vendor uuid;
  v_invoice uuid;
  v_file uuid;
  v_file_two uuid;
  v_result jsonb;
  v_row public.receipt_transactions%ROWTYPE;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.receipt_batches (original_filename, source_hash) VALUES ('r6d.csv', 'r6-delete') RETURNING id INTO v_batch;
  INSERT INTO public.invoice_vendors (name) VALUES ('Delete Client') RETURNING id INTO v_inv_vendor;
  INSERT INTO public.invoices (invoice_number, vendor_id, total_amount) VALUES ('INV-DEL', v_inv_vendor, 50) RETURNING id INTO v_invoice;

  -- One file: the payment goes back to pending.
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_out, dedupe_hash, status, receipt_required, marked_by, marked_by_email, marked_method, marked_at)
  VALUES (v_batch, DATE '2026-09-01', 'ONE FILE', 10, 'r6d-1', 'completed', false, v_user, 'u@example.com', 'receipt_upload', now()) RETURNING id INTO v_one;
  INSERT INTO public.receipt_files (transaction_id, storage_path, file_name) VALUES (v_one, '2026/del_one', 'one.pdf') RETURNING id INTO v_file;

  v_result := public.delete_receipt_file(v_file, v_user);
  ASSERT v_result->>'outcome' = 'deleted' AND v_result->>'storage_path' = '2026/del_one', format('delete: %s', v_result);
  ASSERT (v_result->>'remove_object')::boolean AND (v_result->>'remaining_files')::int = 0, 'the object is the caller''s to remove';
  ASSERT v_result->>'previous_status' = 'completed' AND v_result->>'new_status' = 'pending', 'the change of status is reported';
  SELECT * INTO v_row FROM public.receipt_transactions WHERE id = v_one;
  ASSERT v_row.status = 'pending' AND v_row.receipt_required AND v_row.marked_by IS NULL AND v_row.marked_method IS NULL AND v_row.marked_at IS NULL,
    'a completed payment that loses its only file is pending again, with nobody marked';
  ASSERT NOT EXISTS (SELECT 1 FROM public.receipt_files WHERE id = v_file), 'the file row is gone';
  ASSERT (SELECT count(*) FROM public.receipt_transaction_logs WHERE transaction_id = v_one AND action_type = 'receipt_deleted'
    AND previous_status = 'completed' AND new_status = 'pending' AND performed_by = v_user AND note = 'Receipt removed (one.pdf)') = 1,
    'one history row names the file and the person';

  -- Called again: nothing to delete.
  v_result := public.delete_receipt_file(v_file, v_user);
  ASSERT v_result->>'outcome' = 'not_found', 'a second delete finds nothing';
  ASSERT (SELECT count(*) FROM public.receipt_transaction_logs WHERE transaction_id = v_one) = 1, 'and writes no history';

  -- Two files: the payment stays completed.
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_out, dedupe_hash, status, receipt_required, marked_by, marked_method)
  VALUES (v_batch, DATE '2026-09-02', 'TWO FILES', 10, 'r6d-2', 'completed', false, v_user, 'receipt_upload') RETURNING id INTO v_two;
  INSERT INTO public.receipt_files (transaction_id, storage_path, file_name) VALUES (v_two, '2026/del_two_a', 'a.pdf') RETURNING id INTO v_file;
  INSERT INTO public.receipt_files (transaction_id, storage_path, file_name) VALUES (v_two, '2026/del_two_b', 'b.pdf') RETURNING id INTO v_file_two;
  v_result := public.delete_receipt_file(v_file, v_user);
  ASSERT (v_result->>'remaining_files')::int = 1 AND v_result->>'new_status' = 'completed', format('one of two: %s', v_result);
  ASSERT (SELECT status FROM public.receipt_transactions WHERE id = v_two) = 'completed', 'a payment with a file left stays completed';
  ASSERT (SELECT marked_by FROM public.receipt_transactions WHERE id = v_two) = v_user, 'and keeps who marked it';

  -- A written reason: the payment is complete without a file, so it stays complete.
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_out, dedupe_hash, status, receipt_required, completed_reason)
  VALUES (v_batch, DATE '2026-09-03', 'HAS A REASON', 10, 'r6d-3', 'completed', false, 'Cash tip, no receipt given') RETURNING id INTO v_reason;
  INSERT INTO public.receipt_files (transaction_id, storage_path, file_name) VALUES (v_reason, '2026/del_reason', 'r.pdf') RETURNING id INTO v_file;
  v_result := public.delete_receipt_file(v_file, v_user);
  ASSERT v_result->>'new_status' = 'completed' AND (SELECT status FROM public.receipt_transactions WHERE id = v_reason) = 'completed',
    'a payment with a written reason stays completed when its file goes';

  -- Settled by one of our invoices: it returns to "no receipt required" with the invoice as its reason.
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_in, dedupe_hash, status, receipt_required, marked_method)
  VALUES (v_batch, DATE '2026-09-04', 'CLIENT INV-DEL', 50, 'r6d-4', 'completed', false, 'invoice_attached') RETURNING id INTO v_invoiced;
  INSERT INTO public.receipt_invoice_matches (receipt_transaction_id, invoice_id, invoice_number, match_status, transaction_date)
  VALUES (v_invoiced, v_invoice, 'INV-DEL', 'already_paid', DATE '2026-09-04');
  INSERT INTO public.receipt_files (transaction_id, storage_path, file_name, source, invoice_id)
  VALUES (v_invoiced, '2026/del_invoice', 'Invoice INV-DEL.pdf', 'invoice', v_invoice) RETURNING id INTO v_file;
  v_result := public.delete_receipt_file(v_file, v_user);
  SELECT * INTO v_row FROM public.receipt_transactions WHERE id = v_invoiced;
  ASSERT v_result->>'new_status' = 'no_receipt_required' AND v_row.status = 'no_receipt_required' AND NOT v_row.receipt_required,
    format('an invoiced payment returns to no receipt required: %s', v_result);
  ASSERT v_row.marked_method = 'invoice_reconciliation' AND v_row.auto_completed_reason = 'invoice_payment:INV-DEL', 'with the invoice as its reason';

  -- A match that names no real invoice is not a reason.
  UPDATE public.receipt_transactions SET status = 'completed' WHERE id = v_invoiced;
  UPDATE public.receipt_invoice_matches SET match_status = 'missing_invoice', invoice_id = NULL WHERE receipt_transaction_id = v_invoiced;
  INSERT INTO public.receipt_files (transaction_id, storage_path, file_name) VALUES (v_invoiced, '2026/del_invoice_2', 'x.pdf') RETURNING id INTO v_file;
  v_result := public.delete_receipt_file(v_file, v_user);
  ASSERT v_result->>'new_status' = 'pending', 'a payment whose invoice was never found goes back to pending';

  -- A status a person set by hand is not touched by losing a file.
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_out, dedupe_hash, status, receipt_required, marked_by, marked_method)
  VALUES (v_batch, DATE '2026-09-05', 'SET BY HAND', 10, 'r6d-5', 'no_receipt_required', false, v_user, 'manual') RETURNING id INTO v_by_hand;
  INSERT INTO public.receipt_files (transaction_id, storage_path, file_name) VALUES (v_by_hand, '2026/del_hand', 'h.pdf') RETURNING id INTO v_file;
  v_result := public.delete_receipt_file(v_file, v_user);
  SELECT * INTO v_row FROM public.receipt_transactions WHERE id = v_by_hand;
  ASSERT v_row.status = 'no_receipt_required' AND v_row.marked_by = v_user AND v_row.marked_method = 'manual', 'only a completed payment is reopened';

  -- An object another row still points at is not the caller's to remove.
  INSERT INTO public.receipt_files (transaction_id, storage_path, file_name) VALUES (v_two, '2026/shared_object', 's.pdf') RETURNING id INTO v_file;
  INSERT INTO public.receipt_files (transaction_id, storage_path, file_name) VALUES (v_by_hand, '2026/shared_object', 's.pdf');
  v_result := public.delete_receipt_file(v_file, v_user);
  ASSERT NOT (v_result->>'remove_object')::boolean, 'an object referenced by another file row is kept';
END $$;

-- ---------------------------------------------------------------------------
-- 10.2 Completed means a file, or a written reason
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user uuid := '00000000-0000-0000-0000-000000000063';
  v_batch uuid;
  v_tx uuid;
  v_with_file uuid;
  v_rule uuid;
  v_result jsonb;
  v_row public.receipt_transactions%ROWTYPE;
  v_failed boolean;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.receipt_batches (original_filename, source_hash) VALUES ('r6m.csv', 'r6-mark') RETURNING id INTO v_batch;
  INSERT INTO public.receipt_rules (name, match_description) VALUES ('Mark harness rule', 'no file') RETURNING id INTO v_rule;
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_out, dedupe_hash, notes, rule_applied_id)
  VALUES (v_batch, DATE '2026-09-01', 'NO FILE', 10, 'r6m-1', 'A note that must survive', v_rule) RETURNING id INTO v_tx;
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_out, dedupe_hash)
  VALUES (v_batch, DATE '2026-09-02', 'HAS FILE', 10, 'r6m-2') RETURNING id INTO v_with_file;
  INSERT INTO public.receipt_files (transaction_id, storage_path, file_name) VALUES (v_with_file, '2026/mark_file', 'm.pdf');

  -- No file and no reason: refused, and nothing changes.
  v_result := public.mark_receipt_transaction(v_tx, 'completed', NULL, v_user, 'u@example.com', 'User');
  ASSERT v_result->>'outcome' = 'reason_required', format('no file, no reason: %s', v_result);
  v_result := public.mark_receipt_transaction(v_tx, 'completed', '    ', v_user, 'u@example.com', 'User');
  ASSERT v_result->>'outcome' = 'reason_required', 'a blank reason is no reason';
  SELECT * INTO v_row FROM public.receipt_transactions WHERE id = v_tx;
  ASSERT v_row.status = 'pending' AND v_row.marked_by IS NULL AND v_row.completed_reason IS NULL, 'a refused completion changes nothing';
  ASSERT NOT EXISTS (SELECT 1 FROM public.receipt_transaction_logs WHERE transaction_id = v_tx), 'and writes no history';

  -- With a reason: completed, the reason kept, the note untouched.
  v_result := public.mark_receipt_transaction(v_tx, 'completed', '  Parking meter, no receipt issued  ', v_user, 'u@example.com', 'User');
  ASSERT v_result->>'outcome' = 'updated' AND v_result->>'previous_status' = 'pending', format('with a reason: %s', v_result);
  ASSERT v_result->'transaction'->>'completed_reason' = 'Parking meter, no receipt issued', 'the payment comes back with its reason';
  SELECT * INTO v_row FROM public.receipt_transactions WHERE id = v_tx;
  ASSERT v_row.status = 'completed' AND NOT v_row.receipt_required AND v_row.completed_reason = 'Parking meter, no receipt issued', 'the reason is stored, trimmed';
  ASSERT v_row.marked_by = v_user AND v_row.marked_by_email = 'u@example.com' AND v_row.marked_by_name = 'User' AND v_row.marked_method = 'manual', 'who completed it is recorded';
  ASSERT v_row.rule_applied_id IS NULL, 'a status set by hand is no longer a rule''s';
  ASSERT v_row.notes = 'A note that must survive', 'the note is not touched by a status change';
  ASSERT (SELECT note FROM public.receipt_transaction_logs WHERE transaction_id = v_tx AND new_status = 'completed')
    = 'Completed without a receipt: Parking meter, no receipt issued', 'the history says why';

  -- Any other status clears the reason.
  v_result := public.mark_receipt_transaction(v_tx, 'pending', 'ignored', v_user, 'u@example.com', 'User');
  SELECT * INTO v_row FROM public.receipt_transactions WHERE id = v_tx;
  ASSERT v_row.status = 'pending' AND v_row.receipt_required AND v_row.completed_reason IS NULL, 'reopening clears the reason';
  v_result := public.mark_receipt_transaction(v_tx, 'cant_find', NULL, v_user, 'u@example.com', 'User');
  ASSERT v_result->>'outcome' = 'updated' AND (SELECT status FROM public.receipt_transactions WHERE id = v_tx) = 'cant_find', 'other statuses need no reason';

  -- With a file, no reason is needed.
  v_result := public.mark_receipt_transaction(v_with_file, 'completed', NULL, v_user, 'u@example.com', 'User');
  ASSERT v_result->>'outcome' = 'updated', format('with a file: %s', v_result);
  ASSERT (SELECT completed_reason IS NULL AND status = 'completed' FROM public.receipt_transactions WHERE id = v_with_file), 'a payment with a file is completed without a reason';

  -- A long reason is cut to what the column holds.
  v_result := public.mark_receipt_transaction(v_tx, 'completed', repeat('x', 700), v_user, 'u@example.com', 'User');
  ASSERT (SELECT char_length(completed_reason) FROM public.receipt_transactions WHERE id = v_tx) = 500, 'a reason is cut at 500 characters';

  v_result := public.mark_receipt_transaction(v_tx, 'archived', NULL, v_user, 'u@example.com', 'User');
  ASSERT v_result->>'outcome' = 'invalid_status', 'an unknown status is refused';
  v_result := public.mark_receipt_transaction(gen_random_uuid(), 'pending', NULL, v_user, 'u@example.com', 'User');
  ASSERT v_result->>'outcome' = 'not_found', 'an unknown payment is reported';

  -- The count of completed payments with neither a file nor a reason: the ones to review.
  -- At this point: v_tx is completed with a reason, v_with_file is completed with a file.
  ASSERT public.count_receipts_completed_without_receipt() = (
    SELECT count(*) FROM public.receipt_transactions t
    WHERE t.status = 'completed' AND t.completed_reason IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.receipt_files f WHERE f.transaction_id = t.id)
  ), 'the count agrees with the definition';
  DECLARE
    v_before integer := public.count_receipts_completed_without_receipt();
    v_bare uuid;
  BEGIN
    INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_out, dedupe_hash, status, receipt_required)
    VALUES (v_batch, DATE '2026-09-03', 'COMPLETED WITH NOTHING', 10, 'r6m-3', 'completed', false) RETURNING id INTO v_bare;
    ASSERT public.count_receipts_completed_without_receipt() = v_before + 1, 'a completed payment with no file and no reason is counted';
    UPDATE public.receipt_transactions SET completed_reason = 'Petty cash' WHERE id = v_bare;
    ASSERT public.count_receipts_completed_without_receipt() = v_before, 'a reason takes it out of the count';
    UPDATE public.receipt_transactions SET completed_reason = NULL WHERE id = v_bare;
    INSERT INTO public.receipt_files (transaction_id, storage_path, file_name) VALUES (v_bare, '2026/count_file', 'c.pdf');
    ASSERT public.count_receipts_completed_without_receipt() = v_before, 'so does a file';
    UPDATE public.receipt_transactions SET status = 'pending' WHERE id = v_tx;
    ASSERT public.count_receipts_completed_without_receipt() = v_before, 'a payment that is not completed is never counted';
  END;

  -- The column itself refuses an empty reason.
  v_failed := false;
  BEGIN
    UPDATE public.receipt_transactions SET completed_reason = '   ' WHERE id = v_tx;
  EXCEPTION WHEN check_violation THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'a reason of spaces is refused by the column';
END $$;

-- ---------------------------------------------------------------------------
-- 10.4 The invoice ledger: one transaction, never more than the payment's amount
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user uuid := '00000000-0000-0000-0000-000000000064';
  v_batch uuid;
  v_inv_vendor uuid;
  v_vendor uuid;
  v_inv_a uuid;
  v_inv_b uuid;
  v_inv_c uuid;
  v_inv_small uuid;
  v_single uuid;
  v_split uuid;
  v_fail uuid;
  v_locked uuid;
  v_result jsonb;
  v_first_payment uuid;
  v_failed boolean;
  v_row public.receipt_transactions%ROWTYPE;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.receipt_batches (original_filename, source_hash) VALUES ('r6l.csv', 'r6-ledger') RETURNING id INTO v_batch;
  INSERT INTO public.invoice_vendors (name) VALUES ('Ledger Client Ltd') RETURNING id INTO v_inv_vendor;
  INSERT INTO public.receipt_vendors (canonical_name, vendor_key) VALUES ('Ledger Client Ltd', 'ledger client ltd') RETURNING id INTO v_vendor;
  INSERT INTO public.invoices (invoice_number, vendor_id, total_amount) VALUES ('INV-LA', v_inv_vendor, 100) RETURNING id INTO v_inv_a;
  INSERT INTO public.invoices (invoice_number, vendor_id, total_amount) VALUES ('INV-LB', v_inv_vendor, 50) RETURNING id INTO v_inv_b;
  INSERT INTO public.invoices (invoice_number, vendor_id, total_amount) VALUES ('INV-LC', v_inv_vendor, 100) RETURNING id INTO v_inv_c;
  INSERT INTO public.invoices (invoice_number, vendor_id, total_amount) VALUES ('INV-SMALL', v_inv_vendor, 10) RETURNING id INTO v_inv_small;

  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_in, dedupe_hash)
  VALUES (v_batch, DATE '2026-09-10', 'LEDGER CLIENT INV-LA', 100, 'r6l-1') RETURNING id INTO v_single;

  -- The payment, the match and the bank payment's status in one call.
  v_result := public.record_receipt_invoice_payment(v_single, v_inv_a, 'INV-LA', 100, true, 100, 0, '{"k":"v"}'::jsonb, v_vendor, 'Ledger Client Ltd', v_user);
  ASSERT v_result->>'outcome' = 'applied' AND (v_result->>'payment_recorded')::boolean, format('first call: %s', v_result);
  v_first_payment := (v_result->>'invoice_payment_id')::uuid;
  ASSERT (SELECT count(*) FROM public.invoice_payments WHERE invoice_id = v_inv_a) = 1, 'one ledger entry';
  ASSERT (SELECT amount = 100 AND payment_date = DATE '2026-09-10' AND payment_method = 'bank_transfer' AND reference = 'LEDGER CLIENT INV-LA'
    FROM public.invoice_payments WHERE id = v_first_payment), 'the ledger entry carries the bank payment''s date, amount and text';
  ASSERT (SELECT invoice_payment_id = v_first_payment AND match_status = 'payment_recorded' AND invoice_id = v_inv_a
    FROM public.receipt_invoice_matches WHERE receipt_transaction_id = v_single), 'the match points at the ledger entry';
  SELECT * INTO v_row FROM public.receipt_transactions WHERE id = v_single;
  ASSERT v_row.status = 'no_receipt_required' AND v_row.vendor_id = v_vendor AND v_row.vendor_source = 'invoice', 'the bank payment is updated in the same call';

  -- A retry records nothing more.
  v_result := public.record_receipt_invoice_payment(v_single, v_inv_a, 'INV-LA', 100, true, 100, 0, '{}'::jsonb, v_vendor, 'Ledger Client Ltd', v_user);
  ASSERT v_result->>'outcome' = 'applied' AND NOT (v_result->>'payment_recorded')::boolean, format('retry: %s', v_result);
  ASSERT (v_result->>'invoice_payment_id')::uuid = v_first_payment, 'the retry answers with the first ledger entry';
  ASSERT (SELECT count(*) FROM public.invoice_payments WHERE invoice_id = v_inv_a) = 1, 'a retry adds no ledger entry';

  -- The whole of the bank payment is spoken for: a second invoice gets nothing.
  v_result := public.record_receipt_invoice_payment(v_single, v_inv_b, 'INV-LB', 50, true, 50, 0, '{}'::jsonb, v_vendor, 'Ledger Client Ltd', v_user);
  ASSERT v_result->>'outcome' = 'over_allocated', format('second invoice from a spent payment: %s', v_result);
  ASSERT (v_result->>'available')::numeric = 100 AND (v_result->>'allocated')::numeric = 100 AND (v_result->>'requested')::numeric = 50, 'the refusal gives the figures';
  ASSERT NOT EXISTS (SELECT 1 FROM public.invoice_payments WHERE invoice_id = v_inv_b), 'a refused allocation records no ledger entry';
  ASSERT NOT EXISTS (SELECT 1 FROM public.receipt_invoice_matches WHERE receipt_transaction_id = v_single AND invoice_number = 'INV-LB'), 'and stores no match';

  -- One bank payment may settle several invoices, up to its amount and no further.
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_in, dedupe_hash)
  VALUES (v_batch, DATE '2026-09-11', 'LEDGER CLIENT TWO INVOICES', 150, 'r6l-2') RETURNING id INTO v_split;
  v_result := public.record_receipt_invoice_payment(v_split, v_inv_c, 'INV-LC', 100, true, 100, 0, '{}'::jsonb, v_vendor, 'Ledger Client Ltd', v_user);
  ASSERT (v_result->>'payment_recorded')::boolean, 'the first of two invoices is recorded';
  v_result := public.record_receipt_invoice_payment(v_split, v_inv_b, 'INV-LB', 50, true, 50, 0, '{}'::jsonb, v_vendor, 'Ledger Client Ltd', v_user);
  ASSERT (v_result->>'payment_recorded')::boolean, 'the second fits exactly and is recorded';
  v_result := public.record_receipt_invoice_payment(v_split, v_inv_small, 'INV-SMALL', 0.01, true, 10, 0, '{}'::jsonb, v_vendor, 'Ledger Client Ltd', v_user);
  ASSERT v_result->>'outcome' = 'over_allocated', 'a penny more than the payment is refused';
  ASSERT (SELECT COALESCE(SUM(ip.amount), 0) FROM public.receipt_invoice_matches m JOIN public.invoice_payments ip ON ip.id = m.invoice_payment_id
    WHERE m.receipt_transaction_id = v_split) = 150, 'the allocations total the bank payment';

  -- The ledger refuses (more than the invoice has outstanding): nothing at all is stored.
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_in, dedupe_hash)
  VALUES (v_batch, DATE '2026-09-12', 'LEDGER CLIENT INV-SMALL', 50, 'r6l-3') RETURNING id INTO v_fail;
  v_failed := false;
  BEGIN
    v_result := public.record_receipt_invoice_payment(v_fail, v_inv_small, 'INV-SMALL', 50, false, 10, 0, '{}'::jsonb, v_vendor, 'Ledger Client Ltd', v_user);
  EXCEPTION WHEN raise_exception THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'a ledger refusal is raised, not swallowed';
  ASSERT NOT EXISTS (SELECT 1 FROM public.invoice_payments WHERE invoice_id = v_inv_small), 'no ledger entry survives it';
  ASSERT NOT EXISTS (SELECT 1 FROM public.receipt_invoice_matches WHERE receipt_transaction_id = v_fail), 'no match survives it';
  ASSERT (SELECT status FROM public.receipt_transactions WHERE id = v_fail) = 'pending', 'the bank payment is untouched';

  -- A match that cannot be stored takes the ledger entry back with it. The failure is forced:
  -- for this one call the match table refuses every insert.
  CREATE FUNCTION pg_temp.refuse_match() RETURNS trigger LANGUAGE plpgsql AS $f$
  BEGIN
    RAISE EXCEPTION 'match store refused for the test';
  END;
  $f$;
  CREATE TRIGGER trg_refuse_match BEFORE INSERT ON public.receipt_invoice_matches
    FOR EACH ROW EXECUTE FUNCTION pg_temp.refuse_match();
  v_failed := false;
  BEGIN
    v_result := public.record_receipt_invoice_payment(v_fail, v_inv_small, 'INV-SMALL', 10, true, 10, 0, '{}'::jsonb, v_vendor, 'Ledger Client Ltd', v_user);
  EXCEPTION WHEN raise_exception THEN
    v_failed := true;
  END;
  DROP TRIGGER trg_refuse_match ON public.receipt_invoice_matches;
  ASSERT v_failed, 'a match that cannot be stored fails the whole call';
  ASSERT NOT EXISTS (SELECT 1 FROM public.invoice_payments WHERE invoice_id = v_inv_small), 'the ledger entry is taken back with it';
  ASSERT (SELECT paid_amount FROM public.invoices WHERE id = v_inv_small) = 0, 'and the invoice is as it was';

  -- The same call, with nothing in the way, then goes through once.
  v_result := public.record_receipt_invoice_payment(v_fail, v_inv_small, 'INV-SMALL', 10, true, 10, 0, '{}'::jsonb, v_vendor, 'Ledger Client Ltd', v_user);
  ASSERT (v_result->>'payment_recorded')::boolean AND (SELECT count(*) FROM public.invoice_payments WHERE invoice_id = v_inv_small) = 1, 'the retry records it once';

  v_result := public.record_receipt_invoice_payment(gen_random_uuid(), v_inv_a, 'INV-LA', 1, true, 100, 0, '{}'::jsonb, NULL, NULL, NULL);
  ASSERT v_result->>'outcome' = 'transaction_not_found', 'an unknown bank payment is reported';

  v_failed := false;
  BEGIN
    PERFORM public.record_receipt_invoice_payment(v_single, v_inv_a, 'INV-LA', 0, true, 100, 0, '{}'::jsonb, NULL, NULL, NULL);
  EXCEPTION WHEN raise_exception THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'a zero amount is refused';
  v_failed := false;
  BEGIN
    PERFORM public.record_receipt_invoice_payment(v_single, NULL, 'INV-LA', 10, true, 100, 0, '{}'::jsonb, NULL, NULL, NULL);
  EXCEPTION WHEN raise_exception THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'a payment with no invoice is refused';

  -- Invoice pairing leaves a locked payment's status and vendor alone, and still records the match.
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_in, dedupe_hash)
  VALUES (v_batch, DATE '2026-03-31', 'LEDGER CLIENT OLD', 100, 'r6l-4') RETURNING id INTO v_locked;
  PERFORM public.set_receipts_locked_before(DATE '2026-03-31', v_user);
  v_result := public.apply_receipt_invoice_match(v_locked, v_inv_a, 'INV-LA', NULL, 'already_paid', true, 100, 100, 100, '{}'::jsonb, true, v_vendor, 'Ledger Client Ltd', v_user);
  ASSERT v_result->>'outcome' = 'applied' AND (v_result->>'locked')::boolean, format('locked payment: %s', v_result);
  ASSERT NOT (v_result->>'status_updated')::boolean AND NOT (v_result->>'vendor_updated')::boolean, 'nothing on a locked payment is changed';
  SELECT * INTO v_row FROM public.receipt_transactions WHERE id = v_locked;
  ASSERT v_row.status = 'pending' AND v_row.vendor_name IS NULL, 'the locked payment is as it was';
  ASSERT EXISTS (SELECT 1 FROM public.receipt_invoice_matches WHERE receipt_transaction_id = v_locked AND match_status = 'already_paid'), 'the match is still recorded';
  ASSERT NOT EXISTS (SELECT 1 FROM public.receipt_transaction_logs WHERE transaction_id = v_locked), 'and no history is written for a payment that did not change';

  -- The day after the lock date is not locked.
  UPDATE public.receipt_transactions SET transaction_date = DATE '2026-04-01' WHERE id = v_locked;
  v_result := public.apply_receipt_invoice_match(v_locked, v_inv_a, 'INV-LA', NULL, 'already_paid', true, 100, 100, 100, '{}'::jsonb, true, v_vendor, 'Ledger Client Ltd', v_user);
  ASSERT NOT (v_result->>'locked')::boolean AND (v_result->>'status_updated')::boolean, 'a payment after the lock date is paired as usual';
  PERFORM public.set_receipts_locked_before(NULL, v_user);
END $$;

-- ---------------------------------------------------------------------------
-- 10.6 An invoice attached to the payment that settled it
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user uuid := '00000000-0000-0000-0000-000000000065';
  v_batch uuid;
  v_inv_vendor uuid;
  v_inv_one uuid;
  v_inv_two uuid;
  v_matched uuid;
  v_second uuid;
  v_by_hand uuid;
  v_with_receipt uuid;
  v_locked uuid;
  v_result jsonb;
  v_file_id uuid;
  v_row public.receipt_transactions%ROWTYPE;
  v_file public.receipt_files%ROWTYPE;
  v_failed boolean;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.receipt_batches (original_filename, source_hash) VALUES ('r6i.csv', 'r6-invoice') RETURNING id INTO v_batch;
  INSERT INTO public.invoice_vendors (name) VALUES ('Attach Client') RETURNING id INTO v_inv_vendor;
  INSERT INTO public.invoices (invoice_number, vendor_id, total_amount) VALUES ('INV-AT1', v_inv_vendor, 100) RETURNING id INTO v_inv_one;
  INSERT INTO public.invoices (invoice_number, vendor_id, total_amount) VALUES ('INV-AT2', v_inv_vendor, 40) RETURNING id INTO v_inv_two;

  -- As invoice pairing leaves a payment: no receipt required, marked by the pairing.
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_in, dedupe_hash, status, receipt_required, marked_method, auto_completed_reason)
  VALUES (v_batch, DATE '2026-09-20', 'ATTACH CLIENT INV-AT1', 100, 'r6i-1', 'no_receipt_required', false, 'invoice_reconciliation', 'invoice_payment:INV-AT1') RETURNING id INTO v_matched;

  v_result := public.attach_receipt_invoice_file(v_matched, v_inv_one, 'INV-AT1', '2026/invoice_at1_v1', 'Invoice INV-AT1.pdf', 2048, 'hash-at1-v1', false, NULL);
  ASSERT v_result->>'outcome' = 'attached' AND (v_result->>'status_updated')::boolean, format('attach: %s', v_result);
  v_file_id := (v_result->'receipt'->>'id')::uuid;
  SELECT * INTO v_file FROM public.receipt_files WHERE id = v_file_id;
  ASSERT v_file.source = 'invoice' AND v_file.invoice_id = v_inv_one AND v_file.mime_type = 'application/pdf' AND v_file.file_name = 'Invoice INV-AT1.pdf'
    AND v_file.file_size_bytes = 2048 AND v_file.content_hash = 'hash-at1-v1' AND v_file.hash_verified_at IS NOT NULL, 'the file row describes the invoice copy';
  SELECT * INTO v_row FROM public.receipt_transactions WHERE id = v_matched;
  ASSERT v_row.status = 'completed' AND NOT v_row.receipt_required AND v_row.marked_method = 'invoice_attached'
    AND v_row.auto_completed_reason = 'invoice_payment:INV-AT1' AND v_row.marked_by IS NULL, 'the payment is completed, by the attachment and not by a person';
  ASSERT (SELECT count(*) FROM public.receipt_transaction_logs WHERE transaction_id = v_matched AND action_type = 'invoice_attached'
    AND previous_status = 'no_receipt_required' AND new_status = 'completed' AND note = 'Invoice INV-AT1 attached') = 1, 'one history row';

  -- The job runs twice: nothing more is written, and the second copy is the caller's to discard.
  v_result := public.attach_receipt_invoice_file(v_matched, v_inv_one, 'INV-AT1', '2026/invoice_at1_again', 'Invoice INV-AT1.pdf', 2048, 'hash-at1-v1', false, NULL);
  ASSERT v_result->>'outcome' = 'already_attached' AND (v_result->'receipt'->>'id')::uuid = v_file_id, format('second attach: %s', v_result);
  ASSERT (SELECT count(*) FROM public.receipt_files WHERE transaction_id = v_matched) = 1, 'one file, however many times it runs';
  ASSERT (SELECT storage_path FROM public.receipt_files WHERE id = v_file_id) = '2026/invoice_at1_v1', 'the stored copy is not swapped by a replay';
  ASSERT (SELECT count(*) FROM public.receipt_transaction_logs WHERE transaction_id = v_matched) = 1, 'and no more history';

  -- "Refresh invoice copy": the same row, a new object, the old path handed back to remove.
  v_result := public.attach_receipt_invoice_file(v_matched, v_inv_one, 'INV-AT1', '2026/invoice_at1_v2', 'Invoice INV-AT1.pdf', 4096, 'hash-at1-v2', true, v_user);
  ASSERT v_result->>'outcome' = 'refreshed' AND v_result->>'old_storage_path' = '2026/invoice_at1_v1', format('refresh: %s', v_result);
  SELECT * INTO v_file FROM public.receipt_files WHERE id = v_file_id;
  ASSERT v_file.storage_path = '2026/invoice_at1_v2' AND v_file.content_hash = 'hash-at1-v2' AND v_file.file_size_bytes = 4096 AND v_file.uploaded_by = v_user, 'the row points at the fresh copy';
  ASSERT (SELECT count(*) FROM public.receipt_files WHERE transaction_id = v_matched) = 1, 'a refresh adds no file';
  ASSERT (SELECT status FROM public.receipt_transactions WHERE id = v_matched) = 'completed', 'and does not touch the status';
  ASSERT EXISTS (SELECT 1 FROM public.receipt_transaction_logs WHERE transaction_id = v_matched AND action_type = 'invoice_copy_refreshed' AND performed_by = v_user), 'the refresh names who asked';

  -- A payment split across two invoices gets each one.
  v_result := public.attach_receipt_invoice_file(v_matched, v_inv_two, 'INV-AT2', '2026/invoice_at2_a', 'Invoice INV-AT2.pdf', 1000, 'hash-at2', false, NULL);
  ASSERT v_result->>'outcome' = 'attached' AND NOT (v_result->>'status_updated')::boolean, format('second invoice on one payment: %s', v_result);
  ASSERT (SELECT count(*) FROM public.receipt_files WHERE transaction_id = v_matched AND source = 'invoice') = 2, 'both invoices are on the payment';

  -- An invoice paid by two payments is attached to each.
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_in, dedupe_hash)
  VALUES (v_batch, DATE '2026-09-21', 'ATTACH CLIENT PART TWO', 60, 'r6i-2') RETURNING id INTO v_second;
  v_result := public.attach_receipt_invoice_file(v_second, v_inv_one, 'INV-AT1', '2026/invoice_at1_second', 'Invoice INV-AT1.pdf', 2048, 'hash-at1-v1', false, NULL);
  ASSERT v_result->>'outcome' = 'attached' AND (v_result->>'status_updated')::boolean, format('same invoice, another payment: %s', v_result);
  ASSERT (SELECT status FROM public.receipt_transactions WHERE id = v_second) = 'completed', 'a pending payment is completed by its invoice';

  -- A status a person set by hand stays as they set it. The invoice is still attached.
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_in, dedupe_hash, status, receipt_required, marked_by, marked_method)
  VALUES (v_batch, DATE '2026-09-22', 'ATTACH CLIENT BY HAND', 40, 'r6i-3', 'cant_find', false, v_user, 'manual') RETURNING id INTO v_by_hand;
  v_result := public.attach_receipt_invoice_file(v_by_hand, v_inv_two, 'INV-AT2', '2026/invoice_at2_hand', 'Invoice INV-AT2.pdf', 1000, 'hash-at2', false, NULL);
  SELECT * INTO v_row FROM public.receipt_transactions WHERE id = v_by_hand;
  ASSERT v_result->>'outcome' = 'attached' AND NOT (v_result->>'status_updated')::boolean, format('status set by hand: %s', v_result);
  ASSERT v_row.status = 'cant_find' AND v_row.marked_by = v_user AND v_row.marked_method = 'manual', 'the status a person set is kept';
  ASSERT EXISTS (SELECT 1 FROM public.receipt_files WHERE transaction_id = v_by_hand AND invoice_id = v_inv_two), 'the invoice is attached all the same';

  -- A payment already completed with its own receipt keeps who completed it.
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_in, dedupe_hash, status, receipt_required, marked_by, marked_method)
  VALUES (v_batch, DATE '2026-09-23', 'ATTACH CLIENT HAS RECEIPT', 40, 'r6i-4', 'completed', false, v_user, 'receipt_upload') RETURNING id INTO v_with_receipt;
  v_result := public.attach_receipt_invoice_file(v_with_receipt, v_inv_two, 'INV-AT2', '2026/invoice_at2_done', 'Invoice INV-AT2.pdf', 1000, 'hash-at2', false, NULL);
  SELECT * INTO v_row FROM public.receipt_transactions WHERE id = v_with_receipt;
  ASSERT NOT (v_result->>'status_updated')::boolean AND v_row.marked_by = v_user AND v_row.marked_method = 'receipt_upload', 'a completed payment keeps its marker';

  -- A payment on or before the lock date is left alone entirely.
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_in, dedupe_hash, status, receipt_required, marked_method)
  VALUES (v_batch, DATE '2026-03-31', 'ATTACH CLIENT OLD', 40, 'r6i-5', 'no_receipt_required', false, 'invoice_reconciliation') RETURNING id INTO v_locked;
  PERFORM public.set_receipts_locked_before(DATE '2026-03-31', v_user);
  v_result := public.attach_receipt_invoice_file(v_locked, v_inv_two, 'INV-AT2', '2026/invoice_at2_locked', 'Invoice INV-AT2.pdf', 1000, 'hash-at2', false, NULL);
  ASSERT v_result->>'outcome' = 'locked', format('locked payment: %s', v_result);
  ASSERT NOT EXISTS (SELECT 1 FROM public.receipt_files WHERE transaction_id = v_locked), 'nothing is attached to a locked payment';
  ASSERT (SELECT status FROM public.receipt_transactions WHERE id = v_locked) = 'no_receipt_required', 'and its status is as it was';
  -- A copy already attached can still be refreshed after the period is locked: it changes no figure.
  v_result := public.attach_receipt_invoice_file(v_matched, v_inv_one, 'INV-AT1', '2026/invoice_at1_v3', 'Invoice INV-AT1.pdf', 4096, 'hash-at1-v3', true, v_user);
  ASSERT v_result->>'outcome' = 'refreshed', 'an attached copy can be refreshed';
  PERFORM public.set_receipts_locked_before(NULL, v_user);

  v_result := public.attach_receipt_invoice_file(gen_random_uuid(), v_inv_one, 'INV-AT1', '2026/x', 'x.pdf', 1, 'h', false, NULL);
  ASSERT v_result->>'outcome' = 'transaction_not_found', 'an unknown payment is reported';

  -- The table itself allows one copy of an invoice per payment, and only the two sources.
  v_failed := false;
  BEGIN
    INSERT INTO public.receipt_files (transaction_id, storage_path, file_name, source, invoice_id)
    VALUES (v_matched, '2026/invoice_at1_dup', 'dup.pdf', 'invoice', v_inv_one);
  EXCEPTION WHEN unique_violation THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'a second copy of the same invoice on one payment is refused by the table';
  v_failed := false;
  BEGIN
    INSERT INTO public.receipt_files (transaction_id, storage_path, file_name, source) VALUES (v_matched, '2026/bad_source', 'b.pdf', 'email');
  EXCEPTION WHEN check_violation THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'an unknown file source is refused';
END $$;

-- ---------------------------------------------------------------------------
-- 10.5 Grants
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_fn text;
  v_table text;
  v_oid oid;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.complete_receipt_upload(uuid, text, uuid, text, text, text, text, bigint, text, text)',
    'public.delete_receipt_file(uuid, uuid)',
    'public.mark_receipt_transaction(uuid, text, text, uuid, text, text)',
    'public.apply_receipt_invoice_match(uuid, uuid, text, uuid, text, boolean, numeric, numeric, numeric, jsonb, boolean, uuid, text, uuid)',
    'public.record_receipt_invoice_payment(uuid, uuid, text, numeric, boolean, numeric, numeric, jsonb, uuid, text, uuid)',
    'public.attach_receipt_invoice_file(uuid, uuid, text, text, text, bigint, text, boolean, uuid)',
    'public.count_receipts_completed_without_receipt()',
    'public.get_receipt_monthly_category_breakdown(integer, integer)',
    'public.get_receipt_monthly_status_counts(integer)',
    'public.get_receipt_vendor_trends(integer)',
    'public.get_ai_usage_breakdown()',
    'public.get_openai_usage_total()',
    'public.get_receipt_detail_groups(integer, text[], boolean, boolean)'
  ] LOOP
    v_oid := v_fn::regprocedure::oid;
    ASSERT NOT has_function_privilege('anon', v_oid, 'EXECUTE'), format('%s must not be callable by anon', v_fn);
    ASSERT NOT has_function_privilege('authenticated', v_oid, 'EXECUTE'), format('%s must not be callable by authenticated', v_fn);
    ASSERT has_function_privilege('service_role', v_oid, 'EXECUTE'), format('%s must be callable by service_role', v_fn);
  END LOOP;

  FOREACH v_fn IN ARRAY ARRAY[
    'public.complete_receipt_upload(uuid, text, uuid, text, text, text, text, bigint, text, text)',
    'public.delete_receipt_file(uuid, uuid)',
    'public.mark_receipt_transaction(uuid, text, text, uuid, text, text)',
    'public.apply_receipt_invoice_match(uuid, uuid, text, uuid, text, boolean, numeric, numeric, numeric, jsonb, boolean, uuid, text, uuid)',
    'public.record_receipt_invoice_payment(uuid, uuid, text, numeric, boolean, numeric, numeric, jsonb, uuid, text, uuid)',
    'public.attach_receipt_invoice_file(uuid, uuid, text, text, text, bigint, text, boolean, uuid)'
  ] LOOP
    ASSERT (SELECT proconfig IS NOT NULL FROM pg_proc WHERE oid = v_fn::regprocedure::oid), format('%s must pin its search_path', v_fn);
  END LOOP;

  -- One form of each function that changed its arguments, so a call by name finds one function.
  ASSERT (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'complete_receipt_upload') = 1,
    'complete_receipt_upload has one form';
  ASSERT (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'get_receipt_detail_groups') = 1,
    'get_receipt_detail_groups has one form';

  FOREACH v_table IN ARRAY ARRAY[
    'receipt_batches', 'receipt_files', 'receipt_rules', 'receipt_transaction_logs',
    'receipt_transactions', 'receipt_upload_intents'
  ] LOOP
    ASSERT NOT has_table_privilege('anon', 'public.' || v_table, 'SELECT'), format('%s must not be readable by anon', v_table);
    ASSERT NOT has_table_privilege('authenticated', 'public.' || v_table, 'SELECT'), format('%s must not be readable by authenticated', v_table);
    ASSERT NOT has_table_privilege('authenticated', 'public.' || v_table, 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.' || v_table, 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.' || v_table, 'DELETE'), format('%s must not be writable by authenticated', v_table);
    ASSERT has_table_privilege('service_role', 'public.' || v_table, 'SELECT'), format('%s must still be readable by service_role', v_table);
    ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || v_table)::regclass), format('row security stays on for %s', v_table);
  END LOOP;
END $$;

ROLLBACK;

\echo 'RECEIPTS RELEASE 6 FILES TESTS PASSED'
