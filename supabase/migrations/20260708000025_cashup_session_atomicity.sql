CREATE OR REPLACE FUNCTION public.upsert_cashup_session_atomic(
  p_existing_id uuid,
  p_site_id uuid,
  p_session_date date,
  p_status text,
  p_notes text,
  p_payment_breakdowns jsonb,
  p_cash_counts jsonb,
  p_sales_breakdowns jsonb,
  p_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id uuid;
  v_existing_status text;
  v_total_expected numeric(12, 2) := 0;
  v_total_counted numeric(12, 2) := 0;
  v_total_variance numeric(12, 2) := 0;
BEGIN
  IF p_status NOT IN ('draft', 'submitted', 'approved', 'locked') THEN
    RAISE EXCEPTION 'Invalid cash-up status';
  END IF;

  IF jsonb_typeof(COALESCE(p_payment_breakdowns, '[]'::jsonb)) <> 'array'
    OR jsonb_typeof(COALESCE(p_cash_counts, '[]'::jsonb)) <> 'array'
    OR jsonb_typeof(COALESCE(p_sales_breakdowns, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Cash-up child payloads must be arrays';
  END IF;

  SELECT
    COALESCE(sum((item->>'expected_amount')::numeric), 0)::numeric(12, 2),
    COALESCE(sum((item->>'counted_amount')::numeric), 0)::numeric(12, 2)
  INTO v_total_expected, v_total_counted
  FROM jsonb_array_elements(COALESCE(p_payment_breakdowns, '[]'::jsonb)) AS item;

  v_total_variance := (v_total_counted - v_total_expected)::numeric(12, 2);

  IF p_existing_id IS NULL THEN
    SELECT id
    INTO v_session_id
    FROM public.cashup_sessions
    WHERE site_id = p_site_id
      AND session_date = p_session_date
    FOR UPDATE;

    IF FOUND THEN
      RAISE EXCEPTION 'A session for this site and date already exists.';
    END IF;

    INSERT INTO public.cashup_sessions (
      site_id,
      session_date,
      status,
      notes,
      total_expected_amount,
      total_counted_amount,
      total_variance_amount,
      prepared_by_user_id,
      created_by_user_id,
      updated_by_user_id
    )
    VALUES (
      p_site_id,
      p_session_date,
      p_status,
      p_notes,
      v_total_expected,
      v_total_counted,
      v_total_variance,
      p_user_id,
      p_user_id,
      p_user_id
    )
    RETURNING id INTO v_session_id;
  ELSE
    SELECT status
    INTO v_existing_status
    FROM public.cashup_sessions
    WHERE id = p_existing_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Session not found';
    END IF;

    IF v_existing_status = 'locked' THEN
      RAISE EXCEPTION 'Cannot modify a locked session';
    END IF;

    UPDATE public.cashup_sessions
    SET site_id = p_site_id,
        session_date = p_session_date,
        status = p_status,
        notes = p_notes,
        total_expected_amount = v_total_expected,
        total_counted_amount = v_total_counted,
        total_variance_amount = v_total_variance,
        updated_by_user_id = p_user_id,
        updated_at = now()
    WHERE id = p_existing_id
    RETURNING id INTO v_session_id;
  END IF;

  DELETE FROM public.cashup_payment_breakdowns WHERE cashup_session_id = v_session_id;
  DELETE FROM public.cashup_cash_counts WHERE cashup_session_id = v_session_id;
  DELETE FROM public.cashup_sales_breakdowns WHERE cashup_session_id = v_session_id;

  INSERT INTO public.cashup_payment_breakdowns (
    cashup_session_id,
    payment_type_code,
    payment_type_label,
    expected_amount,
    counted_amount,
    variance_amount
  )
  SELECT
    v_session_id,
    item->>'payment_type_code',
    item->>'payment_type_label',
    (item->>'expected_amount')::numeric,
    (item->>'counted_amount')::numeric,
    ((item->>'counted_amount')::numeric - (item->>'expected_amount')::numeric)::numeric(12, 2)
  FROM jsonb_array_elements(COALESCE(p_payment_breakdowns, '[]'::jsonb)) AS item
  WHERE NULLIF(item->>'payment_type_code', '') IS NOT NULL;

  INSERT INTO public.cashup_cash_counts (
    cashup_session_id,
    denomination,
    quantity,
    total_amount
  )
  SELECT
    v_session_id,
    (item->>'denomination')::numeric,
    (item->>'quantity')::integer,
    (item->>'total_amount')::numeric
  FROM jsonb_array_elements(COALESCE(p_cash_counts, '[]'::jsonb)) AS item
  WHERE COALESCE((item->>'quantity')::integer, 0) > 0;

  INSERT INTO public.cashup_sales_breakdowns (
    cashup_session_id,
    sales_category,
    amount
  )
  SELECT
    v_session_id,
    item->>'sales_category',
    (item->>'amount')::numeric
  FROM jsonb_array_elements(COALESCE(p_sales_breakdowns, '[]'::jsonb)) AS item
  WHERE NULLIF(item->>'sales_category', '') IS NOT NULL;

  RETURN v_session_id;
END;
$$;
