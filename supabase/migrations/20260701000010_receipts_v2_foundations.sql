BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION public.normalize_receipt_vendor_key(input TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT NULLIF(LOWER(REGEXP_REPLACE(BTRIM(COALESCE(input, '')), '[[:space:]]+', ' ', 'g')), '');
$$;

CREATE TABLE IF NOT EXISTS public.receipt_vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name TEXT NOT NULL,
  vendor_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'unconfirmed' CHECK (status IN ('unconfirmed', 'confirmed', 'merged', 'inactive')),
  invoice_vendor_id UUID REFERENCES public.invoice_vendors(id) ON DELETE SET NULL,
  merged_into_vendor_id UUID REFERENCES public.receipt_vendors(id) ON DELETE SET NULL,
  category_hint TEXT,
  default_expense_category TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT receipt_vendors_name_not_empty CHECK (BTRIM(canonical_name) <> ''),
  CONSTRAINT receipt_vendors_key_not_empty CHECK (BTRIM(vendor_key) <> '')
);

CREATE INDEX IF NOT EXISTS idx_receipt_vendors_invoice_vendor_id
  ON public.receipt_vendors(invoice_vendor_id);

CREATE INDEX IF NOT EXISTS idx_receipt_vendors_status
  ON public.receipt_vendors(status);

CREATE TABLE IF NOT EXISTS public.receipt_vendor_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES public.receipt_vendors(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  alias_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'migration' CHECK (source IN ('migration', 'manual', 'rule', 'ai', 'system')),
  confidence SMALLINT CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT receipt_vendor_aliases_alias_not_empty CHECK (BTRIM(alias) <> ''),
  CONSTRAINT receipt_vendor_aliases_key_not_empty CHECK (BTRIM(alias_key) <> '')
);

CREATE INDEX IF NOT EXISTS idx_receipt_vendor_aliases_vendor_id
  ON public.receipt_vendor_aliases(vendor_id);

ALTER TABLE public.receipt_rules
  ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES public.receipt_vendors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deactivated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.receipt_transactions
  ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES public.receipt_vendors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS auto_completed_reason TEXT;

ALTER TABLE public.receipt_files
  ADD COLUMN IF NOT EXISTS content_hash TEXT,
  ADD COLUMN IF NOT EXISTS hash_verified_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'receipt_rules_kind_check'
  ) THEN
    ALTER TABLE public.receipt_rules
      ADD CONSTRAINT receipt_rules_kind_check
      CHECK (kind IN (
        'standard',
        'payroll',
        'tax',
        'income_settlement',
        'utility',
        'bank_fee',
        'receipt_not_required'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_receipt_rules_priority_order
  ON public.receipt_rules(priority ASC, created_at ASC)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_receipt_rules_vendor_id
  ON public.receipt_rules(vendor_id);

CREATE INDEX IF NOT EXISTS idx_receipt_transactions_vendor_id
  ON public.receipt_transactions(vendor_id);

CREATE INDEX IF NOT EXISTS idx_receipt_transactions_duplicate_prefilter
  ON public.receipt_transactions(transaction_date, amount_total, id);

CREATE INDEX IF NOT EXISTS idx_receipt_files_content_hash
  ON public.receipt_files(content_hash)
  WHERE content_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.receipt_classification_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES public.receipt_transactions(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('rule', 'ai', 'human', 'migration', 'system')),
  signal_type TEXT NOT NULL,
  prior_vendor_id UUID REFERENCES public.receipt_vendors(id) ON DELETE SET NULL,
  new_vendor_id UUID REFERENCES public.receipt_vendors(id) ON DELETE SET NULL,
  prior_vendor_name TEXT,
  new_vendor_name TEXT,
  prior_expense_category TEXT,
  new_expense_category TEXT,
  prior_status public.receipt_transaction_status,
  new_status public.receipt_transaction_status,
  rule_id UUID REFERENCES public.receipt_rules(id) ON DELETE SET NULL,
  ai_confidence INTEGER CHECK (ai_confidence IS NULL OR ai_confidence BETWEEN 0 AND 100),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  performed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_receipt_classification_signals_transaction
  ON public.receipt_classification_signals(transaction_id, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_receipt_classification_signals_rule
  ON public.receipt_classification_signals(rule_id)
  WHERE rule_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.receipt_rule_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'expired')),
  suggested_name TEXT NOT NULL,
  match_description TEXT,
  match_transaction_type TEXT,
  match_direction TEXT NOT NULL DEFAULT 'both' CHECK (match_direction IN ('in', 'out', 'both')),
  match_min_amount NUMERIC(12, 2),
  match_max_amount NUMERIC(12, 2),
  set_vendor_id UUID REFERENCES public.receipt_vendors(id) ON DELETE SET NULL,
  set_vendor_name TEXT,
  set_expense_category TEXT,
  auto_status public.receipt_transaction_status NOT NULL DEFAULT 'pending',
  evidence_transaction_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  approved_rule_id UUID REFERENCES public.receipt_rules(id) ON DELETE SET NULL,
  declined_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_receipt_rule_suggestions_status_created
  ON public.receipt_rule_suggestions(status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.receipt_rule_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES public.receipt_rules(id) ON DELETE CASCADE,
  overlapping_rule_id UUID NOT NULL REFERENCES public.receipt_rules(id) ON DELETE CASCADE,
  overlap_count INTEGER NOT NULL DEFAULT 0,
  same_priority BOOLEAN NOT NULL DEFAULT false,
  sample_transaction_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  CONSTRAINT receipt_rule_conflicts_pair_order CHECK (rule_id::TEXT < overlapping_rule_id::TEXT),
  CONSTRAINT receipt_rule_conflicts_unique_pair UNIQUE (rule_id, overlapping_rule_id)
);

CREATE INDEX IF NOT EXISTS idx_receipt_rule_conflicts_open
  ON public.receipt_rule_conflicts(resolved_at, detected_at DESC);

CREATE TABLE IF NOT EXISTS public.receipt_duplicate_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID REFERENCES public.receipt_transactions(id) ON DELETE CASCADE,
  duplicate_transaction_id UUID REFERENCES public.receipt_transactions(id) ON DELETE CASCADE,
  file_id UUID REFERENCES public.receipt_files(id) ON DELETE CASCADE,
  duplicate_file_id UUID REFERENCES public.receipt_files(id) ON DELETE CASCADE,
  review_type TEXT NOT NULL CHECK (review_type IN ('transaction', 'file')),
  decision TEXT NOT NULL CHECK (decision IN ('same', 'different', 'ignored')),
  reason TEXT,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT receipt_duplicate_reviews_transaction_pair CHECK (
    review_type <> 'transaction'
    OR (transaction_id IS NOT NULL AND duplicate_transaction_id IS NOT NULL)
  ),
  CONSTRAINT receipt_duplicate_reviews_file_pair CHECK (
    review_type <> 'file'
    OR (file_id IS NOT NULL AND duplicate_file_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_receipt_duplicate_reviews_transaction
  ON public.receipt_duplicate_reviews(transaction_id, duplicate_transaction_id)
  WHERE review_type = 'transaction';

CREATE INDEX IF NOT EXISTS idx_receipt_duplicate_reviews_file
  ON public.receipt_duplicate_reviews(file_id, duplicate_file_id)
  WHERE review_type = 'file';

CREATE TABLE IF NOT EXISTS public.receipt_anomalies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anomaly_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'low', 'medium', 'high')),
  vendor_id UUID REFERENCES public.receipt_vendors(id) ON DELETE SET NULL,
  vendor_name TEXT,
  transaction_id UUID REFERENCES public.receipt_transactions(id) ON DELETE CASCADE,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_receipt_anomalies_open
  ON public.receipt_anomalies(resolved_at, detected_at DESC);

DROP MATERIALIZED VIEW IF EXISTS public.receipt_duplicate_candidates;
CREATE MATERIALIZED VIEW public.receipt_duplicate_candidates AS
WITH candidate_pairs AS (
  SELECT
    t1.id AS transaction_id,
    t2.id AS duplicate_transaction_id,
    ABS(t1.transaction_date - t2.transaction_date)::INTEGER AS days_apart,
    ABS((COALESCE(t1.amount_total, 0) - COALESCE(t2.amount_total, 0)) * 100)::INTEGER AS amount_diff_pence,
    COALESCE(t1.details, '') AS details_a,
    COALESCE(t2.details, '') AS details_b
  FROM public.receipt_transactions t1
  JOIN public.receipt_transactions t2
    ON t1.id::TEXT < t2.id::TEXT
   AND t2.transaction_date BETWEEN t1.transaction_date - 3 AND t1.transaction_date + 3
   AND COALESCE(t2.amount_total, 0) BETWEEN COALESCE(t1.amount_total, 0) - 0.50
     AND COALESCE(t1.amount_total, 0) + 0.50
)
SELECT
  transaction_id,
  duplicate_transaction_id,
  days_apart,
  amount_diff_pence,
  similarity(details_a, details_b) AS detail_similarity
FROM candidate_pairs
WHERE similarity(details_a, details_b) >= 0.70
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_receipt_duplicate_candidates_pair
  ON public.receipt_duplicate_candidates(transaction_id, duplicate_transaction_id);

CREATE OR REPLACE FUNCTION public.refresh_receipt_duplicate_candidates()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW public.receipt_duplicate_candidates;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_receipt_vendors_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_receipt_vendors_updated_at ON public.receipt_vendors;
CREATE TRIGGER trg_receipt_vendors_updated_at
BEFORE UPDATE ON public.receipt_vendors
FOR EACH ROW
EXECUTE FUNCTION public.set_receipt_vendors_updated_at();

WITH raw_labels AS (
  SELECT NULLIF(BTRIM(vendor_name), '') AS label
  FROM public.receipt_transactions
  UNION
  SELECT NULLIF(BTRIM(set_vendor_name), '') AS label
  FROM public.receipt_rules
), normalized AS (
  SELECT
    label,
    public.normalize_receipt_vendor_key(label) AS vendor_key
  FROM raw_labels
  WHERE label IS NOT NULL
)
INSERT INTO public.receipt_vendors(canonical_name, vendor_key, status)
SELECT MIN(label), vendor_key, 'unconfirmed'
FROM normalized
WHERE vendor_key IS NOT NULL
GROUP BY vendor_key
ON CONFLICT (vendor_key) DO NOTHING;

WITH raw_labels AS (
  SELECT NULLIF(BTRIM(vendor_name), '') AS label
  FROM public.receipt_transactions
  UNION
  SELECT NULLIF(BTRIM(set_vendor_name), '') AS label
  FROM public.receipt_rules
), normalized AS (
  SELECT DISTINCT
    label,
    public.normalize_receipt_vendor_key(label) AS alias_key
  FROM raw_labels
  WHERE label IS NOT NULL
)
INSERT INTO public.receipt_vendor_aliases(vendor_id, alias, alias_key, source, confidence)
SELECT rv.id, normalized.label, normalized.alias_key, 'migration', 100
FROM normalized
JOIN public.receipt_vendors rv ON rv.vendor_key = normalized.alias_key
WHERE normalized.alias_key IS NOT NULL
ON CONFLICT (alias_key) DO NOTHING;

UPDATE public.receipt_transactions rt
SET vendor_id = rv.id
FROM public.receipt_vendors rv
WHERE rt.vendor_id IS NULL
  AND public.normalize_receipt_vendor_key(rt.vendor_name) = rv.vendor_key;

UPDATE public.receipt_rules rr
SET vendor_id = rv.id
FROM public.receipt_vendors rv
WHERE rr.vendor_id IS NULL
  AND public.normalize_receipt_vendor_key(rr.set_vendor_name) = rv.vendor_key;

UPDATE public.receipt_rules
SET
  name = 'Zettle EPOS card deposits via PayPal BACS',
  description = COALESCE(description, 'Inbound EPOS/card settlement deposits paid via PayPal BACS; not customer-level PayPal transactions.'),
  kind = 'income_settlement',
  match_direction = 'in',
  auto_status = 'no_receipt_required',
  set_vendor_name = COALESCE(set_vendor_name, 'Zettle'),
  vendor_id = COALESCE(
    vendor_id,
    (SELECT id FROM public.receipt_vendors WHERE vendor_key = public.normalize_receipt_vendor_key('Zettle') LIMIT 1)
  ),
  reviewed_at = COALESCE(reviewed_at, NOW()),
  updated_at = NOW()
WHERE match_direction = 'in'
  AND (
    LOWER(COALESCE(name, '')) LIKE '%paypal%'
    OR LOWER(COALESCE(match_description, '')) LIKE '%paypal%'
  )
  AND LOWER(COALESCE(set_vendor_name, '')) LIKE '%zettle%';

UPDATE public.receipt_rules
SET
  name = CASE WHEN LOWER(name) = 'sdds' THEN 'HMRC SDDS' ELSE name END,
  match_description = 'HMRC SDDS',
  kind = 'tax',
  reviewed_at = COALESCE(reviewed_at, NOW()),
  updated_at = NOW()
WHERE LOWER(COALESCE(match_description, '')) = 'sdds'
  OR LOWER(COALESCE(name, '')) = 'sdds';

UPDATE public.receipt_rules
SET
  kind = 'payroll',
  reviewed_at = COALESCE(reviewed_at, NOW()),
  updated_at = NOW()
WHERE set_expense_category = 'Total Staff'
  OR LOWER(COALESCE(name, '')) LIKE '%payroll%'
  OR LOWER(COALESCE(name, '')) LIKE '%wages%';

WITH ranked_duplicates AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY
        LOWER(COALESCE(match_description, '')),
        LOWER(COALESCE(match_transaction_type, '')),
        match_direction,
        COALESCE(match_min_amount::TEXT, ''),
        COALESCE(match_max_amount::TEXT, ''),
        auto_status,
        LOWER(COALESCE(set_vendor_name, '')),
        COALESCE(set_expense_category, '')
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.receipt_rules
  WHERE is_active = true
    AND (
      LOWER(COALESCE(name, '')) LIKE '%amazon%'
      OR LOWER(COALESCE(match_description, '')) LIKE '%amazon%'
      OR LOWER(COALESCE(name, '')) LIKE '%tesco%'
      OR LOWER(COALESCE(match_description, '')) LIKE '%tesco%'
    )
)
UPDATE public.receipt_rules rr
SET
  is_active = false,
  deactivated_at = COALESCE(deactivated_at, NOW()),
  updated_at = NOW()
FROM ranked_duplicates rd
WHERE rr.id = rd.id
  AND rd.rn > 1;

UPDATE public.receipt_rules
SET
  is_active = false,
  deactivated_at = COALESCE(deactivated_at, NOW()),
  updated_at = NOW()
WHERE name = 'Card Purchase TESCO STORES 2047'
  AND is_active = true;

UPDATE public.receipt_rules
SET
  set_expense_category = NULL,
  reviewed_at = COALESCE(reviewed_at, NOW()),
  updated_at = NOW()
WHERE set_expense_category = 'Entertainment'
  AND (
    LOWER(COALESCE(name, '')) LIKE '%amazon%'
    OR LOWER(COALESCE(match_description, '')) LIKE '%amazon%'
    OR LOWER(COALESCE(name, '')) LIKE '%tesco%'
    OR LOWER(COALESCE(match_description, '')) LIKE '%tesco%'
    OR LOWER(COALESCE(name, '')) LIKE '%poundland%'
    OR LOWER(COALESCE(match_description, '')) LIKE '%poundland%'
    OR LOWER(COALESCE(name, '')) LIKE '%tkmaxx%'
    OR LOWER(COALESCE(match_description, '')) LIKE '%tkmaxx%'
    OR LOWER(COALESCE(name, '')) LIKE '%sports direct%'
    OR LOWER(COALESCE(match_description, '')) LIKE '%sports direct%'
    OR LOWER(COALESCE(name, '')) LIKE '%apple%'
    OR LOWER(COALESCE(match_description, '')) LIKE '%apple%'
    OR LOWER(COALESCE(name, '')) LIKE '%spotify%'
    OR LOWER(COALESCE(match_description, '')) LIKE '%spotify%'
    OR LOWER(COALESCE(name, '')) LIKE '%karafun%'
    OR LOWER(COALESCE(match_description, '')) LIKE '%karafun%'
    OR LOWER(COALESCE(name, '')) LIKE '%shein%'
    OR LOWER(COALESCE(match_description, '')) LIKE '%shein%'
    OR LOWER(COALESCE(name, '')) LIKE '%stripe%'
    OR LOWER(COALESCE(match_description, '')) LIKE '%stripe%'
    OR LOWER(COALESCE(name, '')) LIKE '%p&q%'
    OR LOWER(COALESCE(match_description, '')) LIKE '%p&q%'
  );

INSERT INTO public.receipt_classification_signals(
  transaction_id,
  source,
  signal_type,
  prior_status,
  new_status,
  rule_id,
  performed_by,
  performed_at,
  payload
)
SELECT
  rtl.transaction_id,
  CASE
    WHEN rtl.action_type LIKE 'rule_%' THEN 'rule'
    WHEN rtl.action_type LIKE 'manual_%' OR rtl.action_type IN ('receipt_upload', 'receipt_deleted') THEN 'human'
    WHEN rtl.action_type = 'import' THEN 'migration'
    ELSE 'system'
  END AS source,
  rtl.action_type,
  rtl.previous_status,
  rtl.new_status,
  rtl.rule_id,
  rtl.performed_by,
  rtl.performed_at,
  jsonb_build_object('legacy_log_id', rtl.id, 'note', rtl.note)
FROM public.receipt_transaction_logs rtl
WHERE NOT EXISTS (
  SELECT 1
  FROM public.receipt_classification_signals rcs
  WHERE rcs.payload->>'legacy_log_id' = rtl.id::TEXT
);

CREATE OR REPLACE FUNCTION public.get_receipt_monthly_summary(limit_months INTEGER DEFAULT 12)
RETURNS TABLE (
  month_start DATE,
  total_income NUMERIC(14, 2),
  total_outgoing NUMERIC(14, 2),
  top_income JSONB,
  top_outgoing JSONB
) AS $$
  WITH tx AS (
    SELECT
      rt.*,
      COALESCE(NULLIF(BTRIM(rv.canonical_name), ''), NULLIF(BTRIM(rr.set_vendor_name), ''), NULLIF(BTRIM(rt.vendor_name), ''), 'Uncategorised') AS vendor_label
    FROM public.receipt_transactions rt
    LEFT JOIN public.receipt_vendors rv ON rv.id = rt.vendor_id
    LEFT JOIN public.receipt_rules rr ON rr.id = rt.vendor_rule_id
  ),
  month_series AS (
    SELECT DISTINCT date_trunc('month', transaction_date)::date AS month_start
    FROM tx
    WHERE transaction_date IS NOT NULL
    ORDER BY month_start DESC
    LIMIT GREATEST(limit_months, 1)
  ),
  month_totals AS (
    SELECT
      date_trunc('month', transaction_date)::date AS month_start,
      SUM(COALESCE(amount_in, 0))::NUMERIC(14, 2) AS total_income,
      SUM(COALESCE(amount_out, 0))::NUMERIC(14, 2) AS total_outgoing
    FROM tx
    GROUP BY 1
  ),
  income_ranked AS (
    SELECT
      date_trunc('month', transaction_date)::date AS month_start,
      vendor_label AS label,
      SUM(COALESCE(amount_in, 0))::NUMERIC(14, 2) AS total_amount,
      ROW_NUMBER() OVER (
        PARTITION BY date_trunc('month', transaction_date)::date
        ORDER BY SUM(COALESCE(amount_in, 0)) DESC
      ) AS rn
    FROM tx
    WHERE COALESCE(amount_in, 0) > 0
    GROUP BY 1, label
  ),
  outgoing_ranked AS (
    SELECT
      date_trunc('month', transaction_date)::date AS month_start,
      vendor_label AS label,
      SUM(COALESCE(amount_out, 0))::NUMERIC(14, 2) AS total_amount,
      ROW_NUMBER() OVER (
        PARTITION BY date_trunc('month', transaction_date)::date
        ORDER BY SUM(COALESCE(amount_out, 0)) DESC
      ) AS rn
    FROM tx
    WHERE COALESCE(amount_out, 0) > 0
    GROUP BY 1, label
  )
  SELECT
    ms.month_start,
    COALESCE(mt.total_income, 0)::NUMERIC(14, 2) AS total_income,
    COALESCE(mt.total_outgoing, 0)::NUMERIC(14, 2) AS total_outgoing,
    (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('label', label, 'amount', total_amount) ORDER BY total_amount DESC), '[]'::jsonb)
      FROM income_ranked
      WHERE month_start = ms.month_start AND rn <= 3
    ) AS top_income,
    (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('label', label, 'amount', total_amount) ORDER BY total_amount DESC), '[]'::jsonb)
      FROM outgoing_ranked
      WHERE month_start = ms.month_start AND rn <= 3
    ) AS top_outgoing
  FROM month_series ms
  LEFT JOIN month_totals mt ON mt.month_start = ms.month_start
  ORDER BY ms.month_start DESC;
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_receipt_monthly_income_breakdown(
  limit_months INTEGER DEFAULT 12,
  top_sources INTEGER DEFAULT 6
)
RETURNS TABLE (
  month_start DATE,
  source TEXT,
  total_income NUMERIC(14, 2)
) AS $$
  WITH tx AS (
    SELECT
      rt.*,
      COALESCE(NULLIF(BTRIM(rv.canonical_name), ''), NULLIF(BTRIM(rr.set_vendor_name), ''), NULLIF(BTRIM(rt.vendor_name), ''), 'Uncategorised') AS vendor_label
    FROM public.receipt_transactions rt
    LEFT JOIN public.receipt_vendors rv ON rv.id = rt.vendor_id
    LEFT JOIN public.receipt_rules rr ON rr.id = rt.vendor_rule_id
  ),
  month_series AS (
    SELECT DISTINCT date_trunc('month', transaction_date)::date AS month_start
    FROM tx
    WHERE transaction_date IS NOT NULL
    ORDER BY month_start DESC
    LIMIT GREATEST(limit_months, 1)
  ),
  base AS (
    SELECT
      date_trunc('month', transaction_date)::date AS month_start,
      vendor_label AS source,
      SUM(COALESCE(amount_in, 0))::NUMERIC(14, 2) AS total_income
    FROM tx
    WHERE transaction_date IS NOT NULL
      AND COALESCE(amount_in, 0) > 0
    GROUP BY 1, 2
  ),
  ranked AS (
    SELECT
      source,
      SUM(total_income) AS total_value,
      ROW_NUMBER() OVER (ORDER BY SUM(total_income) DESC) AS rn
    FROM base
    WHERE month_start IN (SELECT month_start FROM month_series)
    GROUP BY source
  ),
  top AS (
    SELECT source
    FROM ranked
    WHERE rn <= GREATEST(top_sources, 1)
  ),
  aggregated AS (
    SELECT
      b.month_start,
      CASE WHEN t.source IS NOT NULL THEN b.source ELSE 'Other' END AS source,
      SUM(b.total_income)::NUMERIC(14, 2) AS total_income
    FROM base b
    LEFT JOIN top t ON t.source = b.source
    WHERE b.month_start IN (SELECT month_start FROM month_series)
    GROUP BY 1, 2
  )
  SELECT
    ms.month_start,
    COALESCE(a.source, 'Other') AS source,
    COALESCE(a.total_income, 0)::NUMERIC(14, 2) AS total_income
  FROM month_series ms
  LEFT JOIN aggregated a ON a.month_start = ms.month_start
  ORDER BY ms.month_start DESC, total_income DESC;
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_receipt_vendor_transactions(target_vendor_label TEXT)
RETURNS TABLE (
  id UUID,
  transaction_date DATE,
  details TEXT,
  amount_in NUMERIC(12, 2),
  amount_out NUMERIC(12, 2),
  status TEXT,
  vendor_name TEXT,
  vendor_source TEXT,
  transaction_type TEXT,
  expense_category TEXT,
  expense_category_source TEXT
) AS $$
  WITH target AS (
    SELECT public.normalize_receipt_vendor_key(target_vendor_label) AS vendor_key
  ), source AS (
    SELECT
      rt.id,
      rt.transaction_date,
      rt.details,
      rt.amount_in,
      rt.amount_out,
      rt.status::TEXT AS status,
      COALESCE(NULLIF(BTRIM(rv.canonical_name), ''), NULLIF(BTRIM(rr.set_vendor_name), ''), NULLIF(BTRIM(rt.vendor_name), '')) AS canonical_vendor_name,
      COALESCE(rv.vendor_key, public.normalize_receipt_vendor_key(COALESCE(NULLIF(BTRIM(rr.set_vendor_name), ''), NULLIF(BTRIM(rt.vendor_name), '')))) AS canonical_vendor_key,
      rt.vendor_source,
      rt.transaction_type,
      rt.expense_category,
      rt.expense_category_source,
      rt.created_at
    FROM public.receipt_transactions rt
    LEFT JOIN public.receipt_vendors rv ON rv.id = rt.vendor_id
    LEFT JOIN public.receipt_rules rr ON rr.id = rt.vendor_rule_id
    WHERE rt.transaction_date IS NOT NULL
  )
  SELECT
    source.id,
    source.transaction_date,
    source.details,
    source.amount_in,
    source.amount_out,
    source.status,
    source.canonical_vendor_name AS vendor_name,
    source.vendor_source,
    source.transaction_type,
    source.expense_category,
    source.expense_category_source
  FROM source
  CROSS JOIN target
  WHERE target.vendor_key IS NOT NULL
    AND source.canonical_vendor_key = target.vendor_key
  ORDER BY source.transaction_date DESC, source.created_at DESC, source.id DESC;
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_receipt_vendor_monthly_totals(range_months INTEGER DEFAULT NULL)
RETURNS TABLE (
  vendor_key TEXT,
  vendor_label TEXT,
  month_start DATE,
  total_outgoing NUMERIC(14, 2),
  total_income NUMERIC(14, 2),
  transaction_count BIGINT
) AS $$
  WITH source AS (
    SELECT
      rt.transaction_date,
      COALESCE(NULLIF(BTRIM(rv.canonical_name), ''), NULLIF(BTRIM(rr.set_vendor_name), ''), NULLIF(BTRIM(rt.vendor_name), '')) AS vendor_value,
      COALESCE(rv.vendor_key, public.normalize_receipt_vendor_key(COALESCE(NULLIF(BTRIM(rr.set_vendor_name), ''), NULLIF(BTRIM(rt.vendor_name), '')))) AS vendor_key,
      COALESCE(rt.amount_out, 0)::NUMERIC(14, 2) AS amount_out,
      COALESCE(rt.amount_in, 0)::NUMERIC(14, 2) AS amount_in
    FROM public.receipt_transactions rt
    LEFT JOIN public.receipt_vendors rv ON rv.id = rt.vendor_id
    LEFT JOIN public.receipt_rules rr ON rr.id = rt.vendor_rule_id
    WHERE rt.transaction_date IS NOT NULL
  ), canonical AS (
    SELECT
      vendor_key,
      vendor_value,
      DATE_TRUNC('month', transaction_date)::DATE AS month_start,
      amount_out,
      amount_in
    FROM source
    WHERE vendor_value IS NOT NULL
      AND vendor_key IS NOT NULL
  ), bounds AS (
    SELECT MAX(month_start) AS latest_month
    FROM canonical
  ), filtered AS (
    SELECT canonical.*
    FROM canonical
    CROSS JOIN bounds
    WHERE range_months IS NULL
      OR canonical.month_start >= (
        bounds.latest_month - ((GREATEST(range_months, 1) - 1) || ' months')::INTERVAL
      )::DATE
  ), summarized AS (
    SELECT
      filtered.vendor_key,
      filtered.month_start,
      SUM(filtered.amount_out)::NUMERIC(14, 2) AS total_outgoing,
      SUM(filtered.amount_in)::NUMERIC(14, 2) AS total_income,
      COUNT(*) AS transaction_count,
      MIN(filtered.vendor_value) AS vendor_label
    FROM filtered
    GROUP BY filtered.vendor_key, filtered.month_start
  )
  SELECT
    summarized.vendor_key,
    summarized.vendor_label,
    summarized.month_start,
    summarized.total_outgoing,
    summarized.total_income,
    summarized.transaction_count
  FROM summarized
  ORDER BY summarized.vendor_label, summarized.month_start;
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

ALTER TABLE public.receipt_vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_vendor_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_classification_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_rule_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_rule_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_duplicate_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_anomalies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages receipt vendors" ON public.receipt_vendors;
CREATE POLICY "Service role manages receipt vendors"
  ON public.receipt_vendors
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages receipt vendor aliases" ON public.receipt_vendor_aliases;
CREATE POLICY "Service role manages receipt vendor aliases"
  ON public.receipt_vendor_aliases
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages receipt classification signals" ON public.receipt_classification_signals;
CREATE POLICY "Service role manages receipt classification signals"
  ON public.receipt_classification_signals
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages receipt rule suggestions" ON public.receipt_rule_suggestions;
CREATE POLICY "Service role manages receipt rule suggestions"
  ON public.receipt_rule_suggestions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages receipt rule conflicts" ON public.receipt_rule_conflicts;
CREATE POLICY "Service role manages receipt rule conflicts"
  ON public.receipt_rule_conflicts
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages receipt duplicate reviews" ON public.receipt_duplicate_reviews;
CREATE POLICY "Service role manages receipt duplicate reviews"
  ON public.receipt_duplicate_reviews
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages receipt anomalies" ON public.receipt_anomalies;
CREATE POLICY "Service role manages receipt anomalies"
  ON public.receipt_anomalies
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

REVOKE ALL ON public.receipt_vendors FROM anon, authenticated;
REVOKE ALL ON public.receipt_vendor_aliases FROM anon, authenticated;
REVOKE ALL ON public.receipt_classification_signals FROM anon, authenticated;
REVOKE ALL ON public.receipt_rule_suggestions FROM anon, authenticated;
REVOKE ALL ON public.receipt_rule_conflicts FROM anon, authenticated;
REVOKE ALL ON public.receipt_duplicate_reviews FROM anon, authenticated;
REVOKE ALL ON public.receipt_anomalies FROM anon, authenticated;
REVOKE ALL ON public.receipt_duplicate_candidates FROM anon, authenticated;

GRANT ALL ON public.receipt_vendors TO service_role;
GRANT ALL ON public.receipt_vendor_aliases TO service_role;
GRANT ALL ON public.receipt_classification_signals TO service_role;
GRANT ALL ON public.receipt_rule_suggestions TO service_role;
GRANT ALL ON public.receipt_rule_conflicts TO service_role;
GRANT ALL ON public.receipt_duplicate_reviews TO service_role;
GRANT ALL ON public.receipt_anomalies TO service_role;
GRANT SELECT ON public.receipt_duplicate_candidates TO service_role;
GRANT EXECUTE ON FUNCTION public.normalize_receipt_vendor_key(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_receipt_monthly_summary(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_receipt_monthly_income_breakdown(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_receipt_vendor_transactions(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_receipt_vendor_monthly_totals(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_receipt_duplicate_candidates() TO service_role;

COMMIT;
