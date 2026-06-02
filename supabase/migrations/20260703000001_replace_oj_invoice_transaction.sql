CREATE OR REPLACE FUNCTION public.replace_oj_invoice_transaction(
  p_old_invoice_id uuid,
  p_replacement_invoice_data jsonb,
  p_line_items jsonb,
  p_entry_ids uuid[] DEFAULT '{}',
  p_recurring_instance_ids uuid[] DEFAULT '{}',
  p_void_reason text DEFAULT NULL,
  p_changed_entry_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  old_invoice public.invoices%ROWTYPE;
  replacement_invoice public.invoices%ROWTYPE;
  replacement_invoice_id uuid;
  now_ts timestamptz := timezone('utc', now());
  void_note text;
BEGIN
  IF p_old_invoice_id IS NULL THEN
    RAISE EXCEPTION 'old invoice id is required';
  END IF;

  IF p_replacement_invoice_data IS NULL OR jsonb_typeof(p_replacement_invoice_data) <> 'object' THEN
    RAISE EXCEPTION 'replacement invoice data is required';
  END IF;

  IF p_line_items IS NULL OR jsonb_typeof(p_line_items) <> 'array' OR jsonb_array_length(p_line_items) = 0 THEN
    RAISE EXCEPTION 'line_items must be a non-empty array';
  END IF;

  SELECT *
    INTO old_invoice
    FROM public.invoices
   WHERE id = p_old_invoice_id
     AND deleted_at IS NULL
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % not found', p_old_invoice_id;
  END IF;

  IF old_invoice.status IN ('paid', 'partially_paid', 'void', 'written_off') THEN
    RAISE EXCEPTION 'Only unpaid active invoices can be replaced';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.invoice_payments
     WHERE invoice_id = p_old_invoice_id
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Cannot replace an invoice after a payment has been recorded';
  END IF;

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
    status,
    created_at,
    updated_at
  ) VALUES (
    p_replacement_invoice_data->>'invoice_number',
    COALESCE((p_replacement_invoice_data->>'vendor_id')::uuid, old_invoice.vendor_id),
    COALESCE((p_replacement_invoice_data->>'invoice_date')::date, old_invoice.invoice_date),
    COALESCE((p_replacement_invoice_data->>'due_date')::date, old_invoice.due_date),
    NULLIF(p_replacement_invoice_data->>'reference', ''),
    COALESCE((p_replacement_invoice_data->>'invoice_discount_percentage')::numeric, old_invoice.invoice_discount_percentage),
    COALESCE((p_replacement_invoice_data->>'subtotal_amount')::numeric, 0),
    COALESCE((p_replacement_invoice_data->>'discount_amount')::numeric, 0),
    COALESCE((p_replacement_invoice_data->>'vat_amount')::numeric, 0),
    COALESCE((p_replacement_invoice_data->>'total_amount')::numeric, 0),
    p_replacement_invoice_data->>'notes',
    p_replacement_invoice_data->>'internal_notes',
    'draft',
    now_ts,
    now_ts
  )
  RETURNING * INTO replacement_invoice;

  replacement_invoice_id := replacement_invoice.id;

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
    replacement_invoice_id,
    NULLIF(item->>'catalog_item_id', '')::uuid,
    COALESCE(item->>'description', ''),
    COALESCE((item->>'quantity')::numeric, 0),
    COALESCE((item->>'unit_price')::numeric, 0),
    COALESCE((item->>'discount_percentage')::numeric, 0),
    COALESCE((item->>'vat_rate')::numeric, 0)
  FROM jsonb_array_elements(p_line_items) AS item;

  UPDATE public.oj_entries
     SET invoice_id = replacement_invoice_id,
         billing_run_id = NULL,
         status = 'billing_pending',
         billed_at = NULL,
         paid_at = NULL,
         updated_at = now_ts
   WHERE invoice_id = p_old_invoice_id
     AND id = ANY(COALESCE(p_entry_ids, '{}'));

  UPDATE public.oj_entries
     SET invoice_id = NULL,
         billing_run_id = NULL,
         status = 'unbilled',
         billed_at = NULL,
         paid_at = NULL,
         updated_at = now_ts
   WHERE invoice_id = p_old_invoice_id
     AND NOT (id = ANY(COALESCE(p_entry_ids, '{}')));

  UPDATE public.oj_recurring_charge_instances
     SET invoice_id = replacement_invoice_id,
         billing_run_id = NULL,
         status = 'billing_pending',
         billed_at = NULL,
         paid_at = NULL,
         updated_at = now_ts
   WHERE invoice_id = p_old_invoice_id
     AND id = ANY(COALESCE(p_recurring_instance_ids, '{}'));

  UPDATE public.oj_recurring_charge_instances
     SET invoice_id = NULL,
         billing_run_id = NULL,
         status = 'unbilled',
         billed_at = NULL,
         paid_at = NULL,
         updated_at = now_ts
   WHERE invoice_id = p_old_invoice_id
     AND NOT (id = ANY(COALESCE(p_recurring_instance_ids, '{}')));

  void_note := format(
    '[VOIDED %s] Reason: %s Replacement invoice: %s%s',
    now_ts,
    COALESCE(NULLIF(trim(p_void_reason), ''), 'OJ Projects invoice revised and replaced'),
    replacement_invoice.invoice_number,
    CASE WHEN p_changed_entry_id IS NULL THEN '' ELSE format(' Changed entry: %s', p_changed_entry_id) END
  );

  UPDATE public.invoices
     SET status = 'void',
         internal_notes = CASE
           WHEN old_invoice.internal_notes IS NULL OR old_invoice.internal_notes = '' THEN void_note
           ELSE old_invoice.internal_notes || E'\n\n' || void_note
         END,
         updated_at = now_ts
   WHERE id = p_old_invoice_id;

  RETURN jsonb_build_object(
    'old_invoice_id', old_invoice.id,
    'old_invoice_number', old_invoice.invoice_number,
    'replacement_invoice', to_jsonb(replacement_invoice)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.replace_oj_invoice_transaction(uuid, jsonb, jsonb, uuid[], uuid[], text, uuid) TO service_role;
