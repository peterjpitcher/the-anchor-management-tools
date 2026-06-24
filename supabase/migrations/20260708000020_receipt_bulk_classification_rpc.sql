BEGIN;

CREATE OR REPLACE FUNCTION public.apply_receipt_group_classification_atomic(
  p_details text,
  p_statuses public.receipt_transaction_status[],
  p_vendor_provided boolean,
  p_vendor_id uuid,
  p_vendor_name text,
  p_expense_provided boolean,
  p_expense_category text,
  p_user_id uuid,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_now timestamptz := now();
  v_updated integer := 0;
  v_skipped_incoming integer := 0;
  v_is_incoming_only boolean;
  v_should_update boolean;
  v_new_vendor_id uuid;
  v_new_vendor_name text;
  v_new_expense_category text;
BEGIN
  IF NOT p_vendor_provided AND NOT p_expense_provided THEN
    RAISE EXCEPTION 'Nothing to update';
  END IF;

  FOR v_row IN
    SELECT
      id,
      status,
      amount_in,
      amount_out,
      vendor_id,
      vendor_name,
      vendor_source,
      vendor_rule_id,
      vendor_updated_at,
      expense_category
    FROM public.receipt_transactions
    WHERE details = p_details
      AND status = ANY(p_statuses)
    FOR UPDATE
  LOOP
    v_is_incoming_only := COALESCE(v_row.amount_in, 0) > 0 AND NOT (COALESCE(v_row.amount_out, 0) > 0);
    IF p_expense_provided AND v_is_incoming_only THEN
      v_skipped_incoming := v_skipped_incoming + 1;
    END IF;

    v_should_update := p_vendor_provided OR (p_expense_provided AND NOT v_is_incoming_only);
    IF NOT v_should_update THEN
      CONTINUE;
    END IF;

    v_new_vendor_id := CASE WHEN p_vendor_provided THEN p_vendor_id ELSE v_row.vendor_id END;
    v_new_vendor_name := CASE WHEN p_vendor_provided THEN p_vendor_name ELSE v_row.vendor_name END;
    v_new_expense_category := CASE WHEN p_expense_provided AND NOT v_is_incoming_only THEN p_expense_category ELSE v_row.expense_category END;

    UPDATE public.receipt_transactions
    SET updated_at = v_now,
        vendor_id = CASE WHEN p_vendor_provided THEN p_vendor_id ELSE vendor_id END,
        vendor_name = CASE WHEN p_vendor_provided THEN p_vendor_name ELSE vendor_name END,
        vendor_source = CASE WHEN p_vendor_provided THEN CASE WHEN p_vendor_name IS NULL THEN NULL ELSE 'manual' END ELSE vendor_source END,
        vendor_rule_id = CASE WHEN p_vendor_provided THEN NULL ELSE vendor_rule_id END,
        vendor_updated_at = CASE WHEN p_vendor_provided THEN v_now ELSE vendor_updated_at END,
        expense_category = CASE WHEN p_expense_provided AND NOT v_is_incoming_only THEN p_expense_category ELSE expense_category END,
        expense_category_source = CASE WHEN p_expense_provided AND NOT v_is_incoming_only THEN CASE WHEN p_expense_category IS NULL THEN NULL ELSE 'manual' END ELSE expense_category_source END,
        expense_rule_id = CASE WHEN p_expense_provided AND NOT v_is_incoming_only THEN NULL ELSE expense_rule_id END,
        expense_updated_at = CASE WHEN p_expense_provided AND NOT v_is_incoming_only THEN v_now ELSE expense_updated_at END
    WHERE id = v_row.id;

    INSERT INTO public.receipt_transaction_logs (
      transaction_id,
      previous_status,
      new_status,
      action_type,
      note,
      performed_by,
      rule_id,
      performed_at
    )
    VALUES (
      v_row.id,
      v_row.status,
      v_row.status,
      'bulk_classification',
      p_note,
      p_user_id,
      NULL,
      v_now
    );

    INSERT INTO public.receipt_classification_signals (
      transaction_id,
      source,
      signal_type,
      prior_vendor_id,
      new_vendor_id,
      prior_vendor_name,
      new_vendor_name,
      prior_expense_category,
      new_expense_category,
      prior_status,
      new_status,
      rule_id,
      ai_confidence,
      performed_by,
      performed_at,
      payload
    )
    VALUES (
      v_row.id,
      'human',
      'bulk_classification',
      v_row.vendor_id,
      v_new_vendor_id,
      v_row.vendor_name,
      v_new_vendor_name,
      v_row.expense_category,
      v_new_expense_category,
      v_row.status,
      v_row.status,
      NULL,
      NULL,
      p_user_id,
      v_now,
      jsonb_build_object('note', p_note)
    );

    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'updated', v_updated,
    'skippedIncomingCount', v_skipped_incoming
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_receipt_group_classification_atomic(text, public.receipt_transaction_status[], boolean, uuid, text, boolean, text, uuid, text) TO service_role;

COMMIT;
