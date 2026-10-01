-- Vendor resolver, merge, rename and undo (spec 7.2 items 2, 3 and 6).
\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_user uuid := '00000000-0000-0000-0000-0000000003a1';
  v_other_user uuid := '00000000-0000-0000-0000-0000000003a2';
  v_batch uuid;
  v_oak uuid;        -- "Oak Farm Gas Co", the survivor
  v_oak_ltd uuid;    -- "Oak Farm Gas Co Ltd", merged away
  v_veolia uuid;
  v_tesco uuid;
  v_invoice_vendor uuid;
  v_rule uuid;
  v_keyless_rule uuid;
  v_suggestion uuid;
  v_tx_a uuid;
  v_tx_b uuid;
  v_tx_text uuid;
  v_tx_other uuid;
  v_result jsonb;
  v_merge_op uuid;
  v_rename_op uuid;
  v_second jsonb;
  v_count integer;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user), (v_other_user) ON CONFLICT DO NOTHING;
  INSERT INTO public.invoice_vendors (name) VALUES ('Oak Farm Gas (invoicing)') RETURNING id INTO v_invoice_vendor;
  INSERT INTO public.receipt_batches (original_filename, source_hash) VALUES ('r3.csv', 'r3-hash') RETURNING id INTO v_batch;

  INSERT INTO public.receipt_vendors (canonical_name, vendor_key) VALUES ('Oak Farm Gas Co', 'oak farm gas co') RETURNING id INTO v_oak;
  INSERT INTO public.receipt_vendors (canonical_name, vendor_key, invoice_vendor_id) VALUES ('Oak Farm Gas Co Ltd', 'oak farm gas co ltd', v_invoice_vendor) RETURNING id INTO v_oak_ltd;
  INSERT INTO public.receipt_vendors (canonical_name, vendor_key) VALUES ('Veolia', 'veolia') RETURNING id INTO v_veolia;
  INSERT INTO public.receipt_vendors (canonical_name, vendor_key) VALUES ('Tesco', 'tesco') RETURNING id INTO v_tesco;
  INSERT INTO public.receipt_vendor_aliases (vendor_id, alias, alias_key, source) VALUES
    (v_oak_ltd, 'Oak Farm Gas Co Ltd', 'oak farm gas co ltd', 'migration'),
    (v_oak_ltd, 'OFG', 'ofg', 'manual');

  ASSERT (SELECT kind = 'business' AND origin = 'unknown' FROM public.receipt_vendors WHERE id = v_oak), 'existing vendors default to business, origin unknown';

  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_out, dedupe_hash, vendor_id, vendor_name, vendor_source)
  VALUES (v_batch, DATE '2026-08-01', 'OAK FARM GAS A', 100, 'r3-a', v_oak_ltd, 'Oak Farm Gas Co Ltd', 'manual') RETURNING id INTO v_tx_a;
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_out, dedupe_hash, vendor_id, vendor_name, vendor_source)
  VALUES (v_batch, DATE '2026-08-02', 'OAK FARM GAS B', 50, 'r3-b', v_oak_ltd, 'Oak Farm Gas Co Ltd', 'rule') RETURNING id INTO v_tx_b;
  -- Named in text only, in another case: no vendor id.
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_out, dedupe_hash, vendor_id, vendor_name, vendor_source)
  VALUES (v_batch, DATE '2026-08-03', 'OAK FARM GAS C', 25, 'r3-c', NULL, 'OAK FARM GAS CO LTD', 'manual') RETURNING id INTO v_tx_text;
  INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_out, dedupe_hash, vendor_id, vendor_name, vendor_source)
  VALUES (v_batch, DATE '2026-08-04', 'VEOLIA', 80, 'r3-d', v_veolia, 'Veolia', 'manual') RETURNING id INTO v_tx_other;

  INSERT INTO public.receipt_rules (name, match_description, vendor_id, set_vendor_name) VALUES ('Oak gas', 'oak farm gas', v_oak_ltd, 'Oak Farm Gas Co Ltd') RETURNING id INTO v_rule;
  INSERT INTO public.receipt_rules (name, match_description, vendor_id, set_vendor_name) VALUES ('Oak gas, no id', 'ofg', NULL, 'Oak Farm Gas Co Ltd') RETURNING id INTO v_keyless_rule;
  INSERT INTO public.receipt_rule_suggestions (suggested_name, match_description, set_vendor_id, set_vendor_name) VALUES ('Oak suggestion', 'oak farm', v_oak_ltd, 'Oak Farm Gas Co Ltd') RETURNING id INTO v_suggestion;

  -- One person watches both vendors, another only the one being merged away.
  INSERT INTO public.receipt_vendor_watchlist (user_id, vendor_key, vendor_label, vendor_id) VALUES
    (v_user, 'oak farm gas co', 'Oak Farm Gas Co', v_oak),
    (v_user, 'oak farm gas co ltd', 'Oak Farm Gas Co Ltd', v_oak_ltd),
    (v_other_user, 'oak farm gas co ltd', 'Oak Farm Gas Co Ltd', v_oak_ltd);
  -- The same month reviewed on both: "action required" on the one being merged away.
  INSERT INTO public.receipt_vendor_reviews (user_id, vendor_key, vendor_label, comparison, month_start, status, vendor_id) VALUES
    (v_user, 'oak farm gas co', 'Oak Farm Gas Co', 'yoy', DATE '2026-08-01', 'expected', v_oak),
    (v_user, 'oak farm gas co ltd', 'Oak Farm Gas Co Ltd', 'yoy', DATE '2026-08-01', 'action_required', v_oak_ltd),
    (v_user, 'oak farm gas co ltd', 'Oak Farm Gas Co Ltd', 'mom', DATE '2026-07-01', 'reviewed', v_oak_ltd);

  -- ----- Resolver ---------------------------------------------------------------------------
  v_result := public.resolve_receipt_vendor('  oak   FARM gas co ');
  ASSERT (v_result->>'vendor_id')::uuid = v_oak AND v_result->>'canonical_name' = 'Oak Farm Gas Co' AND NOT (v_result->>'created')::boolean, format('resolves by key, whatever the case and spacing: %s', v_result);
  v_result := public.resolve_receipt_vendor('ofg');
  ASSERT (v_result->>'vendor_id')::uuid = v_oak_ltd, 'resolves by a spelling the vendor answers to';
  ASSERT public.resolve_receipt_vendor('Nobody Ltd') IS NULL, 'an unknown name resolves to nothing';
  ASSERT (SELECT count(*) FROM public.receipt_vendors WHERE vendor_key = 'nobody ltd') = 0, 'and nothing is created unless asked';
  ASSERT public.resolve_receipt_vendor('   ') IS NULL AND public.resolve_receipt_vendor(NULL) IS NULL, 'a blank name resolves to nothing';
  v_result := public.resolve_receipt_vendor('  New   Supplier ', NULL, true, 'manual');
  ASSERT (v_result->>'created')::boolean AND v_result->>'canonical_name' = 'New Supplier' AND v_result->>'status' = 'unconfirmed', format('creates when asked: %s', v_result);
  ASSERT (SELECT origin FROM public.receipt_vendors WHERE vendor_key = 'new supplier') = 'manual', 'and records where the vendor came from';
  v_result := public.resolve_receipt_vendor('NEW SUPPLIER', NULL, true, 'ai');
  ASSERT NOT (v_result->>'created')::boolean, 'a second spelling of the same key does not create a second vendor';
  ASSERT (SELECT count(*) FROM public.receipt_vendors WHERE vendor_key = 'new supplier') = 1, 'one vendor per key';

  -- The view: text-only payments report under the vendor with that key.
  ASSERT (SELECT vendor_id = v_oak_ltd AND vendor_label = 'Oak Farm Gas Co Ltd' FROM public.receipt_transaction_vendors WHERE transaction_id = v_tx_text), 'a payment named in text reports under the vendor with that key';

  -- ----- Merge refusals ---------------------------------------------------------------------
  ASSERT public.merge_receipt_vendor(v_oak, v_oak, v_user)->>'outcome' = 'same_vendor', 'a vendor cannot be merged into itself';
  ASSERT public.merge_receipt_vendor(gen_random_uuid(), v_oak, v_user)->>'outcome' = 'not_found', 'an unknown vendor is refused';

  -- ----- Merge ------------------------------------------------------------------------------
  v_result := public.merge_receipt_vendor(v_oak_ltd, v_oak, v_user);
  ASSERT v_result->>'outcome' = 'merged', format('merge: %s', v_result);
  ASSERT (v_result->>'transactions')::int = 3 AND (v_result->>'rules')::int = 2 AND (v_result->>'suggestions')::int = 1, format('merge counts: %s', v_result);
  v_merge_op := (v_result->>'operation_id')::uuid;

  ASSERT (SELECT count(*) FROM public.receipt_transactions WHERE vendor_id = v_oak AND vendor_name = 'Oak Farm Gas Co') = 3, 'payments move to the survivor and take its name, including the one named in text';
  ASSERT (SELECT vendor_source FROM public.receipt_transactions WHERE id = v_tx_a) = 'manual', 'a merge does not change who set the vendor';
  ASSERT (SELECT vendor_id = v_veolia AND vendor_name = 'Veolia' FROM public.receipt_transactions WHERE id = v_tx_other), 'other vendors are untouched';
  ASSERT (SELECT count(*) FROM public.receipt_rules WHERE vendor_id = v_oak AND set_vendor_name = 'Oak Farm Gas Co') = 2, 'rules move, including the one with no vendor id';
  ASSERT (SELECT set_vendor_id = v_oak AND set_vendor_name = 'Oak Farm Gas Co' FROM public.receipt_rule_suggestions WHERE id = v_suggestion), 'rule suggestions move';
  ASSERT (SELECT status = 'merged' AND merged_into_vendor_id = v_oak FROM public.receipt_vendors WHERE id = v_oak_ltd), 'the old vendor is marked merged';
  ASSERT (SELECT count(*) FROM public.receipt_vendor_aliases WHERE vendor_id = v_oak AND alias_key IN ('oak farm gas co ltd', 'ofg')) = 2, 'the old name and its spellings now belong to the survivor';
  ASSERT (SELECT invoice_vendor_id FROM public.receipt_vendors WHERE id = v_oak) = v_invoice_vendor, 'the invoicing link is carried over';
  ASSERT (SELECT count(*) FROM public.receipt_transaction_logs WHERE action_type = 'vendor_merge' AND performed_by = v_user AND transaction_id IN (v_tx_a, v_tx_b, v_tx_text)) = 3, 'each moved payment has a history row naming who merged';

  -- The old name now leads to the survivor, by name and by id.
  ASSERT (public.resolve_receipt_vendor('Oak Farm Gas Co Ltd')->>'vendor_id')::uuid = v_oak, 'the old name resolves to the survivor';
  ASSERT (public.resolve_receipt_vendor(NULL, v_oak_ltd)->>'vendor_id')::uuid = v_oak, 'the old id resolves to the survivor';
  ASSERT public.receipt_vendor_survivor(v_oak_ltd) = v_oak, 'survivor lookup follows the merge';

  -- Watch entries combined; the review that needed action wins.
  ASSERT (SELECT count(*) FROM public.receipt_vendor_watchlist WHERE user_id = v_user) = 1, 'someone watching both keeps one entry';
  ASSERT (SELECT vendor_key = 'oak farm gas co' AND vendor_id = v_oak FROM public.receipt_vendor_watchlist WHERE user_id = v_other_user), 'someone watching only the old vendor now watches the survivor';
  ASSERT (SELECT status FROM public.receipt_vendor_reviews WHERE user_id = v_user AND vendor_key = 'oak farm gas co' AND comparison = 'yoy') = 'action_required', '"action required" on either vendor is kept';
  ASSERT (SELECT count(*) FROM public.receipt_vendor_reviews WHERE user_id = v_user AND vendor_key = 'oak farm gas co ltd') = 0, 'no review is left on the old key';
  ASSERT (SELECT vendor_id = v_oak FROM public.receipt_vendor_reviews WHERE user_id = v_user AND comparison = 'mom'), 'a review with no counterpart moves across';

  ASSERT public.merge_receipt_vendor(v_oak_ltd, v_veolia, v_user)->>'outcome' = 'already_merged', 'a merged vendor cannot be merged again';
  ASSERT public.merge_receipt_vendor(v_veolia, v_oak_ltd, v_user)->>'outcome' = 'target_merged', 'nothing can be merged into a merged vendor, so no cycle';

  -- Reports see one vendor.
  ASSERT (SELECT count(DISTINCT vendor_key) FROM public.get_receipt_vendor_monthly_totals(NULL) WHERE vendor_label LIKE 'Oak Farm%') = 1, 'monthly totals report one vendor';
  ASSERT (SELECT SUM(total_outgoing) FROM public.get_receipt_vendor_monthly_totals(NULL) WHERE vendor_key = 'oak farm gas co') = 175, 'with the combined total';
  ASSERT (SELECT count(*) FROM public.get_receipt_vendor_transactions('Oak Farm Gas Co Ltd')) = 3, 'asking for the old name returns the survivor''s payments';
  ASSERT (SELECT payment_count = 3 AND total_outgoing = 175 AND rule_count = 2 AND aliases @> ARRAY['OFG', 'Oak Farm Gas Co Ltd'] FROM public.get_receipt_vendor_directory() WHERE id = v_oak), 'the directory counts payments, rules and spellings on the survivor';
  ASSERT (SELECT payment_count = 0 FROM public.get_receipt_vendor_directory() WHERE id = v_oak_ltd), 'and none on the merged vendor';

  -- ----- Undo, with one payment changed since ------------------------------------------------
  UPDATE public.receipt_transactions SET vendor_id = v_tesco, vendor_name = 'Tesco' WHERE id = v_tx_b;

  v_result := public.undo_receipt_vendor_operation(v_merge_op, v_user);
  ASSERT v_result->>'outcome' = 'undone', format('undo merge: %s', v_result);
  ASSERT (v_result->>'transactions_restored')::int = 2 AND (v_result->>'transaction_conflicts')::int = 1, format('undo restores what still holds the applied value: %s', v_result);
  ASSERT (SELECT vendor_id = v_oak_ltd AND vendor_name = 'Oak Farm Gas Co Ltd' FROM public.receipt_transactions WHERE id = v_tx_a), 'a payment goes back to its old vendor';
  ASSERT (SELECT vendor_id IS NULL AND vendor_name = 'OAK FARM GAS CO LTD' FROM public.receipt_transactions WHERE id = v_tx_text), 'the text-only payment gets its exact old values back';
  ASSERT (SELECT vendor_id = v_tesco AND vendor_name = 'Tesco' FROM public.receipt_transactions WHERE id = v_tx_b), 'a payment changed since is left alone';
  ASSERT (SELECT vendor_id = v_oak_ltd AND set_vendor_name = 'Oak Farm Gas Co Ltd' FROM public.receipt_rules WHERE id = v_rule), 'the rule goes back';
  ASSERT (SELECT vendor_id IS NULL FROM public.receipt_rules WHERE id = v_keyless_rule), 'the rule with no vendor id goes back to having none';
  ASSERT (SELECT set_vendor_id = v_oak_ltd FROM public.receipt_rule_suggestions WHERE id = v_suggestion), 'the suggestion goes back';
  ASSERT (SELECT status = 'unconfirmed' AND merged_into_vendor_id IS NULL FROM public.receipt_vendors WHERE id = v_oak_ltd), 'the old vendor stands again';
  ASSERT (SELECT invoice_vendor_id IS NULL FROM public.receipt_vendors WHERE id = v_oak), 'the carried invoicing link is taken back off the survivor';
  ASSERT (SELECT count(*) FROM public.receipt_vendor_aliases WHERE vendor_id = v_oak_ltd AND alias_key IN ('oak farm gas co ltd', 'ofg')) = 2, 'spellings go back';
  ASSERT (SELECT count(*) FROM public.receipt_vendor_watchlist WHERE user_id = v_user) = 2, 'the folded watch entry returns';
  ASSERT (SELECT vendor_key = 'oak farm gas co ltd' AND vendor_id = v_oak_ltd FROM public.receipt_vendor_watchlist WHERE user_id = v_other_user), 'the moved watch entry goes back';
  ASSERT (SELECT status FROM public.receipt_vendor_reviews WHERE user_id = v_user AND vendor_key = 'oak farm gas co' AND comparison = 'yoy') = 'expected', 'the survivor''s review returns to what it was';
  ASSERT (SELECT status FROM public.receipt_vendor_reviews WHERE user_id = v_user AND vendor_key = 'oak farm gas co ltd' AND comparison = 'yoy') = 'action_required', 'the folded review returns';
  ASSERT (SELECT undone_at IS NOT NULL AND undone_by = v_user FROM public.receipt_vendor_operations WHERE id = v_merge_op), 'the operation is marked undone';

  -- Safe to repeat.
  v_second := public.undo_receipt_vendor_operation(v_merge_op, v_user);
  ASSERT v_second->>'outcome' = 'already_undone' AND (v_second->>'transactions_restored')::int = 2, format('a second undo changes nothing and reports the first result: %s', v_second);
  ASSERT (SELECT vendor_id = v_tesco FROM public.receipt_transactions WHERE id = v_tx_b), 'and still leaves the changed payment alone';
  ASSERT public.undo_receipt_vendor_operation(gen_random_uuid(), v_user)->>'outcome' = 'not_found', 'an unknown operation is refused';

  -- ----- Rename -----------------------------------------------------------------------------
  ASSERT public.rename_receipt_vendor(v_veolia, '   ', v_user)->>'outcome' = 'invalid_name', 'a blank name is refused';
  ASSERT public.rename_receipt_vendor(v_veolia, 'Veolia', v_user)->>'outcome' = 'unchanged', 'the same name is no change';
  v_result := public.rename_receipt_vendor(v_veolia, 'tesco', v_user);
  ASSERT v_result->>'outcome' = 'name_taken' AND (v_result->>'vendor_id')::uuid = v_tesco, format('another vendor''s name is refused, and that vendor is named: %s', v_result);
  v_result := public.rename_receipt_vendor(v_veolia, 'OFG', v_user);
  ASSERT v_result->>'outcome' = 'name_taken' AND (v_result->>'vendor_id')::uuid = v_oak_ltd, format('another vendor''s spelling is refused: %s', v_result);
  ASSERT (SELECT canonical_name FROM public.receipt_vendors WHERE id = v_veolia) = 'Veolia', 'a refused rename changes nothing';

  INSERT INTO public.receipt_rules (name, match_description, vendor_id, set_vendor_name) VALUES ('Veolia waste', 'veolia', v_veolia, 'Veolia');
  INSERT INTO public.receipt_vendor_watchlist (user_id, vendor_key, vendor_label, vendor_id) VALUES (v_user, 'veolia', 'Veolia', v_veolia);

  v_result := public.rename_receipt_vendor(v_veolia, '  Veolia   ES (UK) Ltd ', v_user);
  ASSERT v_result->>'outcome' = 'renamed' AND (v_result->>'transactions')::int = 1 AND (v_result->>'rules')::int = 1, format('rename: %s', v_result);
  v_rename_op := (v_result->>'operation_id')::uuid;
  ASSERT (SELECT canonical_name = 'Veolia ES (UK) Ltd' AND vendor_key = 'veolia es (uk) ltd' FROM public.receipt_vendors WHERE id = v_veolia), 'the vendor takes the tidied name and its key';
  ASSERT (SELECT vendor_name FROM public.receipt_transactions WHERE id = v_tx_other) = 'Veolia ES (UK) Ltd', 'its payments take the new name';
  ASSERT (SELECT set_vendor_name FROM public.receipt_rules WHERE vendor_id = v_veolia) = 'Veolia ES (UK) Ltd', 'its rules take the new name';
  ASSERT (public.resolve_receipt_vendor('veolia')->>'vendor_id')::uuid = v_veolia, 'the old name still resolves to it';
  ASSERT (SELECT vendor_key = 'veolia es (uk) ltd' AND vendor_label = 'Veolia ES (UK) Ltd' FROM public.receipt_vendor_watchlist WHERE user_id = v_user AND vendor_id = v_veolia), 'watch entries follow the rename';
  ASSERT (SELECT count(*) FROM public.receipt_transaction_logs WHERE action_type = 'vendor_rename' AND transaction_id = v_tx_other) = 1, 'the payment has a history row for the rename';

  -- Undo is blocked while a later change stands, and nothing moves.
  v_result := public.rename_receipt_vendor(v_veolia, 'Veolia UK', v_user);
  ASSERT v_result->>'outcome' = 'renamed', 'a second rename';
  v_second := public.undo_receipt_vendor_operation(v_rename_op, v_user);
  ASSERT v_second->>'outcome' = 'blocked' AND v_second->>'reason' = 'changed_since', format('the first rename cannot be undone under the second: %s', v_second);
  ASSERT (SELECT undone_at IS NULL FROM public.receipt_vendor_operations WHERE id = v_rename_op), 'a blocked undo is not marked done, so it can be tried again';
  ASSERT (SELECT canonical_name FROM public.receipt_vendors WHERE id = v_veolia) = 'Veolia UK', 'a blocked undo changes nothing';

  -- Undo the second, then the first.
  v_second := public.undo_receipt_vendor_operation((v_result->>'operation_id')::uuid, v_user);
  ASSERT v_second->>'outcome' = 'undone', format('undo second rename: %s', v_second);
  v_second := public.undo_receipt_vendor_operation(v_rename_op, v_user);
  ASSERT v_second->>'outcome' = 'undone' AND (v_second->>'transactions_restored')::int = 1 AND (v_second->>'transaction_conflicts')::int = 0, format('undo first rename: %s', v_second);
  ASSERT (SELECT canonical_name = 'Veolia' AND vendor_key = 'veolia' FROM public.receipt_vendors WHERE id = v_veolia), 'the vendor has its old name and key back';
  ASSERT (SELECT vendor_name FROM public.receipt_transactions WHERE id = v_tx_other) = 'Veolia', 'its payment has the old name back';
  ASSERT (SELECT set_vendor_name FROM public.receipt_rules WHERE vendor_id = v_veolia) = 'Veolia', 'its rule has the old name back';
  ASSERT (SELECT vendor_key = 'veolia' FROM public.receipt_vendor_watchlist WHERE user_id = v_user AND vendor_id = v_veolia), 'its watch entry has the old key back';

  -- ----- A merge under a later merge is blocked ---------------------------------------------
  v_result := public.merge_receipt_vendor(v_oak_ltd, v_oak, v_user);
  ASSERT v_result->>'outcome' = 'merged', 'merge again';
  v_merge_op := (v_result->>'operation_id')::uuid;
  v_second := public.merge_receipt_vendor(v_oak, v_veolia, v_user);
  ASSERT v_second->>'outcome' = 'merged', 'then merge the survivor on';
  ASSERT (SELECT merged_into_vendor_id FROM public.receipt_vendors WHERE id = v_oak_ltd) = v_veolia, 'the earlier merge now points straight at the new survivor';
  ASSERT public.receipt_vendor_survivor(v_oak_ltd) = v_veolia, 'so the old id resolves in one step';
  ASSERT public.undo_receipt_vendor_operation(v_merge_op, v_user)->>'outcome' = 'blocked', 'the earlier merge cannot be undone under the later one';
  ASSERT public.undo_receipt_vendor_operation((v_second->>'operation_id')::uuid, v_user)->>'outcome' = 'undone', 'undo the later one';
  ASSERT (SELECT merged_into_vendor_id FROM public.receipt_vendors WHERE id = v_oak_ltd) = v_oak, 'and the earlier merge points at its own survivor again';
  ASSERT public.undo_receipt_vendor_operation(v_merge_op, v_user)->>'outcome' = 'undone', 'then the earlier one can be undone';
END $$;

-- Grants: service role only, and nothing here needs to run as the owner.
DO $$
DECLARE
  v_fn text;
  v_oid oid;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.receipt_vendor_survivor(uuid)',
    'public.resolve_receipt_vendor(text, uuid, boolean, text, text)',
    'public.merge_receipt_vendor(uuid, uuid, uuid)',
    'public.rename_receipt_vendor(uuid, text, uuid)',
    'public.undo_receipt_vendor_operation(uuid, uuid)',
    'public.get_receipt_vendor_directory()',
    'public.get_receipt_vendor_monthly_totals(integer)',
    'public.get_receipt_vendor_transactions(text)',
    'public.get_receipt_vendor_trends(integer)'
  ] LOOP
    v_oid := v_fn::regprocedure::oid;
    ASSERT NOT has_function_privilege('anon', v_oid, 'EXECUTE'), format('%s must not be callable by anon', v_fn);
    ASSERT NOT has_function_privilege('authenticated', v_oid, 'EXECUTE'), format('%s must not be callable by authenticated', v_fn);
    ASSERT has_function_privilege('service_role', v_oid, 'EXECUTE'), format('%s must be callable by service_role', v_fn);
    ASSERT (SELECT proconfig IS NOT NULL FROM pg_proc WHERE oid = v_oid), format('%s must pin its search_path', v_fn);
  END LOOP;

  ASSERT NOT has_table_privilege('anon', 'public.receipt_vendor_operations', 'SELECT'), 'the operation record is not readable by anon';
  ASSERT NOT has_table_privilege('authenticated', 'public.receipt_vendor_operations', 'SELECT'), 'nor by authenticated';
  ASSERT NOT has_table_privilege('anon', 'public.receipt_transaction_vendors', 'SELECT'), 'the vendor view is not readable by anon';
  ASSERT NOT has_table_privilege('authenticated', 'public.receipt_transaction_vendors', 'SELECT'), 'nor by authenticated';
  ASSERT has_table_privilege('service_role', 'public.receipt_transaction_vendors', 'SELECT'), 'the service role can read the vendor view';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.receipt_vendor_operations'::regclass), 'row security is on for the operation record';
END $$;

ROLLBACK;

\echo 'RECEIPTS RELEASE 3 VENDOR TESTS PASSED'
