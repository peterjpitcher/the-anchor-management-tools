CREATE OR REPLACE FUNCTION public.reissue_oj_invoice_transaction(
  p_source_invoice_id uuid,
  p_mode text,
  p_invoice_data jsonb,
  p_line_items jsonb,
  p_entry_ids uuid[] DEFAULT '{}',
  p_recurring_instance_ids uuid[] DEFAULT '{}',
  p_virtual_recurring_instances jsonb DEFAULT '[]'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  source_invoice public.invoices%ROWTYPE;
  target_invoice public.invoices%ROWTYPE;
  target_invoice_id uuid;
  now_ts timestamptz := timezone('utc', now());
  virtual_recurring_ids uuid[] := '{}';
  selected_recurring_ids uuid[] := '{}';
  source_note text;
BEGIN
  IF p_source_invoice_id IS NULL THEN
    RAISE EXCEPTION 'source invoice id is required';
  END IF;

  IF p_mode NOT IN ('rebuild_draft', 'replacement') THEN
    RAISE EXCEPTION 'invalid reissue mode %', p_mode;
  END IF;

  IF p_invoice_data IS NULL OR jsonb_typeof(p_invoice_data) <> 'object' THEN
    RAISE EXCEPTION 'invoice data is required';
  END IF;

  IF p_line_items IS NULL OR jsonb_typeof(p_line_items) <> 'array' OR jsonb_array_length(p_line_items) = 0 THEN
    RAISE EXCEPTION 'line_items must be a non-empty array';
  END IF;

  IF p_virtual_recurring_instances IS NULL OR jsonb_typeof(p_virtual_recurring_instances) <> 'array' THEN
    RAISE EXCEPTION 'virtual recurring instances must be an array';
  END IF;

  SELECT *
    INTO source_invoice
    FROM public.invoices
   WHERE id = p_source_invoice_id
     AND deleted_at IS NULL
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % not found', p_source_invoice_id;
  END IF;

  IF source_invoice.status IN ('paid', 'partially_paid', 'written_off') THEN
    RAISE EXCEPTION 'Paid, partially paid, and written off invoices cannot be reissued';
  END IF;

  IF COALESCE(source_invoice.paid_amount, 0) > 0 THEN
    RAISE EXCEPTION 'Cannot reissue an invoice after a payment has been recorded';
  END IF;

  IF p_mode = 'rebuild_draft' AND source_invoice.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft invoices can be rebuilt in place';
  END IF;

  IF p_mode = 'replacement' AND source_invoice.status NOT IN ('sent', 'overdue', 'void') THEN
    RAISE EXCEPTION 'Only sent, overdue, or void invoices can create replacement drafts';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.invoice_payments
     WHERE invoice_id = p_source_invoice_id
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Cannot reissue an invoice after a payment has been recorded';
  END IF;

  IF jsonb_array_length(p_virtual_recurring_instances) > 0 THEN
    WITH upserted AS (
      INSERT INTO public.oj_recurring_charge_instances (
        vendor_id,
        recurring_charge_id,
        period_yyyymm,
        period_start,
        period_end,
        description_snapshot,
        amount_ex_vat_snapshot,
        vat_rate_snapshot,
        sort_order_snapshot,
        status,
        billing_run_id,
        invoice_id,
        billed_at,
        paid_at,
        created_at,
        updated_at
      )
      SELECT
        COALESCE(NULLIF(item->>'vendor_id', '')::uuid, source_invoice.vendor_id),
        NULLIF(item->>'recurring_charge_id', '')::uuid,
        COALESCE(NULLIF(item->>'period_yyyymm', ''), ''),
        (item->>'period_start')::date,
        (item->>'period_end')::date,
        COALESCE(item->>'description_snapshot', ''),
        COALESCE((item->>'amount_ex_vat_snapshot')::numeric, 0),
        COALESCE((item->>'vat_rate_snapshot')::numeric, 0),
        COALESCE((item->>'sort_order_snapshot')::integer, 0),
        'unbilled',
        NULL,
        NULL,
        NULL,
        NULL,
        now_ts,
        now_ts
      FROM jsonb_array_elements(p_virtual_recurring_instances) AS item
      ON CONFLICT (vendor_id, recurring_charge_id, period_yyyymm)
      DO UPDATE SET
        description_snapshot = EXCLUDED.description_snapshot,
        amount_ex_vat_snapshot = EXCLUDED.amount_ex_vat_snapshot,
        vat_rate_snapshot = EXCLUDED.vat_rate_snapshot,
        sort_order_snapshot = EXCLUDED.sort_order_snapshot,
        updated_at = now_ts
      RETURNING id
    )
    SELECT COALESCE(array_agg(id), '{}') INTO virtual_recurring_ids FROM upserted;
  END IF;

  selected_recurring_ids := COALESCE(p_recurring_instance_ids, '{}') || COALESCE(virtual_recurring_ids, '{}');

  IF p_mode = 'rebuild_draft' THEN
    target_invoice_id := source_invoice.id;

    UPDATE public.invoices
       SET vendor_id = COALESCE(NULLIF(p_invoice_data->>'vendor_id', '')::uuid, source_invoice.vendor_id),
           invoice_date = COALESCE(NULLIF(p_invoice_data->>'invoice_date', '')::date, source_invoice.invoice_date),
           due_date = COALESCE(NULLIF(p_invoice_data->>'due_date', '')::date, source_invoice.due_date),
           reference = NULLIF(p_invoice_data->>'reference', ''),
           invoice_discount_percentage = COALESCE((p_invoice_data->>'invoice_discount_percentage')::numeric, source_invoice.invoice_discount_percentage),
           subtotal_amount = COALESCE((p_invoice_data->>'subtotal_amount')::numeric, 0),
           discount_amount = COALESCE((p_invoice_data->>'discount_amount')::numeric, 0),
           vat_amount = COALESCE((p_invoice_data->>'vat_amount')::numeric, 0),
           total_amount = COALESCE((p_invoice_data->>'total_amount')::numeric, 0),
           notes = p_invoice_data->>'notes',
           internal_notes = p_invoice_data->>'internal_notes',
           updated_at = now_ts
     WHERE id = target_invoice_id
     RETURNING * INTO target_invoice;

    DELETE FROM public.invoice_line_items WHERE invoice_id = target_invoice_id;
  ELSE
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
      p_invoice_data->>'invoice_number',
      COALESCE(NULLIF(p_invoice_data->>'vendor_id', '')::uuid, source_invoice.vendor_id),
      COALESCE(NULLIF(p_invoice_data->>'invoice_date', '')::date, source_invoice.invoice_date),
      COALESCE(NULLIF(p_invoice_data->>'due_date', '')::date, source_invoice.due_date),
      NULLIF(p_invoice_data->>'reference', ''),
      COALESCE((p_invoice_data->>'invoice_discount_percentage')::numeric, source_invoice.invoice_discount_percentage),
      COALESCE((p_invoice_data->>'subtotal_amount')::numeric, 0),
      COALESCE((p_invoice_data->>'discount_amount')::numeric, 0),
      COALESCE((p_invoice_data->>'vat_amount')::numeric, 0),
      COALESCE((p_invoice_data->>'total_amount')::numeric, 0),
      p_invoice_data->>'notes',
      p_invoice_data->>'internal_notes',
      'draft',
      now_ts,
      now_ts
    )
    RETURNING * INTO target_invoice;

    target_invoice_id := target_invoice.id;

    source_note := format(
      '[OJ_REISSUED %s] Replacement draft: %s',
      now_ts,
      target_invoice.invoice_number
    );

    UPDATE public.invoices
       SET status = 'void',
           internal_notes = CASE
             WHEN source_invoice.internal_notes IS NULL OR source_invoice.internal_notes = '' THEN source_note
             ELSE source_invoice.internal_notes || E'\n\n' || source_note
           END,
           updated_at = now_ts
     WHERE id = p_source_invoice_id;
  END IF;

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
    target_invoice_id,
    NULLIF(item->>'catalog_item_id', '')::uuid,
    COALESCE(item->>'description', ''),
    COALESCE((item->>'quantity')::numeric, 0),
    COALESCE((item->>'unit_price')::numeric, 0),
    COALESCE((item->>'discount_percentage')::numeric, 0),
    COALESCE((item->>'vat_rate')::numeric, 0)
  FROM jsonb_array_elements(p_line_items) AS item;

  UPDATE public.oj_entries
     SET invoice_id = target_invoice_id,
         billing_run_id = NULL,
         status = 'billing_pending',
         billed_at = NULL,
         paid_at = NULL,
         updated_at = now_ts
   WHERE id = ANY(COALESCE(p_entry_ids, '{}'))
     AND vendor_id = source_invoice.vendor_id
     AND (invoice_id IS NULL OR invoice_id = p_source_invoice_id OR invoice_id = target_invoice_id);

  UPDATE public.oj_entries
     SET invoice_id = NULL,
         billing_run_id = NULL,
         status = 'unbilled',
         billed_at = NULL,
         paid_at = NULL,
         updated_at = now_ts
   WHERE invoice_id = p_source_invoice_id
     AND NOT (id = ANY(COALESCE(p_entry_ids, '{}')));

  IF array_length(selected_recurring_ids, 1) IS NOT NULL THEN
    UPDATE public.oj_recurring_charge_instances
       SET invoice_id = target_invoice_id,
           billing_run_id = NULL,
           status = 'billing_pending',
           billed_at = NULL,
           paid_at = NULL,
           updated_at = now_ts
     WHERE id = ANY(selected_recurring_ids)
       AND vendor_id = source_invoice.vendor_id
       AND (invoice_id IS NULL OR invoice_id = p_source_invoice_id OR invoice_id = target_invoice_id);
  END IF;

  UPDATE public.oj_recurring_charge_instances
     SET invoice_id = NULL,
         billing_run_id = NULL,
         status = 'unbilled',
         billed_at = NULL,
         paid_at = NULL,
         updated_at = now_ts
   WHERE invoice_id = p_source_invoice_id
     AND NOT (id = ANY(selected_recurring_ids));

  SELECT * INTO target_invoice FROM public.invoices WHERE id = target_invoice_id;

  RETURN jsonb_build_object(
    'mode', p_mode,
    'source_invoice_id', source_invoice.id,
    'source_invoice_number', source_invoice.invoice_number,
    'invoice', to_jsonb(target_invoice)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reissue_oj_invoice_transaction(uuid, text, jsonb, jsonb, uuid[], uuid[], jsonb) TO service_role;
