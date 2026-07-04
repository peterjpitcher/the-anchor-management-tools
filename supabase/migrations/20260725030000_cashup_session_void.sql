-- Cash-up session void support.
-- A mis-entered cash-up was previously only correctable by hard delete (or SQL).
-- Void keeps the financial record for audit while excluding it from totals.
--
-- 1. Additive columns on cashup_sessions: voided_at / voided_by / void_reason
-- 2. cashup_weekly_view recreated to exclude voided sessions from weekly totals
-- 3. New cashing_up/manage permission (void), granted to super_admin + manager
-- 4. Update RLS policy extended so manage holders can perform the void update
-- 5. upsert_cashup_session_atomic hardened to refuse edits to voided sessions

-- 1. Columns -----------------------------------------------------------------

ALTER TABLE cashup_sessions
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS voided_by UUID NULL,
  ADD COLUMN IF NOT EXISTS void_reason TEXT NULL;

-- 2. Weekly view: exclude voided sessions ------------------------------------

DROP VIEW IF EXISTS cashup_weekly_view;
CREATE VIEW cashup_weekly_view AS
SELECT
    cs.site_id,
    date_trunc('week', cs.session_date)::date AS week_start_date,
    cs.session_date,
    cs.status,
    cs.total_expected_amount,
    cs.total_counted_amount,
    cs.total_variance_amount
FROM cashup_sessions cs
WHERE cs.voided_at IS NULL;

-- 3. cashing_up/manage permission + role grants -------------------------------

DO $$
DECLARE
  super_admin_role_id UUID;
  manager_role_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM permissions WHERE module_name = 'cashing_up' AND action = 'manage') THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('cashing_up', 'manage', 'Void cashing up sessions (kept for audit, excluded from totals)');
  END IF;

  SELECT id INTO super_admin_role_id FROM roles WHERE name = 'super_admin' LIMIT 1;
  SELECT id INTO manager_role_id FROM roles WHERE name = 'manager' LIMIT 1;

  IF super_admin_role_id IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT super_admin_role_id, p.id
    FROM permissions p
    WHERE p.module_name = 'cashing_up' AND p.action = 'manage'
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
        WHERE rp.role_id = super_admin_role_id AND rp.permission_id = p.id
      );
  END IF;

  IF manager_role_id IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT manager_role_id, p.id
    FROM permissions p
    WHERE p.module_name = 'cashing_up' AND p.action = 'manage'
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
        WHERE rp.role_id = manager_role_id AND rp.permission_id = p.id
      );
  END IF;

  RAISE NOTICE 'cashing_up manage permission created and assigned to super_admin and manager roles';
END $$;

-- 4. Update policy: allow manage holders to void ------------------------------

DROP POLICY IF EXISTS "Users can update sessions with permission" ON cashup_sessions;
CREATE POLICY "Users can update sessions with permission" ON cashup_sessions
    FOR UPDATE TO authenticated
    USING (
        public.user_has_permission(auth.uid(), 'cashing_up', 'edit') OR
        public.user_has_permission(auth.uid(), 'cashing_up', 'submit') OR
        public.user_has_permission(auth.uid(), 'cashing_up', 'approve') OR
        public.user_has_permission(auth.uid(), 'cashing_up', 'lock') OR
        public.user_has_permission(auth.uid(), 'cashing_up', 'unlock') OR
        public.user_has_permission(auth.uid(), 'cashing_up', 'manage')
    );

-- 5. Atomic upsert: refuse edits to voided sessions ---------------------------

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
  v_existing_voided_at timestamptz;
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
    SELECT status, voided_at
    INTO v_existing_status, v_existing_voided_at
    FROM public.cashup_sessions
    WHERE id = p_existing_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Session not found';
    END IF;

    IF v_existing_status = 'locked' THEN
      RAISE EXCEPTION 'Cannot modify a locked session';
    END IF;

    IF v_existing_voided_at IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot modify a voided session';
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

GRANT EXECUTE ON FUNCTION public.upsert_cashup_session_atomic(uuid, uuid, date, text, text, jsonb, jsonb, jsonb, uuid) TO authenticated, service_role;
