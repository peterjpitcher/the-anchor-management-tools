BEGIN;

CREATE OR REPLACE FUNCTION public.convert_quote_to_invoice_atomic(
  p_quote_id uuid,
  p_invoice_date date,
  p_due_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote public.quotes;
  v_line_count integer;
  v_sequence integer;
  v_number integer;
  v_remainder integer;
  v_encoded text := '';
  v_invoice_number text;
  v_invoice public.invoices;
BEGIN
  SELECT *
  INTO v_quote
  FROM public.quotes
  WHERE id = p_quote_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote not found';
  END IF;

  IF v_quote.status <> 'accepted' THEN
    RAISE EXCEPTION 'Only accepted quotes can be converted to invoices';
  END IF;

  IF v_quote.converted_to_invoice_id IS NOT NULL THEN
    RAISE EXCEPTION 'This quote has already been converted to an invoice';
  END IF;

  SELECT count(*)
  INTO v_line_count
  FROM public.quote_line_items
  WHERE quote_id = p_quote_id;

  IF v_line_count = 0 THEN
    RAISE EXCEPTION 'Quote has no line items and cannot be converted';
  END IF;

  SELECT next_sequence
  INTO v_sequence
  FROM public.get_and_increment_invoice_series('INV')
  LIMIT 1;

  v_number := v_sequence + 5000;

  IF v_number = 0 THEN
    v_encoded := '0';
  END IF;

  WHILE v_number > 0 LOOP
    v_remainder := v_number % 36;
    v_encoded := substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', v_remainder + 1, 1) || v_encoded;
    v_number := floor(v_number / 36);
  END LOOP;

  v_invoice_number := 'INV-' || lpad(v_encoded, 5, '0');

  INSERT INTO public.invoices (
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
  )
  VALUES (
    v_invoice_number,
    v_quote.vendor_id,
    p_invoice_date,
    p_due_date,
    v_quote.reference,
    v_quote.quote_discount_percentage,
    v_quote.subtotal_amount,
    v_quote.discount_amount,
    v_quote.vat_amount,
    v_quote.total_amount,
    v_quote.notes,
    v_quote.internal_notes,
    'draft'
  )
  RETURNING * INTO v_invoice;

  INSERT INTO public.invoice_line_items (
    invoice_id,
    catalog_item_id,
    description,
    quantity,
    unit_price,
    discount_percentage,
    vat_rate
  )
  SELECT
    v_invoice.id,
    catalog_item_id,
    description,
    quantity,
    unit_price,
    discount_percentage,
    vat_rate
  FROM public.quote_line_items
  WHERE quote_id = p_quote_id;

  UPDATE public.quotes
  SET converted_to_invoice_id = v_invoice.id,
      updated_at = now()
  WHERE id = p_quote_id
    AND status = 'accepted'
    AND converted_to_invoice_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote conversion could not be finalized';
  END IF;

  RETURN jsonb_build_object(
    'invoice', to_jsonb(v_invoice),
    'quote_number', v_quote.quote_number
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.convert_quote_to_invoice_atomic(uuid, date, date) TO authenticated, service_role;

COMMIT;
