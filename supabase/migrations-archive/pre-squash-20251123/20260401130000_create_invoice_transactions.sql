-- Function to handle atomic creation of invoices with line items
CREATE OR REPLACE FUNCTION create_invoice_transaction(
  p_invoice_data JSONB,
  p_line_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_invoice_id UUID;
  v_invoice_record JSONB;
BEGIN
  -- 1. Insert Invoice
  INSERT INTO invoices (
    invoice_number,
    vendor_id,
    invoice_date,
    due_date,
    reference,
    invoice_discount_percentage,
    subtotal_amount,
    discount_amount,
    vat_amount,
    total_amount,
    notes,
    internal_notes,
    status
  ) VALUES (
    p_invoice_data->>'invoice_number',
    (p_invoice_data->>'vendor_id')::UUID,
    (p_invoice_data->>'invoice_date')::DATE,
    (p_invoice_data->>'due_date')::DATE,
    p_invoice_data->>'reference',
    (p_invoice_data->>'invoice_discount_percentage')::DECIMAL,
    (p_invoice_data->>'subtotal_amount')::DECIMAL,
    (p_invoice_data->>'discount_amount')::DECIMAL,
    (p_invoice_data->>'vat_amount')::DECIMAL,
    (p_invoice_data->>'total_amount')::DECIMAL,
    p_invoice_data->>'notes',
    p_invoice_data->>'internal_notes',
    (p_invoice_data->>'status') -- status is text/varchar, not an enum
  )
  RETURNING id INTO v_invoice_id;

  -- 2. Insert Line Items
  IF jsonb_array_length(p_line_items) > 0 THEN
    INSERT INTO invoice_line_items (
      invoice_id,
      catalog_item_id,
      description,
      quantity,
      unit_price,
      discount_percentage,
      vat_rate
    )
    SELECT
      v_invoice_id,
      (item->>'catalog_item_id')::UUID,
      item->>'description',
      (item->>'quantity')::DECIMAL,
      (item->>'unit_price')::DECIMAL,
      (item->>'discount_percentage')::DECIMAL,
      (item->>'vat_rate')::DECIMAL
    FROM jsonb_array_elements(p_line_items) AS item;
  END IF;

  -- 3. Return the created invoice
  SELECT to_jsonb(i) INTO v_invoice_record
  FROM invoices i
  WHERE i.id = v_invoice_id;

  RETURN v_invoice_record;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

-- Function to record payment and update invoice status
CREATE OR REPLACE FUNCTION record_invoice_payment_transaction(
  p_payment_data JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_payment_id UUID;
  v_invoice_id UUID;
  v_amount DECIMAL;
  v_current_paid DECIMAL;
  v_total DECIMAL;
  v_new_paid DECIMAL;
  v_new_status text; -- Changed from invoice_status to text
  v_payment_record JSONB;
BEGIN
  v_invoice_id := (p_payment_data->>'invoice_id')::UUID;
  v_amount := (p_payment_data->>'amount')::DECIMAL;

  -- 1. Get current invoice details
  SELECT paid_amount, total_amount, status 
  INTO v_current_paid, v_total, v_new_status
  FROM invoices 
  WHERE id = v_invoice_id
  FOR UPDATE; -- Lock the row

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_amount > (v_total - v_current_paid) THEN
    RAISE EXCEPTION 'Payment amount exceeds outstanding balance';
  END IF;

  -- 2. Insert Payment
  INSERT INTO invoice_payments (
    invoice_id,
    payment_date,
    amount,
    payment_method,
    reference,
    notes
  ) VALUES (
    v_invoice_id,
    (p_payment_data->>'payment_date')::DATE,
    v_amount,
    p_payment_data->>'payment_method',
    p_payment_data->>'reference',
    p_payment_data->>'notes'
  )
  RETURNING id INTO v_payment_id;

  -- 3. Update Invoice Status
  v_new_paid := v_current_paid + v_amount;
  
  IF v_new_paid >= v_total THEN
    v_new_status := 'paid';
  ELSIF v_new_paid > 0 AND v_new_status NOT IN ('void', 'written_off') THEN
    v_new_status := 'partially_paid';
  END IF;

  UPDATE invoices
  SET 
    paid_amount = v_new_paid,
    status = v_new_status,
    updated_at = NOW()
  WHERE id = v_invoice_id;

  -- 4. Return Payment Record
  SELECT to_jsonb(ip) INTO v_payment_record
  FROM invoice_payments ip
  WHERE ip.id = v_payment_id;

  RETURN v_payment_record;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;