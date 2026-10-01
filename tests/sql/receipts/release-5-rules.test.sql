-- Lock date, single rule changes, and previewed runs with undo (spec 9.2 items 1 to 3).
\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_user uuid := '00000000-0000-0000-0000-0000000005a1';
  v_batch uuid;
  v_vendor uuid;
  v_rule uuid;
  v_other_rule uuid;
  v_tx_a uuid;
  v_tx_b uuid;
  v_tx_c uuid;
  v_tx_old uuid;
  v_tx_single uuid;
  v_stamp timestamptz;
  v_run uuid;
  v_stale uuid;
  v_result jsonb;
  v_text text;
  v_after jsonb;
  v_ruleset_at timestamptz;
  v_ruleset_count integer;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user) ON CONFLICT DO NOTHING;
  INSERT INTO public.receipt_batches (original_filename, source_hash) VALUES ('r5.csv', 'r5-hash') RETURNING id INTO v_batch;
  INSERT INTO public.receipt_vendors (canonical_name, vendor_key) VALUES ('Acme Supplies', 'acme supplies') RETURNING id INTO v_vendor;
  INSERT INTO public.receipt_rules (name, match_description, vendor_id, set_vendor_name, set_expense_category, auto_status)
  VALUES ('Acme', 'acme', v_vendor, 'Acme Supplies', 'Sundries/Consumables', 'no_receipt_required') RETURNING id INTO v_rule;
  INSERT INTO public.receipt_rules (name, match_description) VALUES ('Other', 'other') RETURNING id INTO v_other_rule;

  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_out, dedupe_hash)
  VALUES (v_batch, DATE '2026-08-10', 'ACME A', 10, 'r5-a') RETURNING id INTO v_tx_a;
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_out, dedupe_hash)
  VALUES (v_batch, DATE '2026-08-11', 'ACME B', 20, 'r5-b') RETURNING id INTO v_tx_b;
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_out, dedupe_hash, vendor_name, vendor_source)
  VALUES (v_batch, DATE '2026-08-12', 'ACME C', 30, 'r5-c', 'Guess Ltd', 'ai') RETURNING id INTO v_tx_c;
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_out, dedupe_hash)
  VALUES (v_batch, DATE '2026-03-31', 'ACME OLD', 40, 'r5-old') RETURNING id INTO v_tx_old;
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_out, dedupe_hash)
  VALUES (v_batch, DATE '2026-08-13', 'ACME SINGLE', 50, 'r5-single') RETURNING id INTO v_tx_single;

  v_after := jsonb_build_object(
    'status', 'no_receipt_required', 'receipt_required', false,
    'marked_by', NULL, 'marked_by_email', NULL, 'marked_by_name', NULL,
    'marked_at', '2026-10-01T12:00:00.000Z', 'marked_method', 'rule', 'rule_applied_id', v_rule,
    'vendor_id', v_vendor, 'vendor_name', 'Acme Supplies', 'vendor_source', 'rule', 'vendor_rule_id', v_rule,
    'vendor_updated_at', '2026-10-01T12:00:00.000Z',
    'expense_category', 'Sundries/Consumables', 'expense_category_source', 'rule', 'expense_rule_id', v_rule,
    'expense_updated_at', '2026-10-01T12:00:00.000Z'
  );

  -- ----- Lock date ----------------------------------------------------------------------------
  ASSERT public.receipts_locked_before() IS NULL, 'no lock to begin with';
  v_result := public.set_receipts_locked_before(DATE '2026-03-31', v_user);
  ASSERT v_result->>'previous' IS NULL AND v_result->>'current' = '2026-03-31', format('setting the lock: %s', v_result);
  ASSERT public.receipts_locked_before() = DATE '2026-03-31', 'the lock date is read back';
  ASSERT (SELECT updated_by FROM public.receipt_settings WHERE key = 'locked_before') = v_user, 'and who set it';
  v_result := public.set_receipts_locked_before(DATE '2026-03-31', v_user);
  ASSERT v_result->>'previous' = '2026-03-31', 'setting it again reports the previous value';

  -- ----- One change with its history ------------------------------------------------------------
  SELECT updated_at INTO v_stamp FROM public.receipt_transactions WHERE id = v_tx_single;
  v_text := public.apply_receipt_rule_change(
    v_tx_single, v_stamp, v_after,
    jsonb_build_array(
      jsonb_build_object('action_type', 'rule_auto_mark', 'note', 'Auto-marked by rule: Acme', 'rule_id', v_rule),
      jsonb_build_object('action_type', 'rule_classification', 'note', 'Classification updated by rule Acme', 'rule_id', v_rule)
    ),
    v_user
  );
  ASSERT v_text = 'applied', format('a change to an unchanged payment: %s', v_text);
  ASSERT (SELECT status = 'no_receipt_required' AND NOT receipt_required AND marked_method = 'rule' AND rule_applied_id = v_rule
            AND vendor_id = v_vendor AND vendor_name = 'Acme Supplies' AND vendor_source = 'rule' AND vendor_rule_id = v_rule
            AND expense_category = 'Sundries/Consumables' AND expense_category_source = 'rule' AND expense_rule_id = v_rule
            AND marked_at = TIMESTAMPTZ '2026-10-01 12:00:00+00'
          FROM public.receipt_transactions WHERE id = v_tx_single), 'every field is written';
  ASSERT (SELECT count(*) FROM public.receipt_transaction_logs
          WHERE transaction_id = v_tx_single AND performed_by = v_user AND rule_id = v_rule
            AND previous_status = 'pending' AND new_status = 'no_receipt_required') = 2, 'both history rows are written with it, naming the person and the rule';

  -- Every statement in this test shares one transaction and so one clock reading, which means a
  -- second write does not move updated_at here as it does between real requests. A version from
  -- "before" is therefore an older stamp.
  v_text := public.apply_receipt_rule_change(v_tx_single, v_stamp - interval '1 second', jsonb_build_object('vendor_name', 'Wrong'), '[]'::jsonb, v_user);
  ASSERT v_text = 'changed', format('a payment that has moved on is not written: %s', v_text);
  ASSERT (SELECT vendor_name FROM public.receipt_transactions WHERE id = v_tx_single) = 'Acme Supplies', 'and keeps its value';

  SELECT updated_at INTO v_stamp FROM public.receipt_transactions WHERE id = v_tx_old;
  v_text := public.apply_receipt_rule_change(v_tx_old, v_stamp, v_after, '[]'::jsonb, v_user);
  ASSERT v_text = 'locked', format('a payment on or before the lock date is not written: %s', v_text);
  ASSERT (SELECT status = 'pending' AND vendor_name IS NULL FROM public.receipt_transactions WHERE id = v_tx_old), 'and is untouched';
  ASSERT public.apply_receipt_rule_change(gen_random_uuid(), now(), v_after) = 'not_found', 'an unknown payment';

  -- A key that is absent is left alone; a key that is present and null is cleared.
  SELECT updated_at INTO v_stamp FROM public.receipt_transactions WHERE id = v_tx_single;
  v_text := public.apply_receipt_rule_change(v_tx_single, v_stamp, jsonb_build_object('expense_category', NULL, 'expense_rule_id', NULL), '[]'::jsonb, v_user);
  ASSERT (SELECT expense_category IS NULL AND expense_rule_id IS NULL AND vendor_name = 'Acme Supplies' AND status = 'no_receipt_required'
          FROM public.receipt_transactions WHERE id = v_tx_single), 'null clears a named field, and fields not named are kept';

  -- ----- A previewed run --------------------------------------------------------------------------
  SELECT max(updated_at), count(*) INTO v_ruleset_at, v_ruleset_count FROM public.receipt_rules WHERE is_active;

  INSERT INTO public.receipt_rule_runs (kind, rule_id, label, scope, rule_updated_at, ruleset_updated_at, ruleset_count, lock_date, status, planned_count, created_by)
  VALUES ('rule_run', v_rule, 'Acme', 'all', (SELECT updated_at FROM public.receipt_rules WHERE id = v_rule), v_ruleset_at, v_ruleset_count, DATE '2026-03-31', 'drafting', 4, v_user)
  RETURNING id INTO v_run;

  INSERT INTO public.receipt_rule_run_changes (run_id, transaction_id, expected_updated_at, after, logs)
  SELECT v_run, t.id, t.updated_at, v_after,
         jsonb_build_array(jsonb_build_object('action_type', 'rule_auto_mark', 'note', 'Auto-marked by rule: Acme', 'rule_id', v_rule))
  FROM public.receipt_transactions t WHERE t.id IN (v_tx_a, v_tx_b, v_tx_c, v_tx_old);

  ASSERT public.apply_receipt_rule_run(v_run, v_user)->>'outcome' = 'not_ready', 'a preview still being written cannot be applied';
  UPDATE public.receipt_rule_runs SET status = 'previewed' WHERE id = v_run;

  -- Someone edits one payment after the preview: its version is no longer the one previewed.
  UPDATE public.receipt_transactions SET notes = 'edited after the preview' WHERE id = v_tx_b;
  UPDATE public.receipt_rule_run_changes SET expected_updated_at = expected_updated_at - interval '1 second'
  WHERE run_id = v_run AND transaction_id = v_tx_b;

  -- Applied in steps of two.
  v_result := public.apply_receipt_rule_run(v_run, v_user, 2);
  ASSERT v_result->>'outcome' = 'in_progress' AND (v_result->>'remaining')::int = 2, format('first step: %s', v_result);
  v_result := public.apply_receipt_rule_run(v_run, v_user, 2);
  ASSERT v_result->>'outcome' = 'completed' AND (v_result->>'remaining')::int = 0, format('second step: %s', v_result);
  ASSERT (v_result->>'applied_total')::int = 2 AND (v_result->>'skipped_changed_total')::int = 1 AND (v_result->>'skipped_locked_total')::int = 1, format('run totals: %s', v_result);

  ASSERT (SELECT status = 'no_receipt_required' AND vendor_name = 'Acme Supplies' AND vendor_source = 'rule' FROM public.receipt_transactions WHERE id = v_tx_a), 'an unchanged payment is written';
  ASSERT (SELECT vendor_name = 'Acme Supplies' AND vendor_source = 'rule' FROM public.receipt_transactions WHERE id = v_tx_c), 'so is the one that held an AI guess';
  ASSERT (SELECT status = 'pending' AND vendor_name IS NULL FROM public.receipt_transactions WHERE id = v_tx_b), 'the payment edited after the preview is skipped';
  ASSERT (SELECT status = 'pending' AND vendor_name IS NULL FROM public.receipt_transactions WHERE id = v_tx_old), 'the payment behind the lock date is skipped';
  ASSERT (SELECT state FROM public.receipt_rule_run_changes WHERE run_id = v_run AND transaction_id = v_tx_b) = 'skipped_changed', 'and recorded as changed';
  ASSERT (SELECT state FROM public.receipt_rule_run_changes WHERE run_id = v_run AND transaction_id = v_tx_old) = 'skipped_locked', 'and as locked';
  ASSERT (SELECT before->>'vendor_name' = 'Guess Ltd' AND before->>'vendor_source' = 'ai' AND before->>'status' = 'pending' AND before ? 'vendor_id' AND before->>'vendor_id' IS NULL
          FROM public.receipt_rule_run_changes WHERE run_id = v_run AND transaction_id = v_tx_c), 'what was replaced is stored with the change';
  ASSERT (SELECT count(*) FROM public.receipt_transaction_logs WHERE transaction_id IN (v_tx_a, v_tx_c) AND action_type = 'rule_auto_mark' AND performed_by = v_user) = 2, 'each applied change has its history row';
  ASSERT (SELECT status = 'completed' AND completed_at IS NOT NULL AND started_at IS NOT NULL FROM public.receipt_rule_runs WHERE id = v_run), 'the run is completed';

  v_result := public.apply_receipt_rule_run(v_run, v_user);
  ASSERT v_result->>'outcome' = 'completed' AND (v_result->>'applied')::int = 0, 'applying a completed run again changes nothing';

  -- ----- A preview that has gone stale stops -------------------------------------------------------
  INSERT INTO public.receipt_rule_runs (kind, rule_id, scope, rule_updated_at, ruleset_updated_at, ruleset_count, lock_date, status, planned_count, created_by)
  VALUES ('rule_run', v_rule, 'pending', (SELECT updated_at FROM public.receipt_rules WHERE id = v_rule), v_ruleset_at, v_ruleset_count, DATE '2026-03-31', 'previewed', 1, v_user)
  RETURNING id INTO v_stale;
  INSERT INTO public.receipt_rule_run_changes (run_id, transaction_id, expected_updated_at, after)
  SELECT v_stale, id, updated_at, v_after FROM public.receipt_transactions WHERE id = v_tx_b;

  -- The rule is edited after the preview: the version the preview saw is now an older one.
  UPDATE public.receipt_rules SET set_expense_category = 'Maintenance and Service Plan Charges' WHERE id = v_rule;
  UPDATE public.receipt_rule_runs SET rule_updated_at = rule_updated_at - interval '1 second' WHERE id = v_stale;
  v_result := public.apply_receipt_rule_run(v_stale, v_user);
  ASSERT v_result->>'outcome' = 'stale_preview' AND v_result->>'reason' = 'rule_changed', format('the rule changed since the preview: %s', v_result);
  ASSERT (SELECT status = 'pending' AND vendor_name IS NULL FROM public.receipt_transactions WHERE id = v_tx_b), 'and nothing was written';
  ASSERT (SELECT status = 'stopped' AND stop_reason = 'rule_changed' FROM public.receipt_rule_runs WHERE id = v_stale), 'the run is stopped';
  ASSERT public.apply_receipt_rule_run(v_stale, v_user)->>'outcome' = 'stale_preview', 'and stays stopped';

  -- Another rule changing also invalidates a preview: precedence may have moved.
  SELECT max(updated_at), count(*) INTO v_ruleset_at, v_ruleset_count FROM public.receipt_rules WHERE is_active;
  INSERT INTO public.receipt_rule_runs (kind, rule_id, scope, rule_updated_at, ruleset_updated_at, ruleset_count, lock_date, status, created_by)
  VALUES ('rule_run', v_rule, 'pending', (SELECT updated_at FROM public.receipt_rules WHERE id = v_rule), v_ruleset_at, v_ruleset_count, DATE '2026-03-31', 'previewed', v_user)
  RETURNING id INTO v_stale;
  UPDATE public.receipt_rules SET is_active = false WHERE id = v_other_rule;
  v_result := public.apply_receipt_rule_run(v_stale, v_user);
  ASSERT v_result->>'outcome' = 'stale_preview' AND v_result->>'reason' = 'rules_changed', format('another rule changed since the preview: %s', v_result);

  -- So does the lock date.
  SELECT max(updated_at), count(*) INTO v_ruleset_at, v_ruleset_count FROM public.receipt_rules WHERE is_active;
  INSERT INTO public.receipt_rule_runs (kind, rule_id, scope, rule_updated_at, ruleset_updated_at, ruleset_count, lock_date, status, created_by)
  VALUES ('rule_run', v_rule, 'pending', (SELECT updated_at FROM public.receipt_rules WHERE id = v_rule), v_ruleset_at, v_ruleset_count, DATE '2026-03-31', 'previewed', v_user)
  RETURNING id INTO v_stale;
  PERFORM public.set_receipts_locked_before(DATE '2026-06-30', v_user);
  v_result := public.apply_receipt_rule_run(v_stale, v_user);
  ASSERT v_result->>'outcome' = 'stale_preview' AND v_result->>'reason' = 'lock_date_changed', format('the lock date changed since the preview: %s', v_result);
  PERFORM public.set_receipts_locked_before(DATE '2026-03-31', v_user);

  ASSERT public.apply_receipt_rule_run(gen_random_uuid(), v_user)->>'outcome' = 'not_found', 'an unknown run';

  -- ----- Undo -------------------------------------------------------------------------------------
  ASSERT public.undo_receipt_rule_run(v_stale, v_user)->>'outcome' = 'nothing_to_undo', 'a run that applied nothing has nothing to undo';

  -- A person re-categorises one of the two payments the run changed.
  UPDATE public.receipt_transactions SET expense_category = 'Entertainment', expense_category_source = 'manual', expense_rule_id = NULL WHERE id = v_tx_a;

  v_result := public.undo_receipt_rule_run(v_run, v_user, 1);
  ASSERT v_result->>'outcome' = 'in_progress' AND (v_result->>'remaining')::int = 1, format('undo, first step: %s', v_result);
  v_result := public.undo_receipt_rule_run(v_run, v_user, 1);
  ASSERT v_result->>'outcome' = 'undone' AND (v_result->>'restored_total')::int = 1 AND (v_result->>'conflict_total')::int = 1, format('undo, second step: %s', v_result);

  ASSERT (SELECT status = 'pending' AND receipt_required AND vendor_name = 'Guess Ltd' AND vendor_source = 'ai' AND vendor_id IS NULL AND vendor_rule_id IS NULL
            AND expense_category IS NULL AND expense_category_source IS NULL AND marked_method IS NULL AND rule_applied_id IS NULL AND marked_at IS NULL
          FROM public.receipt_transactions WHERE id = v_tx_c), 'a payment still holding the applied values gets exactly what it had before';
  ASSERT (SELECT status = 'no_receipt_required' AND vendor_name = 'Acme Supplies' AND expense_category = 'Entertainment' AND expense_category_source = 'manual'
          FROM public.receipt_transactions WHERE id = v_tx_a), 'a payment a person has changed since is left exactly as it is';
  ASSERT (SELECT state FROM public.receipt_rule_run_changes WHERE run_id = v_run AND transaction_id = v_tx_a) = 'undo_conflict', 'and recorded as a conflict';
  ASSERT (SELECT count(*) FROM public.receipt_transaction_logs WHERE transaction_id = v_tx_c AND action_type = 'rule_run_undone' AND performed_by = v_user) = 1, 'the undo has its history row';
  ASSERT (SELECT status = 'undone' AND undone_by = v_user AND undone_at IS NOT NULL FROM public.receipt_rule_runs WHERE id = v_run), 'the run is marked undone';

  v_result := public.undo_receipt_rule_run(v_run, v_user);
  ASSERT v_result->>'outcome' = 'already_undone' AND (v_result->>'restored_total')::int = 1, format('a second undo changes nothing: %s', v_result);
  ASSERT public.apply_receipt_rule_run(v_run, v_user)->>'outcome' = 'undone', 'an undone run cannot be applied again';

  -- Undo respects the lock date too.
  SELECT max(updated_at), count(*) INTO v_ruleset_at, v_ruleset_count FROM public.receipt_rules WHERE is_active;
  INSERT INTO public.receipt_rule_runs (kind, label, scope, ruleset_updated_at, ruleset_count, lock_date, status, created_by)
  VALUES ('bulk_apply', 'Bulk: ACME', 'all', NULL, NULL, DATE '2026-03-31', 'previewed', v_user)
  RETURNING id INTO v_stale;
  INSERT INTO public.receipt_rule_run_changes (run_id, transaction_id, expected_updated_at, after)
  SELECT v_stale, id, updated_at, jsonb_build_object('vendor_id', v_vendor, 'vendor_name', 'Acme Supplies', 'vendor_source', 'manual')
  FROM public.receipt_transactions WHERE id = v_tx_b;
  v_result := public.apply_receipt_rule_run(v_stale, v_user);
  ASSERT v_result->>'outcome' = 'completed' AND (v_result->>'applied')::int = 1, format('a bulk change runs without a rule: %s', v_result);
  PERFORM public.set_receipts_locked_before(DATE '2026-08-31', v_user);
  v_result := public.undo_receipt_rule_run(v_stale, v_user);
  ASSERT v_result->>'outcome' = 'undone' AND (v_result->>'conflicts')::int = 1 AND (v_result->>'restored')::int = 0, format('a payment now behind the lock date is not put back: %s', v_result);
  ASSERT (SELECT vendor_name FROM public.receipt_transactions WHERE id = v_tx_b) = 'Acme Supplies', 'it keeps the value';
END $$;

DO $$
DECLARE
  v_fn text;
  v_oid oid;
  v_table text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.receipts_locked_before()',
    'public.set_receipts_locked_before(date, uuid)',
    'public.receipt_write_payment_fields(uuid, jsonb)',
    'public.receipt_payment_field_image(uuid, jsonb)',
    'public.receipt_payment_holds_fields(uuid, jsonb)',
    'public.apply_receipt_rule_change(uuid, timestamptz, jsonb, jsonb, uuid)',
    'public.apply_receipt_rule_run(uuid, uuid, integer)',
    'public.undo_receipt_rule_run(uuid, uuid, integer)'
  ] LOOP
    v_oid := v_fn::regprocedure::oid;
    ASSERT NOT has_function_privilege('anon', v_oid, 'EXECUTE'), format('%s must not be callable by anon', v_fn);
    ASSERT NOT has_function_privilege('authenticated', v_oid, 'EXECUTE'), format('%s must not be callable by authenticated', v_fn);
    ASSERT has_function_privilege('service_role', v_oid, 'EXECUTE'), format('%s must be callable by service_role', v_fn);
    ASSERT (SELECT proconfig IS NOT NULL FROM pg_proc WHERE oid = v_oid), format('%s must pin its search_path', v_fn);
  END LOOP;

  FOREACH v_table IN ARRAY ARRAY['receipt_settings', 'receipt_rule_runs', 'receipt_rule_run_changes'] LOOP
    ASSERT NOT has_table_privilege('anon', format('public.%I', v_table), 'SELECT'), format('%s is not readable by anon', v_table);
    ASSERT NOT has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT'), format('%s is not readable by authenticated', v_table);
    ASSERT NOT has_table_privilege('authenticated', format('public.%I', v_table), 'UPDATE'), format('%s is not writable by authenticated', v_table);
    ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = format('public.%I', v_table)::regclass), format('row security is on for %s', v_table);
  END LOOP;
END $$;

ROLLBACK;

\echo 'RECEIPTS RELEASE 5 RULES TESTS PASSED'
