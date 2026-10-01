-- apply_receipt_invoice_match, the wider CHECK lists and the rule default (spec 5.0, 5.2, 5.4).
\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_user uuid := '00000000-0000-0000-0000-000000000011';
  v_batch uuid;
  v_inv_vendor uuid;
  v_invoice uuid;
  v_payment uuid;
  v_vendor uuid;
  v_rule uuid;
  v_pending uuid;
  v_completed uuid;
  v_manual_vendor uuid;
  v_reopened uuid;
  v_cant_find uuid;
  v_multi uuid;
  v_result jsonb;
  v_row public.receipt_transactions%ROWTYPE;
  v_match public.receipt_invoice_matches%ROWTYPE;
  v_failed boolean;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.receipt_batches (original_filename, source_hash) VALUES ('m.csv', 'hm') RETURNING id INTO v_batch;
  INSERT INTO public.invoice_vendors (name) VALUES ('Harness Client Ltd') RETURNING id INTO v_inv_vendor;
  INSERT INTO public.invoices (invoice_number, vendor_id, total_amount) VALUES ('INV-H1', v_inv_vendor, 100) RETURNING id INTO v_invoice;
  INSERT INTO public.invoice_payments (invoice_id, amount, payment_date) VALUES (v_invoice, 100, DATE '2026-09-02') RETURNING id INTO v_payment;
  INSERT INTO public.receipt_vendors (canonical_name, vendor_key) VALUES ('Harness Client Ltd', 'harness client ltd') RETURNING id INTO v_vendor;

  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_in, dedupe_hash)
  VALUES (v_batch, DATE '2026-09-02', 'HARNESS CLIENT', 100, 'm1') RETURNING id INTO v_pending;
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_in, dedupe_hash, status, receipt_required, marked_by, marked_method, vendor_name, vendor_source)
  VALUES (v_batch, DATE '2026-09-03', 'HARNESS CLIENT INV-H1', 100, 'm2', 'completed', false, v_user, 'receipt_upload', 'Old Rule Name', 'rule') RETURNING id INTO v_completed;
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_in, dedupe_hash, vendor_name, vendor_source)
  VALUES (v_batch, DATE '2026-09-04', 'HARNESS CLIENT INV-H1', 100, 'm3', 'Typed By Hand', 'manual') RETURNING id INTO v_manual_vendor;
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_in, dedupe_hash, marked_by, marked_method)
  VALUES (v_batch, DATE '2026-09-05', 'HARNESS CLIENT INV-H1', 100, 'm4', v_user, 'manual') RETURNING id INTO v_reopened;
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_in, dedupe_hash, status, receipt_required, marked_by, marked_method)
  VALUES (v_batch, DATE '2026-09-06', 'HARNESS CLIENT INV-H1', 100, 'm5', 'cant_find', false, v_user, 'manual') RETURNING id INTO v_cant_find;
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_in, dedupe_hash)
  VALUES (v_batch, DATE '2026-09-07', 'HARNESS CLIENT INV-H1 INV-H2', 200, 'm6') RETURNING id INTO v_multi;

  -- The status the reference-free pairing writes is now accepted, with the payment update, in one call.
  v_result := public.apply_receipt_invoice_match(v_pending, v_invoice, 'INV-H1', NULL, 'vendor_amount_matched', true, 100, 100, 0, '{"match_method":"vendor_amount"}'::jsonb, true, v_vendor, 'Harness Client Ltd', v_user);
  ASSERT v_result->>'outcome' = 'applied' AND (v_result->>'status_updated')::boolean AND (v_result->>'vendor_updated')::boolean, format('pending payment: %s', v_result);
  SELECT * INTO v_row FROM public.receipt_transactions WHERE id = v_pending;
  ASSERT v_row.status = 'no_receipt_required' AND v_row.receipt_required = false, 'a pending payment moves to no receipt required';
  ASSERT v_row.marked_method = 'invoice_reconciliation' AND v_row.auto_completed_reason = 'invoice_payment:INV-H1', 'the reason names the invoice';
  ASSERT v_row.vendor_name = 'Harness Client Ltd' AND v_row.vendor_id = v_vendor AND v_row.vendor_source = 'invoice', 'the vendor carries the invoice source';
  SELECT * INTO v_match FROM public.receipt_invoice_matches WHERE receipt_transaction_id = v_pending;
  ASSERT v_match.match_status = 'vendor_amount_matched' AND v_match.invoice_id = v_invoice AND v_match.transaction_date = DATE '2026-09-02', 'the match row is stored with its provenance';
  ASSERT (SELECT count(*) FROM public.receipt_transaction_logs WHERE transaction_id = v_pending AND performed_by = v_user) = 2, 'status and vendor log rows name the initiating user';

  -- A second identical call changes nothing more.
  v_result := public.apply_receipt_invoice_match(v_pending, v_invoice, 'INV-H1', NULL, 'vendor_amount_matched', true, 100, 100, 0, '{}'::jsonb, true, v_vendor, 'Harness Client Ltd', v_user);
  ASSERT NOT (v_result->>'status_updated')::boolean AND NOT (v_result->>'vendor_updated')::boolean, 'a repeat call is a no-op on the payment';
  ASSERT (SELECT count(*) FROM public.receipt_invoice_matches WHERE receipt_transaction_id = v_pending) = 1, 'a repeat call keeps one match row';
  ASSERT (SELECT count(*) FROM public.receipt_transaction_logs WHERE transaction_id = v_pending) = 2, 'a repeat call writes no log';

  -- A completed payment keeps its status and its marker; a rule-set vendor may be replaced.
  v_result := public.apply_receipt_invoice_match(v_completed, v_invoice, 'INV-H1', NULL, 'already_paid', true, 100, 100, 100, '{}'::jsonb, true, v_vendor, 'Harness Client Ltd', NULL);
  SELECT * INTO v_row FROM public.receipt_transactions WHERE id = v_completed;
  ASSERT NOT (v_result->>'status_updated')::boolean, 'a completed payment is never downgraded';
  ASSERT v_row.status = 'completed' AND v_row.marked_by = v_user AND v_row.marked_method = 'receipt_upload', 'the completed payment keeps who marked it';
  ASSERT v_row.vendor_name = 'Harness Client Ltd' AND v_row.vendor_source = 'invoice', 'a rule-set vendor is replaced by the invoice vendor';
  ASSERT EXISTS (SELECT 1 FROM public.receipt_invoice_matches WHERE receipt_transaction_id = v_completed AND match_status = 'already_paid'), 'the match is still recorded for a closed payment';

  -- A hand-entered vendor is never replaced.
  v_result := public.apply_receipt_invoice_match(v_manual_vendor, v_invoice, 'INV-H1', NULL, 'already_paid', true, 100, 100, 100, '{}'::jsonb, true, v_vendor, 'Harness Client Ltd', NULL);
  SELECT * INTO v_row FROM public.receipt_transactions WHERE id = v_manual_vendor;
  ASSERT NOT (v_result->>'vendor_updated')::boolean AND v_row.vendor_name = 'Typed By Hand' AND v_row.vendor_source = 'manual', 'a hand-entered vendor survives';
  ASSERT v_row.status = 'no_receipt_required', 'its pending status still moves';

  -- A payment a person reopened stays pending.
  v_result := public.apply_receipt_invoice_match(v_reopened, v_invoice, 'INV-H1', NULL, 'already_paid', true, 100, 100, 100, '{}'::jsonb, true, v_vendor, 'Harness Client Ltd', NULL);
  ASSERT NOT (v_result->>'status_updated')::boolean, 'a manually reopened payment is not closed again';
  ASSERT (SELECT status FROM public.receipt_transactions WHERE id = v_reopened) = 'pending', 'the reopened payment is still pending';

  -- Can't find is explained by the invoice.
  v_result := public.apply_receipt_invoice_match(v_cant_find, v_invoice, 'INV-H1', NULL, 'already_paid', true, 100, 100, 100, '{}'::jsonb, true, v_vendor, 'Harness Client Ltd', NULL);
  ASSERT (v_result->>'status_updated')::boolean AND (SELECT status FROM public.receipt_transactions WHERE id = v_cant_find) = 'no_receipt_required', 'a can''t-find payment moves';

  -- Several invoice numbers: recorded for review, the payment untouched.
  v_result := public.apply_receipt_invoice_match(v_multi, v_invoice, 'INV-H1', NULL, 'multiple_invoice_refs', false, 200, 100, 0, '{}'::jsonb, false, NULL, NULL, NULL);
  SELECT * INTO v_row FROM public.receipt_transactions WHERE id = v_multi;
  ASSERT v_row.status = 'pending' AND v_row.vendor_name IS NULL, 'a multi-reference payment is left for a person';
  ASSERT EXISTS (SELECT 1 FROM public.receipt_invoice_matches WHERE receipt_transaction_id = v_multi AND match_status = 'multiple_invoice_refs'), 'the multi-reference match is recorded';

  -- A payment id once stored is kept, and the match is not relabelled "already paid".
  v_result := public.apply_receipt_invoice_match(v_multi, v_invoice, 'INV-KEEP', v_payment, 'payment_recorded', true, 100, 100, 0, '{}'::jsonb, false, NULL, NULL, NULL);
  v_result := public.apply_receipt_invoice_match(v_multi, v_invoice, 'INV-KEEP', NULL, 'already_paid', true, 100, 100, 100, '{}'::jsonb, false, NULL, NULL, NULL);
  SELECT * INTO v_match FROM public.receipt_invoice_matches WHERE receipt_transaction_id = v_multi AND invoice_number = 'INV-KEEP';
  ASSERT v_match.invoice_payment_id = v_payment AND v_match.match_status = 'payment_recorded', 'the recorded payment survives a later run';

  -- A status the constraint rejects rolls the whole call back: no match row, no payment change.
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_in, dedupe_hash)
  VALUES (v_batch, DATE '2026-09-08', 'HARNESS CLIENT', 100, 'm7') RETURNING id INTO v_pending;
  v_failed := false;
  BEGIN
    v_result := public.apply_receipt_invoice_match(v_pending, v_invoice, 'INV-H1', NULL, 'not_a_status', true, 100, 100, 0, '{}'::jsonb, true, v_vendor, 'Harness Client Ltd', NULL);
  EXCEPTION WHEN check_violation THEN
    v_failed := true;
  END;
  ASSERT v_failed, 'an unknown match status is refused';
  SELECT * INTO v_row FROM public.receipt_transactions WHERE id = v_pending;
  ASSERT v_row.status = 'pending' AND v_row.vendor_name IS NULL, 'a refused match leaves the payment untouched';
  ASSERT NOT EXISTS (SELECT 1 FROM public.receipt_invoice_matches WHERE receipt_transaction_id = v_pending), 'a refused match stores nothing';

  -- An unknown payment is reported, not raised.
  v_result := public.apply_receipt_invoice_match(gen_random_uuid(), v_invoice, 'INV-H1', NULL, 'matched', true, 100, 100, 0, '{}'::jsonb, true, NULL, NULL, NULL);
  ASSERT v_result->>'outcome' = 'transaction_not_found', 'an unknown payment is reported';

  -- The wider source lists and the new rule default.
  UPDATE public.receipt_transactions SET expense_category_source = 'invoice' WHERE id = v_pending;
  INSERT INTO public.receipt_rules (name, match_description) VALUES ('Harness rule', 'harness') RETURNING id INTO v_rule;
  ASSERT (SELECT auto_status FROM public.receipt_rules WHERE id = v_rule) = 'pending', 'a new rule leaves the payment pending by default';
END $$;

ROLLBACK;

\echo 'RECEIPTS INVOICE MATCH TESTS PASSED'
