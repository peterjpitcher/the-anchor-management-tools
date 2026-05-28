-- Receipts v2: follow-up rules from live missing-vendor review.
-- These rules are intentionally narrow: they classify clear bank descriptors without
-- broadening generic retailer categories or auto-closing unclear card purchases.

CREATE OR REPLACE FUNCTION pg_temp.receipt_vendor_key_followup(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
AS $$
  SELECT public.normalize_receipt_vendor_key(p_name);
$$;

CREATE OR REPLACE FUNCTION pg_temp.ensure_receipt_vendor_followup(
  p_name TEXT
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_name TEXT := NULLIF(TRIM(COALESCE(p_name, '')), '');
  v_key TEXT := pg_temp.receipt_vendor_key_followup(p_name);
  v_id UUID;
BEGIN
  IF v_name IS NULL OR v_key IS NULL OR LOWER(v_name) = 'null' THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_id
  FROM public.receipt_vendors
  WHERE vendor_key = v_key
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.receipt_vendors (
      canonical_name,
      vendor_key,
      status
    )
    VALUES (
      v_name,
      v_key,
      'confirmed'
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.receipt_vendors
    SET
      canonical_name = CASE
        WHEN status = 'unconfirmed' THEN v_name
        ELSE canonical_name
      END,
      status = CASE
        WHEN status = 'unconfirmed' THEN 'confirmed'
        ELSE status
      END,
      updated_at = NOW()
    WHERE id = v_id;
  END IF;

  INSERT INTO public.receipt_vendor_aliases (
    vendor_id,
    alias,
    alias_key,
    source,
    confidence
  )
  VALUES (
    v_id,
    v_name,
    v_key,
    'system',
    100
  )
  ON CONFLICT (alias_key) DO NOTHING;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.upsert_receipt_rule_followup(
  p_name TEXT,
  p_match_description TEXT,
  p_match_transaction_type TEXT,
  p_match_direction TEXT,
  p_vendor_name TEXT,
  p_expense_category TEXT,
  p_auto_status TEXT,
  p_kind TEXT,
  p_priority INTEGER DEFAULT 1000
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_rule_id UUID;
  v_vendor_id UUID;
BEGIN
  v_vendor_id := pg_temp.ensure_receipt_vendor_followup(p_vendor_name);

  SELECT id INTO v_rule_id
  FROM public.receipt_rules
  WHERE LOWER(name) = LOWER(p_name)
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
      p_name,
      'Receipts v2 governed follow-up rule seeded from live missing-vendor evidence.',
      p_match_description,
      p_match_transaction_type,
      p_match_direction,
      p_auto_status::public.receipt_transaction_status,
      TRUE,
      p_vendor_name,
      v_vendor_id,
      p_expense_category,
      p_priority,
      p_kind,
      NOW(),
      NOW(),
      NOW()
    )
    RETURNING id INTO v_rule_id;
  ELSE
    UPDATE public.receipt_rules
    SET
      description = COALESCE(description, 'Receipts v2 governed follow-up rule seeded from live missing-vendor evidence.'),
      match_description = p_match_description,
      match_transaction_type = p_match_transaction_type,
      match_direction = p_match_direction,
      auto_status = p_auto_status::public.receipt_transaction_status,
      is_active = TRUE,
      set_vendor_name = p_vendor_name,
      vendor_id = v_vendor_id,
      set_expense_category = p_expense_category,
      priority = p_priority,
      kind = p_kind,
      reviewed_at = COALESCE(reviewed_at, NOW()),
      deactivated_at = NULL,
      deactivated_by = NULL,
      updated_at = NOW()
    WHERE id = v_rule_id;
  END IF;

  RETURN v_rule_id;
END;
$$;

WITH invalid_vendor AS (
  SELECT id
  FROM public.receipt_vendors
  WHERE vendor_key = 'null'
)
UPDATE public.receipt_transactions rt
SET
  vendor_id = NULL,
  vendor_name = NULL,
  vendor_source = NULL,
  vendor_rule_id = NULL,
  vendor_updated_at = NOW(),
  updated_at = NOW()
WHERE LOWER(BTRIM(COALESCE(rt.vendor_name, ''))) = 'null'
  OR rt.vendor_id IN (SELECT id FROM invalid_vendor);

UPDATE public.receipt_vendors
SET
  canonical_name = 'Invalid literal null vendor',
  status = 'inactive',
  updated_at = NOW()
WHERE vendor_key = 'null';

SELECT pg_temp.upsert_receipt_rule_followup(
  'Nicholas McLernon payroll',
  'Nicholas McLernon The Anchor,Nicholas McLernon Money Owed,Nicholas McLernon Monies Owed',
  NULL,
  'out',
  'Nicholas McLernon',
  'Total Staff',
  'no_receipt_required',
  'payroll',
  1000
);

SELECT pg_temp.upsert_receipt_rule_followup(
  'Billy''s Payroll',
  'Billy Summers The Anchor,Billy Summers WEEK,B Summers Week',
  NULL,
  'out',
  'Billy Summers',
  'Total Staff',
  'no_receipt_required',
  'payroll',
  1000
);

SELECT pg_temp.upsert_receipt_rule_followup(
  'Billy Summers inbound cash deposits',
  'Billy Summers WEEK,B Summers Week',
  'Inward Payment',
  'in',
  'Billy Summers',
  NULL,
  'no_receipt_required',
  'income_settlement',
  1000
);

SELECT pg_temp.upsert_receipt_rule_followup(
  'Sharon Morris Latham duplicate payment correction',
  'MORRIS-LATHAM S DUP PYMT ERROR',
  'Inward Payment',
  'in',
  'Sharon Morris Latham',
  NULL,
  'no_receipt_required',
  'payroll',
  1000
);

SELECT pg_temp.upsert_receipt_rule_followup(
  'HMRC Corporation Tax inbound payments',
  'HMRC COTAX',
  'BACS Payment Received',
  'in',
  'HMRC Corporation Tax',
  NULL,
  'no_receipt_required',
  'tax',
  1000
);

SELECT pg_temp.upsert_receipt_rule_followup(
  'Residential Solutions inbound payment review',
  'RESIDENTIAL SOLUTI',
  'BACS Payment Received',
  'in',
  'Residential Solutions',
  NULL,
  'pending',
  'standard',
  1000
);

SELECT pg_temp.upsert_receipt_rule_followup(
  'Airbnb owner transfer income',
  'MR P J PITCHER AirBNB',
  'TRANSFER',
  'in',
  'Airbnb',
  NULL,
  'no_receipt_required',
  'income_settlement',
  1000
);

SELECT pg_temp.upsert_receipt_rule_followup(
  'Stanwell Moor community income transfer',
  'STANWELL MOOR COMMUNITY AND WELLBEI',
  'TRANSFER',
  'in',
  'Stanwell Moor Community and Wellbeing',
  NULL,
  'no_receipt_required',
  'income_settlement',
  1000
);

SELECT pg_temp.upsert_receipt_rule_followup(
  'JJ Eade Kiki payment',
  'EADE JJ KIKI PAYMENT',
  'Inward Payment',
  'in',
  'JJ Eade',
  NULL,
  'no_receipt_required',
  'income_settlement',
  1000
);

SELECT pg_temp.upsert_receipt_rule_followup(
  'Dojo card processing fees',
  'DOJOUK',
  'Direct Debit',
  'out',
  'Dojo',
  'Bank Charges/Credit Card Commission',
  'no_receipt_required',
  'bank_fee',
  1000
);

SELECT pg_temp.upsert_receipt_rule_followup(
  'GoCardless Direct Debit payments',
  'GOCARDLESS',
  'Direct Debit',
  'out',
  'GoCardless',
  NULL,
  'no_receipt_required',
  'standard',
  1000
);

SELECT pg_temp.upsert_receipt_rule_followup(
  'Loomly subscriptions',
  'LOOMLY',
  'Card Transaction',
  'out',
  'Loomly',
  'Marketing/Promotion/Advertising',
  'pending',
  'standard',
  1000
);

SELECT pg_temp.upsert_receipt_rule_followup(
  'Two Rivers Retail Park card purchases',
  'TWO RIVERS RETAIL PARK',
  'Card Transaction',
  'out',
  'Two Rivers Retail Park',
  NULL,
  'pending',
  'standard',
  1000
);

SELECT pg_temp.upsert_receipt_rule_followup(
  'Temu card purchases',
  'Temu.com AppPay',
  'Card Transaction',
  'out',
  'Temu',
  NULL,
  'pending',
  'standard',
  1000
);

SELECT pg_temp.upsert_receipt_rule_followup(
  'MTCGAME card purchases',
  'WWW.MTCGAME.COM',
  'Card Transaction',
  'out',
  'MTCGAME',
  NULL,
  'pending',
  'standard',
  1000
);

SELECT pg_temp.upsert_receipt_rule_followup(
  'M6 Toll card purchases',
  'M6 TOLL',
  'Card Transaction',
  'out',
  'M6 Toll',
  'Travel/Car',
  'pending',
  'standard',
  1000
);

SELECT pg_temp.upsert_receipt_rule_followup(
  'SECC Arena card purchases',
  'SECC ARENA',
  'Card Transaction',
  'out',
  'SECC Arena',
  NULL,
  'pending',
  'standard',
  1000
);

SELECT pg_temp.upsert_receipt_rule_followup(
  'Benihana Covent Garden card purchases',
  'BENIHANA COVENT GARDEN',
  'Card Transaction',
  'out',
  'Benihana',
  NULL,
  'pending',
  'standard',
  1000
);

SELECT pg_temp.upsert_receipt_rule_followup(
  'Garsons card purchases',
  'CLR Garsons',
  'Card Transaction',
  'out',
  'Garsons',
  NULL,
  'pending',
  'standard',
  1000
);

SELECT pg_temp.upsert_receipt_rule_followup(
  'Brighton North Laine card purchases',
  'Brighton North Laine',
  'Card Transaction',
  'out',
  'Brighton North Laine',
  NULL,
  'pending',
  'standard',
  1000
);

SELECT pg_temp.upsert_receipt_rule_followup(
  'SCE dishwasher and ice machine repairs',
  'SCE dishwasher and Ice Marchine',
  'Outward Faster Payment',
  'out',
  'SCE',
  'Equipment Repairs/Maintenance',
  'pending',
  'standard',
  1000
);

CREATE OR REPLACE FUNCTION public.get_receipt_detail_groups(
  limit_groups INTEGER DEFAULT 10,
  include_statuses TEXT[] DEFAULT ARRAY['pending'],
  only_unclassified BOOLEAN DEFAULT TRUE,
  use_fuzzy_grouping BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  details TEXT,
  transaction_ids TEXT[],
  transaction_count BIGINT,
  needs_vendor_count BIGINT,
  needs_expense_count BIGINT,
  total_in NUMERIC,
  total_out NUMERIC,
  first_date DATE,
  last_date DATE,
  dominant_vendor TEXT,
  dominant_expense TEXT,
  sample_transaction JSONB
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH grouped AS (
    SELECT
      CASE WHEN use_fuzzy_grouping
        THEN public.normalize_receipt_details(rt.details)
        ELSE rt.details
      END AS group_key,
      rt.id,
      rt.details,
      rt.transaction_date,
      rt.amount_in,
      rt.amount_out,
      rt.vendor_name,
      rt.vendor_source,
      rt.expense_category,
      rt.expense_category_source,
      rt.transaction_type
    FROM public.receipt_transactions rt
    WHERE rt.status::TEXT = ANY(include_statuses)
      AND (
        NOT only_unclassified
        OR rt.vendor_name IS NULL
        OR rt.expense_category IS NULL
      )
  ),
  aggregated AS (
    SELECT
      g.group_key AS grp_details,
      ARRAY_AGG(g.id::TEXT ORDER BY g.transaction_date DESC) AS grp_ids,
      COUNT(*)::BIGINT AS grp_count,
      COUNT(*) FILTER (WHERE g.vendor_name IS NULL)::BIGINT AS grp_needs_vendor,
      COUNT(*) FILTER (WHERE g.expense_category IS NULL AND g.amount_out > 0)::BIGINT AS grp_needs_expense,
      SUM(COALESCE(g.amount_in, 0)) AS grp_total_in,
      SUM(COALESCE(g.amount_out, 0)) AS grp_total_out,
      MIN(g.transaction_date) AS grp_first_date,
      MAX(g.transaction_date) AS grp_last_date,
      (
        SELECT g2.vendor_name
        FROM grouped g2
        WHERE g2.group_key = g.group_key
          AND g2.vendor_name IS NOT NULL
        GROUP BY g2.vendor_name
        ORDER BY COUNT(*) DESC
        LIMIT 1
      ) AS grp_dominant_vendor,
      (
        SELECT g2.expense_category
        FROM grouped g2
        WHERE g2.group_key = g.group_key
          AND g2.expense_category IS NOT NULL
        GROUP BY g2.expense_category
        ORDER BY COUNT(*) DESC
        LIMIT 1
      ) AS grp_dominant_expense,
      (
        SELECT jsonb_build_object(
          'id', g2.id,
          'transaction_date', g2.transaction_date,
          'transaction_type', g2.transaction_type,
          'amount_in', g2.amount_in,
          'amount_out', g2.amount_out,
          'vendor_name', g2.vendor_name,
          'vendor_source', g2.vendor_source,
          'expense_category', g2.expense_category,
          'expense_category_source', g2.expense_category_source
        )
        FROM grouped g2
        WHERE g2.group_key = g.group_key
        ORDER BY g2.transaction_date DESC
        LIMIT 1
      ) AS grp_sample
    FROM grouped g
    WHERE g.group_key IS NOT NULL
      AND g.group_key <> ''
    GROUP BY g.group_key
  )
  SELECT
    a.grp_details,
    a.grp_ids,
    a.grp_count,
    a.grp_needs_vendor,
    a.grp_needs_expense,
    a.grp_total_in,
    a.grp_total_out,
    a.grp_first_date,
    a.grp_last_date,
    a.grp_dominant_vendor,
    a.grp_dominant_expense,
    a.grp_sample
  FROM aggregated a
  ORDER BY a.grp_count DESC
  LIMIT limit_groups;
END;
$$;

CREATE OR REPLACE FUNCTION public.import_receipt_batch_transaction(
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
  INSERT INTO public.receipt_batches (
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

  IF jsonb_array_length(p_transactions) > 0 THEN
    INSERT INTO public.receipt_transactions (
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
      (item->>'status')::public.receipt_transaction_status,
      COALESCE((item->>'receipt_required')::BOOLEAN, true),
      NULLIF(BTRIM(item->>'vendor_name'), ''),
      CASE
        WHEN item->>'vendor_source' IN ('ai', 'manual', 'rule', 'import') THEN item->>'vendor_source'
        ELSE NULL
      END,
      NULLIF(BTRIM(item->>'expense_category'), ''),
      CASE
        WHEN item->>'expense_category_source' IN ('ai', 'manual', 'rule', 'import') THEN item->>'expense_category_source'
        ELSE NULL
      END
    FROM jsonb_array_elements(p_transactions) AS item;
  END IF;

  SELECT to_jsonb(rb) INTO v_batch_record
  FROM public.receipt_batches rb
  WHERE rb.id = v_batch_id;

  RETURN v_batch_record;
END;
$$;
