BEGIN;

DO $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_vendor_id UUID;
  v_rule_id UUID;
  v_transaction RECORD;
BEGIN
  INSERT INTO public.receipt_vendors (
    canonical_name,
    vendor_key,
    status,
    created_at,
    updated_at
  )
  VALUES (
    'Jacob Williams',
    public.normalize_receipt_vendor_key('Jacob Williams'),
    'confirmed',
    v_now,
    v_now
  )
  ON CONFLICT (vendor_key) DO UPDATE
  SET
    canonical_name = CASE
      WHEN public.receipt_vendors.status = 'unconfirmed' THEN EXCLUDED.canonical_name
      ELSE public.receipt_vendors.canonical_name
    END,
    status = CASE
      WHEN public.receipt_vendors.status = 'unconfirmed' THEN 'confirmed'
      ELSE public.receipt_vendors.status
    END,
    updated_at = v_now
  RETURNING id INTO v_vendor_id;

  INSERT INTO public.receipt_vendor_aliases (
    vendor_id,
    alias,
    alias_key,
    source,
    confidence
  )
  VALUES (
    v_vendor_id,
    'Jacob Williams',
    public.normalize_receipt_vendor_key('Jacob Williams'),
    'system',
    100
  )
  ON CONFLICT (alias_key) DO NOTHING;

  SELECT id INTO v_rule_id
  FROM public.receipt_rules
  WHERE LOWER(name) = LOWER('Jacob Williams payroll')
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_rule_id IS NULL THEN
    INSERT INTO public.receipt_rules (
      name,
      description,
      match_description,
      match_transaction_type,
      match_direction,
      auto_status,
      is_active,
      set_vendor_name,
      vendor_id,
      set_expense_category,
      priority,
      kind,
      reviewed_at,
      created_at,
      updated_at
    )
    VALUES (
      'Jacob Williams payroll',
      'Outgoing staff wage payments for Jacob Williams.',
      'Jacob William The Anchor,Jacob Williams The Anchor',
      NULL,
      'out',
      'no_receipt_required',
      TRUE,
      'Jacob Williams',
      v_vendor_id,
      'Total Staff',
      1000,
      'payroll',
      v_now,
      v_now,
      v_now
    )
    RETURNING id INTO v_rule_id;
  ELSE
    UPDATE public.receipt_rules
    SET
      description = 'Outgoing staff wage payments for Jacob Williams.',
      match_description = 'Jacob William The Anchor,Jacob Williams The Anchor',
      match_transaction_type = NULL,
      match_direction = 'out',
      match_min_amount = NULL,
      match_max_amount = NULL,
      auto_status = 'no_receipt_required',
      is_active = TRUE,
      set_vendor_name = 'Jacob Williams',
      vendor_id = v_vendor_id,
      set_expense_category = 'Total Staff',
      priority = 1000,
      kind = 'payroll',
      reviewed_at = COALESCE(reviewed_at, v_now),
      deactivated_at = NULL,
      deactivated_by = NULL,
      updated_at = v_now
    WHERE id = v_rule_id;
  END IF;

  FOR v_transaction IN
    SELECT
      id,
      status,
      vendor_id,
      vendor_name,
      expense_category
    FROM public.receipt_transactions
    WHERE status = 'pending'
      AND COALESCE(amount_out, 0) > 0
      AND LOWER(BTRIM(details)) IN (
        LOWER('Jacob William The Anchor'),
        LOWER('Jacob Williams The Anchor')
      )
      AND COALESCE(vendor_source, '') NOT IN ('manual', 'import')
      AND COALESCE(expense_category_source, '') <> 'manual'
    FOR UPDATE
  LOOP
    UPDATE public.receipt_transactions
    SET
      status = 'no_receipt_required',
      receipt_required = FALSE,
      marked_by = NULL,
      marked_by_email = NULL,
      marked_by_name = NULL,
      marked_at = v_now,
      marked_method = 'rule',
      rule_applied_id = v_rule_id,
      vendor_name = 'Jacob Williams',
      vendor_id = v_vendor_id,
      vendor_source = 'rule',
      vendor_rule_id = v_rule_id,
      vendor_updated_at = v_now,
      expense_category = 'Total Staff',
      expense_category_source = 'rule',
      expense_rule_id = v_rule_id,
      expense_updated_at = v_now,
      updated_at = v_now
    WHERE id = v_transaction.id;

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
    VALUES
      (
        v_transaction.id,
        v_transaction.status,
        'no_receipt_required',
        'rule_auto_mark',
        'Auto-marked by rule: Jacob Williams payroll',
        NULL,
        v_rule_id,
        v_now
      ),
      (
        v_transaction.id,
        v_transaction.status,
        'no_receipt_required',
        'rule_classification',
        'Classification updated by rule Jacob Williams payroll: Vendor → Jacob Williams | Expense → Total Staff',
        NULL,
        v_rule_id,
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
      payload,
      performed_by,
      performed_at
    )
    VALUES
      (
        v_transaction.id,
        'rule',
        'rule_auto_mark',
        v_transaction.vendor_id,
        v_transaction.vendor_id,
        v_transaction.vendor_name,
        v_transaction.vendor_name,
        v_transaction.expense_category,
        v_transaction.expense_category,
        v_transaction.status,
        'no_receipt_required',
        v_rule_id,
        NULL,
        jsonb_build_object('rule_name', 'Jacob Williams payroll'),
        NULL,
        v_now
      ),
      (
        v_transaction.id,
        'rule',
        'rule_classification',
        v_transaction.vendor_id,
        v_vendor_id,
        v_transaction.vendor_name,
        'Jacob Williams',
        v_transaction.expense_category,
        'Total Staff',
        v_transaction.status,
        'no_receipt_required',
        v_rule_id,
        NULL,
        jsonb_build_object(
          'note',
          'Vendor → Jacob Williams | Expense → Total Staff',
          'rule_name',
          'Jacob Williams payroll'
        ),
        NULL,
        v_now
      );
  END LOOP;
END;
$$;

COMMIT;
