-- Function to handle atomic creation of receipt batch and transactions
CREATE OR REPLACE FUNCTION import_receipt_batch_transaction(
  p_batch_data JSONB,
  p_transactions JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_batch_id UUID;
  v_batch_record JSONB;
BEGIN
  -- 1. Insert Receipt Batch
  INSERT INTO receipt_batches (
    original_filename,
    source_hash,
    row_count,
    notes,
    uploaded_by
  ) VALUES (
    p_batch_data->>'original_filename',
    p_batch_data->>'source_hash',
    (p_batch_data->>'row_count')::INTEGER,
    p_batch_data->>'notes',
    (p_batch_data->>'uploaded_by')::UUID
  )
  RETURNING id INTO v_batch_id;

  -- 2. Insert Transactions
  IF jsonb_array_length(p_transactions) > 0 THEN
    INSERT INTO receipt_transactions (
      batch_id,
      transaction_date,
      details,
      transaction_type,
      amount_in,
      amount_out,
      balance,
      dedupe_hash,
      status,
      receipt_required,
      vendor_name,
      vendor_source,
      expense_category,
      expense_category_source
    )
    SELECT
      v_batch_id,
      (item->>'transaction_date')::DATE,
      item->>'details',
      item->>'transaction_type',
      (item->>'amount_in')::DECIMAL,
      (item->>'amount_out')::DECIMAL,
      (item->>'balance')::DECIMAL,
      item->>'dedupe_hash',
      (item->>'status')::receipt_transaction_status,
      COALESCE((item->>'receipt_required')::BOOLEAN, true),
      item->>'vendor_name',
      (item->>'vendor_source')::receipt_classification_source,
      (item->>'expense_category')::receipt_expense_category,
      (item->>'expense_category_source')::receipt_classification_source
    FROM jsonb_array_elements(p_transactions) AS item;
  END IF;

  -- 3. Return the created batch record
  SELECT to_jsonb(rb) INTO v_batch_record
  FROM receipt_batches rb
  WHERE rb.id = v_batch_id;

  RETURN v_batch_record;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;
