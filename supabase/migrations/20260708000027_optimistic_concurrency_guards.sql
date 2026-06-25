-- A-061: optimistic-concurrency guards for state transitions.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_timeclock_sessions_open_employee
  ON public.timeclock_sessions (employee_id)
  WHERE clock_out_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_rota_couldnt_work_marker
  ON public.rota_shifts (week_id, employee_id, shift_date)
  WHERE status = 'sick'
    AND is_open_shift = false
    AND employee_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_credit_note_atomic(
  p_invoice_id uuid,
  p_amount_ex_vat numeric,
  p_reason text,
  p_created_by uuid
)
RETURNS TABLE (
  id uuid,
  credit_note_number text,
  amount_inc_vat numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_year integer := extract(year from timezone('Europe/London', now()))::integer;
  v_next_seq integer := 1;
  v_last_number text;
  v_vat_rate numeric;
  v_amount_inc_vat numeric;
  v_credit_note public.credit_notes%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_has_permission(auth.uid(), 'invoices', 'create') THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  IF p_created_by IS NULL OR p_created_by <> auth.uid() THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  IF p_invoice_id IS NULL OR v_reason = '' THEN
    RAISE EXCEPTION 'invoice_id_and_reason_required';
  END IF;

  IF p_amount_ex_vat IS NULL OR p_amount_ex_vat <= 0 THEN
    RAISE EXCEPTION 'credit_note_amount_must_be_positive';
  END IF;

  SELECT *
    INTO v_invoice
    FROM public.invoices
   WHERE invoices.id = p_invoice_id
     AND invoices.deleted_at IS NULL
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice_not_found';
  END IF;

  v_vat_rate := CASE
    WHEN coalesce(v_invoice.subtotal_amount, 0) > 0
      THEN round((coalesce(v_invoice.vat_amount, 0) / v_invoice.subtotal_amount) * 10000) / 100
    ELSE 20
  END;
  v_amount_inc_vat := round((p_amount_ex_vat * (1 + v_vat_rate / 100)) * 100) / 100;

  PERFORM pg_advisory_xact_lock(hashtext('credit_notes:' || v_year::text));

  SELECT cn.credit_note_number
    INTO v_last_number
    FROM public.credit_notes cn
   WHERE cn.credit_note_number ILIKE ('CN-' || v_year::text || '-%')
   ORDER BY cn.credit_note_number DESC
   LIMIT 1;

  IF v_last_number IS NOT NULL THEN
    v_next_seq := coalesce(substring(v_last_number from '^CN-[0-9]{4}-([0-9]+)$')::integer, 0) + 1;
  END IF;

  INSERT INTO public.credit_notes (
    credit_note_number,
    invoice_id,
    vendor_id,
    amount_ex_vat,
    vat_rate,
    amount_inc_vat,
    reason,
    status,
    created_by
  )
  VALUES (
    'CN-' || v_year::text || '-' || lpad(v_next_seq::text, 3, '0'),
    v_invoice.id,
    v_invoice.vendor_id,
    p_amount_ex_vat,
    v_vat_rate,
    v_amount_inc_vat,
    v_reason,
    'issued',
    p_created_by
  )
  RETURNING * INTO v_credit_note;

  RETURN QUERY SELECT
    v_credit_note.id,
    v_credit_note.credit_note_number,
    v_credit_note.amount_inc_vat;
END;
$$;
