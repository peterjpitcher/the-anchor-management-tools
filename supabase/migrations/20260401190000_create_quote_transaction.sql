-- Function to handle atomic creation of quote with line items
CREATE OR REPLACE FUNCTION create_quote_transaction(
  p_quote_data JSONB,
  p_line_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_quote_id UUID;
  v_quote_record JSONB;
BEGIN
  -- 1. Insert Quote
  INSERT INTO quotes (
    quote_number,
    vendor_id,
    quote_date,
    valid_until,
    reference,
    quote_discount_percentage,
    subtotal_amount,
    discount_amount,
    vat_amount,
    total_amount,
    notes,
    internal_notes,
    status
  ) VALUES (
    p_quote_data->>'quote_number',
    (p_quote_data->>'vendor_id')::UUID,
    (p_quote_data->>'quote_date')::DATE,
    (p_quote_data->>'valid_until')::DATE,
    p_quote_data->>'reference',
    (p_quote_data->>'quote_discount_percentage')::DECIMAL,
    (p_quote_data->>'subtotal_amount')::DECIMAL,
    (p_quote_data->>'discount_amount')::DECIMAL,
    (p_quote_data->>'vat_amount')::DECIMAL,
    (p_quote_data->>'total_amount')::DECIMAL,
    p_quote_data->>'notes',
    p_quote_data->>'internal_notes',
    (p_quote_data->>'status')::quote_status
  )
  RETURNING id INTO v_quote_id;

  -- 2. Insert Line Items
  IF jsonb_array_length(p_line_items) > 0 THEN
    INSERT INTO quote_line_items (
      quote_id,
      catalog_item_id,
      description,
      quantity,
      unit_price,
      discount_percentage,
      vat_rate
    )
    SELECT
      v_quote_id,
      (item->>'catalog_item_id')::UUID,
      item->>'description',
      (item->>'quantity')::DECIMAL,
      (item->>'unit_price')::DECIMAL,
      (item->>'discount_percentage')::DECIMAL,
      (item->>'vat_rate')::DECIMAL
    FROM jsonb_array_elements(p_line_items) AS item;
  END IF;

  -- 3. Return the created quote record
  SELECT to_jsonb(q) INTO v_quote_record
  FROM quotes q
  WHERE q.id = v_quote_id;

  RETURN v_quote_record;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;
