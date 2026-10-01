-- AI attempts, "no category applies", and deciding a suggested category (spec 8.2 items 1, 4, 8).
\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_user uuid := '00000000-0000-0000-0000-0000000004a1';
  v_batch uuid;
  v_vendor uuid;
  v_other_vendor uuid;
  v_rule uuid;
  v_rule_with_category uuid;
  v_tx_accept uuid;
  v_tx_none uuid;
  v_tx_edit uuid;
  v_tx_dismiss uuid;
  v_tx_taken uuid;
  v_tx_in uuid;
  v_tx_plain uuid;
  v_attempt uuid;
  v_suggestion uuid;
  v_result jsonb;
  v_failed boolean;
  v_stamp timestamptz;
  v_text text;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user) ON CONFLICT DO NOTHING;
  INSERT INTO public.receipt_batches (original_filename, source_hash) VALUES ('r4.csv', 'r4-hash') RETURNING id INTO v_batch;
  INSERT INTO public.receipt_vendors (canonical_name, vendor_key) VALUES ('Booker', 'booker') RETURNING id INTO v_vendor;
  INSERT INTO public.receipt_vendors (canonical_name, vendor_key) VALUES ('Booker Wholesale', 'booker wholesale') RETURNING id INTO v_other_vendor;

  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_out, dedupe_hash) VALUES (v_batch, DATE '2026-09-01', 'BOOKER A', 10, 'r4-a') RETURNING id INTO v_tx_accept;
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_out, dedupe_hash) VALUES (v_batch, DATE '2026-09-02', 'HMRC VAT', 900, 'r4-b') RETURNING id INTO v_tx_none;
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_out, dedupe_hash) VALUES (v_batch, DATE '2026-09-03', 'BOOKER C', 30, 'r4-c') RETURNING id INTO v_tx_edit;
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_out, dedupe_hash) VALUES (v_batch, DATE '2026-09-04', 'BOOKER D', 40, 'r4-d') RETURNING id INTO v_tx_dismiss;
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_out, dedupe_hash, expense_category, expense_category_source) VALUES (v_batch, DATE '2026-09-05', 'BOOKER E', 50, 'r4-e', 'Entertainment', 'manual') RETURNING id INTO v_tx_taken;
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_in, dedupe_hash) VALUES (v_batch, DATE '2026-09-06', 'REFUND BOOKER', 5, 'r4-f') RETURNING id INTO v_tx_in;
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_out, dedupe_hash) VALUES (v_batch, DATE '2026-09-07', 'NO PROPOSAL', 60, 'r4-g') RETURNING id INTO v_tx_plain;

  -- ----- Sources and the "no category applies" flag ------------------------------------------
  UPDATE public.receipt_transactions SET expense_category = 'Entertainment', expense_category_source = 'ai_accepted' WHERE id = v_tx_plain;
  ASSERT (SELECT expense_category_source FROM public.receipt_transactions WHERE id = v_tx_plain) = 'ai_accepted', 'ai_accepted is an allowed category source';
  UPDATE public.receipt_transactions SET vendor_name = 'Booker', vendor_source = 'ai_accepted' WHERE id = v_tx_plain;
  UPDATE public.receipt_transactions SET expense_category = NULL, expense_category_source = NULL, vendor_name = NULL, vendor_source = NULL WHERE id = v_tx_plain;

  v_failed := false;
  BEGIN
    UPDATE public.receipt_transactions SET expense_category = 'Entertainment', no_category_applies = true WHERE id = v_tx_plain;
  EXCEPTION WHEN check_violation THEN v_failed := true;
  END;
  ASSERT v_failed, 'a payment cannot have a category and be marked "no category applies"';

  v_failed := false;
  BEGIN
    INSERT INTO public.receipt_rules (name, match_description, set_expense_category, set_no_category) VALUES ('Bad', 'bad', 'Entertainment', true);
  EXCEPTION WHEN check_violation THEN v_failed := true;
  END;
  ASSERT v_failed, 'nor can a rule set both';

  -- ----- One attempt per payment and prompt version ------------------------------------------
  INSERT INTO public.receipt_ai_attempts (transaction_id, prompt_version, outcome, vendor_id, vendor_written, proposed_expense_category, category_state, confidence)
  VALUES (v_tx_accept, 'v1', 'vendor_written', v_vendor, true, 'Sundries/Consumables', 'proposed', 90) RETURNING id INTO v_attempt;

  v_failed := false;
  BEGIN
    INSERT INTO public.receipt_ai_attempts (transaction_id, prompt_version, outcome) VALUES (v_tx_accept, 'v1', 'nothing_identified');
  EXCEPTION WHEN unique_violation THEN v_failed := true;
  END;
  ASSERT v_failed, 'a payment has one attempt per prompt version';
  INSERT INTO public.receipt_ai_attempts (transaction_id, prompt_version, outcome) VALUES (v_tx_accept, 'v0', 'nothing_identified');

  v_failed := false;
  BEGIN
    INSERT INTO public.receipt_ai_attempts (transaction_id, prompt_version, outcome) VALUES (v_tx_plain, 'v1', 'guessed');
  EXCEPTION WHEN check_violation THEN v_failed := true;
  END;
  ASSERT v_failed, 'an outcome outside the list is refused';

  -- A category the AI wrote onto the payment is recorded as written, which is not an open proposal.
  INSERT INTO public.receipt_ai_attempts (transaction_id, prompt_version, outcome, proposed_expense_category, category_state)
  VALUES (v_tx_plain, 'v-written', 'category_written', 'Telephone', 'written');
  ASSERT (SELECT count(*) FROM public.receipt_ai_attempts WHERE transaction_id = v_tx_plain AND category_state = 'proposed') = 0,
    'a written category is not a proposal waiting for a person';
  DELETE FROM public.receipt_ai_attempts WHERE transaction_id = v_tx_plain AND prompt_version = 'v-written';

  INSERT INTO public.receipt_ai_attempts (transaction_id, prompt_version, outcome, proposed_no_category, category_state) VALUES (v_tx_none, 'v1', 'category_proposed', true, 'proposed');
  INSERT INTO public.receipt_ai_attempts (transaction_id, prompt_version, outcome, proposed_expense_category, category_state) VALUES (v_tx_edit, 'v1', 'category_proposed', 'Sundries/Consumables', 'proposed');
  INSERT INTO public.receipt_ai_attempts (transaction_id, prompt_version, outcome, proposed_expense_category, category_state) VALUES (v_tx_dismiss, 'v1', 'category_proposed', 'Sundries/Consumables', 'proposed');
  INSERT INTO public.receipt_ai_attempts (transaction_id, prompt_version, outcome, proposed_expense_category, category_state) VALUES (v_tx_taken, 'v1', 'category_proposed', 'Sundries/Consumables', 'proposed');
  INSERT INTO public.receipt_ai_attempts (transaction_id, prompt_version, outcome, proposed_expense_category, category_state) VALUES (v_tx_in, 'v1', 'category_proposed', 'Sundries/Consumables', 'proposed');

  -- ----- Deciding a suggested category --------------------------------------------------------
  v_result := public.decide_receipt_ai_category(v_tx_accept, 'accept', NULL, false, v_user);
  ASSERT v_result->>'outcome' = 'accepted' AND v_result->>'expense_category' = 'Sundries/Consumables', format('accept: %s', v_result);
  ASSERT (SELECT expense_category = 'Sundries/Consumables' AND expense_category_source = 'ai_accepted' AND NOT no_category_applies AND expense_rule_id IS NULL
          FROM public.receipt_transactions WHERE id = v_tx_accept), 'accepting writes the proposal as ai_accepted';
  ASSERT (SELECT category_state = 'accepted' AND reviewed_by = v_user AND reviewed_at IS NOT NULL FROM public.receipt_ai_attempts WHERE id = v_attempt), 'and closes the proposal, naming who accepted';
  ASSERT (SELECT count(*) FROM public.receipt_transaction_logs WHERE transaction_id = v_tx_accept AND action_type = 'ai_category_accepted' AND performed_by = v_user) = 1, 'with a history row';
  ASSERT public.decide_receipt_ai_category(v_tx_accept, 'accept', NULL, false, v_user)->>'outcome' = 'no_proposal', 'a second accept finds nothing open';

  v_result := public.decide_receipt_ai_category(v_tx_none, 'accept', NULL, false, v_user);
  ASSERT v_result->>'outcome' = 'accepted' AND (v_result->>'no_category_applies')::boolean, format('accepting "no category applies": %s', v_result);
  ASSERT (SELECT expense_category IS NULL AND no_category_applies AND expense_category_source = 'ai_accepted' FROM public.receipt_transactions WHERE id = v_tx_none), 'the flag is set and the category stays empty';

  v_result := public.decide_receipt_ai_category(v_tx_edit, 'edit', '   ', false, v_user);
  ASSERT v_result->>'outcome' = 'invalid', 'an edit needs a category or the flag';
  ASSERT (SELECT category_state FROM public.receipt_ai_attempts WHERE transaction_id = v_tx_edit) = 'proposed', 'and leaves the proposal open';
  v_result := public.decide_receipt_ai_category(v_tx_edit, 'edit', 'Entertainment', false, v_user);
  ASSERT v_result->>'outcome' = 'edited', format('edit: %s', v_result);
  ASSERT (SELECT expense_category = 'Entertainment' AND expense_category_source = 'manual' FROM public.receipt_transactions WHERE id = v_tx_edit), 'an edit is the person''s own choice: source manual';
  ASSERT (SELECT category_state FROM public.receipt_ai_attempts WHERE transaction_id = v_tx_edit) = 'edited', 'the proposal records that it was changed';

  v_result := public.decide_receipt_ai_category(v_tx_dismiss, 'dismiss', NULL, false, v_user);
  ASSERT v_result->>'outcome' = 'dismissed', format('dismiss: %s', v_result);
  ASSERT (SELECT expense_category IS NULL AND expense_category_source IS NULL FROM public.receipt_transactions WHERE id = v_tx_dismiss), 'dismissing writes nothing to the payment';
  ASSERT (SELECT category_state FROM public.receipt_ai_attempts WHERE transaction_id = v_tx_dismiss) = 'dismissed', 'and closes the proposal';

  v_result := public.decide_receipt_ai_category(v_tx_taken, 'accept', NULL, false, v_user);
  ASSERT v_result->>'outcome' = 'already_classified', format('a payment categorised in the meantime: %s', v_result);
  ASSERT (SELECT expense_category = 'Entertainment' AND expense_category_source = 'manual' FROM public.receipt_transactions WHERE id = v_tx_taken), 'keeps what the person chose';
  ASSERT (SELECT category_state FROM public.receipt_ai_attempts WHERE transaction_id = v_tx_taken) = 'superseded', 'and the proposal is closed as superseded';

  ASSERT public.decide_receipt_ai_category(v_tx_in, 'accept', NULL, false, v_user)->>'outcome' = 'not_outgoing', 'money coming in takes no category';
  ASSERT public.decide_receipt_ai_category(v_tx_plain, 'accept', NULL, false, v_user)->>'outcome' = 'no_proposal', 'no proposal, nothing to accept';
  ASSERT public.decide_receipt_ai_category(gen_random_uuid(), 'accept', NULL, false, v_user)->>'outcome' = 'not_found', 'an unknown payment';
  ASSERT public.decide_receipt_ai_category(v_tx_plain, 'maybe', NULL, false, v_user)->>'outcome' = 'invalid', 'an unknown decision';

  -- ----- The field writers know the flag ----------------------------------------------------
  SELECT updated_at INTO v_stamp FROM public.receipt_transactions WHERE id = v_tx_plain;
  v_text := public.apply_receipt_rule_change(v_tx_plain, v_stamp,
    jsonb_build_object('expense_category', NULL, 'no_category_applies', true, 'expense_category_source', 'rule'), '[]'::jsonb, v_user);
  ASSERT v_text = 'applied' AND (SELECT no_category_applies AND expense_category_source = 'rule' FROM public.receipt_transactions WHERE id = v_tx_plain), 'a rule can mark a payment "no category applies"';
  ASSERT public.receipt_payment_field_image(v_tx_plain, '{"no_category_applies": null}'::jsonb) = '{"no_category_applies": true}'::jsonb, 'the flag is part of a before-image';
  ASSERT public.receipt_payment_holds_fields(v_tx_plain, '{"no_category_applies": true, "expense_category": null}'::jsonb), 'and of the "still holds" check';
  ASSERT NOT public.receipt_payment_holds_fields(v_tx_plain, '{"no_category_applies": false}'::jsonb), 'a different flag does not hold';

  -- ----- Bulk review groups ------------------------------------------------------------------
  ASSERT (SELECT needs_expense_count FROM public.get_receipt_detail_groups(50, ARRAY['pending'], false, false) WHERE details = 'NO PROPOSAL') = 0, 'a payment marked "no category applies" does not need a category';
  ASSERT (SELECT needs_expense_count FROM public.get_receipt_detail_groups(50, ARRAY['pending'], false, false) WHERE details = 'REFUND BOOKER') = 0, 'nor does money coming in';
  ASSERT (SELECT needs_expense_count FROM public.get_receipt_detail_groups(50, ARRAY['pending'], false, false) WHERE details = 'BOOKER D') = 1, 'an uncategorised money-out payment does';
  UPDATE public.receipt_transactions SET vendor_name = 'Booker', vendor_source = 'manual' WHERE id IN (v_tx_plain, v_tx_in);
  ASSERT NOT EXISTS (SELECT 1 FROM public.get_receipt_detail_groups(50, ARRAY['pending'], true, false) WHERE details IN ('NO PROPOSAL', 'REFUND BOOKER')), 'once they have a vendor they are not listed as unclassified';

  -- ----- Bulk classification and the flag -----------------------------------------------------
  ASSERT (SELECT no_category_applies FROM public.receipt_transactions WHERE id = v_tx_plain), 'the payment starts marked "no category applies"';
  v_result := public.apply_receipt_group_classification_atomic(
    'NO PROPOSAL', ARRAY['pending']::public.receipt_transaction_status[], false, NULL, NULL, true, 'Entertainment', v_user, 'Bulk classification: Expense'
  );
  ASSERT (v_result->>'updated')::int = 1, format('bulk classification of a flagged payment: %s', v_result);
  ASSERT (SELECT expense_category = 'Entertainment' AND NOT no_category_applies AND expense_category_source = 'manual' FROM public.receipt_transactions WHERE id = v_tx_plain), 'giving it a category in bulk clears the flag';

  -- ----- "Add this category to the existing rule" ---------------------------------------------
  INSERT INTO public.receipt_rules (name, match_description, vendor_id, set_vendor_name, reviewed_at, reviewed_by)
  VALUES ('Booker', 'booker', v_vendor, 'Booker', now(), v_user) RETURNING id INTO v_rule;
  INSERT INTO public.receipt_rule_suggestions (suggested_name, match_description, set_vendor_id, set_vendor_name, set_expense_category, evidence)
  VALUES ('Booker: add category', 'booker', v_vendor, 'Booker', 'Sundries/Consumables', jsonb_build_object('kind', 'add_category', 'target_rule_id', v_rule))
  RETURNING id INTO v_suggestion;

  v_result := public.approve_receipt_rule_category_suggestion(v_suggestion, v_user);
  ASSERT v_result->>'outcome' = 'approved' AND (v_result->>'rule_id')::uuid = v_rule, format('approving an add-category suggestion: %s', v_result);
  ASSERT (SELECT set_expense_category = 'Sundries/Consumables' AND updated_by = v_user AND reviewed_at IS NULL FROM public.receipt_rules WHERE id = v_rule), 'the existing rule gains the category and needs reviewing again';
  ASSERT (SELECT count(*) FROM public.receipt_rules WHERE match_description = 'booker') = 1, 'no second rule is created';
  ASSERT (SELECT status = 'approved' AND approved_rule_id = v_rule AND reviewed_by = v_user FROM public.receipt_rule_suggestions WHERE id = v_suggestion), 'the suggestion is approved against that rule';
  ASSERT public.approve_receipt_rule_category_suggestion(v_suggestion, v_user)->>'outcome' = 'not_pending', 'it cannot be approved twice';

  INSERT INTO public.receipt_rule_suggestions (suggested_name, match_description, set_expense_category, evidence)
  VALUES ('Booker: other category', 'booker', 'Entertainment', jsonb_build_object('kind', 'add_category', 'target_rule_id', v_rule))
  RETURNING id INTO v_suggestion;
  v_result := public.approve_receipt_rule_category_suggestion(v_suggestion, v_user);
  ASSERT v_result->>'outcome' = 'rule_has_category', format('a rule that already sets a different category: %s', v_result);
  ASSERT (SELECT set_expense_category FROM public.receipt_rules WHERE id = v_rule) = 'Sundries/Consumables', 'is not overwritten';

  UPDATE public.receipt_rules SET is_active = false WHERE id = v_rule;
  ASSERT public.approve_receipt_rule_category_suggestion(v_suggestion, v_user)->>'outcome' = 'rule_unavailable', 'a switched-off rule is not changed';
  ASSERT public.approve_receipt_rule_category_suggestion(gen_random_uuid(), v_user)->>'outcome' = 'not_found', 'an unknown suggestion';

  -- ----- A vendor merge carries what the AI recorded, and undo returns it --------------------
  v_result := public.merge_receipt_vendor(v_vendor, v_other_vendor, v_user);
  ASSERT v_result->>'outcome' = 'merged', format('merge with AI attempts: %s', v_result);
  ASSERT (SELECT vendor_id FROM public.receipt_ai_attempts WHERE id = v_attempt) = v_other_vendor, 'the AI attempt follows the vendor to its survivor';
  v_result := public.undo_receipt_vendor_operation((v_result->>'operation_id')::uuid, v_user);
  ASSERT v_result->>'outcome' = 'undone', format('undo merge with AI attempts: %s', v_result);
  ASSERT (SELECT vendor_id FROM public.receipt_ai_attempts WHERE id = v_attempt) = v_vendor, 'and goes back when the merge is undone';
END $$;

DO $$
DECLARE
  v_fn text;
  v_oid oid;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.decide_receipt_ai_category(uuid, text, text, boolean, uuid)',
    'public.approve_receipt_rule_category_suggestion(uuid, uuid)',
    'public.receipt_write_payment_fields(uuid, jsonb)',
    'public.receipt_payment_field_image(uuid, jsonb)',
    'public.receipt_payment_holds_fields(uuid, jsonb)',
    'public.get_receipt_detail_groups(integer, text[], boolean, boolean)',
    'public.get_receipt_ai_usage()'
  ] LOOP
    v_oid := v_fn::regprocedure::oid;
    ASSERT NOT has_function_privilege('anon', v_oid, 'EXECUTE'), format('%s must not be callable by anon', v_fn);
    ASSERT NOT has_function_privilege('authenticated', v_oid, 'EXECUTE'), format('%s must not be callable by authenticated', v_fn);
    ASSERT has_function_privilege('service_role', v_oid, 'EXECUTE'), format('%s must be callable by service_role', v_fn);
    ASSERT (SELECT proconfig IS NOT NULL FROM pg_proc WHERE oid = v_oid), format('%s must pin its search_path', v_fn);
  END LOOP;

  ASSERT NOT has_table_privilege('anon', 'public.receipt_ai_attempts', 'SELECT'), 'AI attempts are not readable by anon';
  ASSERT NOT has_table_privilege('authenticated', 'public.receipt_ai_attempts', 'SELECT'), 'nor by authenticated';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.receipt_ai_attempts'::regclass), 'row security is on for AI attempts';
END $$;

-- ---------------------------------------------------------------------------
-- The cost tile counts receipts spend only
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_usage jsonb;
BEGIN
  DELETE FROM public.ai_usage_events;
  v_usage := public.get_receipt_ai_usage();
  ASSERT (v_usage->>'total_cost')::numeric = 0, 'no events: nothing spent';
  ASSERT (v_usage->>'total_calls')::int = 0, 'no events: no calls';

  INSERT INTO public.ai_usage_events (context, model, cost, occurred_at) VALUES
    ('receipt_classification:12', 'gpt-test', 0.010000, now()),
    ('receipt_group:abc', 'gpt-test', 0.002000, now() - interval '3 months'),
    ('receipt_vendor_cost_review', 'gpt-test', 0.000500, now() - interval '3 months'),
    ('recruitment:screening', 'gpt-test', 5.000000, now()),
    ('receipts', 'gpt-test', 7.000000, now());

  v_usage := public.get_receipt_ai_usage();
  ASSERT v_usage->>'currency' = 'USD', 'the figure is in US dollars';
  ASSERT (v_usage->>'total_cost')::numeric = 0.0125, format('receipts contexts only, got %s', v_usage->>'total_cost');
  ASSERT (v_usage->>'total_calls')::int = 3, 'three receipts calls';
  ASSERT (v_usage->>'this_month_cost')::numeric = 0.01, format('this month only, got %s', v_usage->>'this_month_cost');
  ASSERT (v_usage->>'this_month_calls')::int = 1, 'one receipts call this month';
END $$;

ROLLBACK;

\echo 'RECEIPTS RELEASE 4 AI TESTS PASSED'
