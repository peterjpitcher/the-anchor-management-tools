-- Enhance receipt classification capabilities with vendor tagging, expense categories, AI usage tracking, and analytics helpers

BEGIN;

-- 1. Extend receipt_transactions with vendor and accounting metadata
ALTER TABLE receipt_transactions
  ADD COLUMN IF NOT EXISTS vendor_name TEXT,
  ADD COLUMN IF NOT EXISTS vendor_source TEXT CHECK (vendor_source IS NULL OR vendor_source IN ('ai', 'manual', 'rule', 'import')),
  ADD COLUMN IF NOT EXISTS vendor_rule_id UUID REFERENCES receipt_rules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vendor_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expense_category TEXT,
  ADD COLUMN IF NOT EXISTS expense_category_source TEXT CHECK (expense_category_source IS NULL OR expense_category_source IN ('ai', 'manual', 'rule', 'import')),
  ADD COLUMN IF NOT EXISTS expense_rule_id UUID REFERENCES receipt_rules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expense_updated_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'receipt_transactions_expense_category_valid'
      AND conrelid = 'receipt_transactions'::regclass
  ) THEN
    ALTER TABLE receipt_transactions
      ADD CONSTRAINT receipt_transactions_expense_category_valid
        CHECK (
          expense_category IS NULL OR expense_category IN (
            'Wages & Salaries inc NI',
            'Business Rates',
            'Water Rates',
            'Heat / Light / Power',
            'Repairs & Maintenance',
            'Gardening Expenses',
            'Insurance & MSA',
            'Licensing',
            'Tenant Insurance',
            'Sky & PRS',
            'Entertainment',
            'Marketing, Promotional & Advertising',
            'Print / Post & Stationery',
            'Telephone',
            'Travel & Car',
            'Cleaning Materials & Waste Disposal',
            'Accountant / Stock taker / Prof fees',
            'Bank Charges',
            'Equipment Hire',
            'Sundries & Consumables',
            'Drinks Gas'
          )
        );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_receipt_transactions_vendor_name ON receipt_transactions (vendor_name);
CREATE INDEX IF NOT EXISTS idx_receipt_transactions_expense_category ON receipt_transactions (expense_category);

-- 2. Extend receipt_rules to support automatic vendor / expense tagging
ALTER TABLE receipt_rules
  ADD COLUMN IF NOT EXISTS set_vendor_name TEXT,
  ADD COLUMN IF NOT EXISTS set_expense_category TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'receipt_rules_expense_category_valid'
      AND conrelid = 'receipt_rules'::regclass
  ) THEN
    ALTER TABLE receipt_rules
      ADD CONSTRAINT receipt_rules_expense_category_valid
        CHECK (
          set_expense_category IS NULL OR set_expense_category IN (
            'Wages & Salaries inc NI',
            'Business Rates',
            'Water Rates',
            'Heat / Light / Power',
            'Repairs & Maintenance',
            'Gardening Expenses',
            'Insurance & MSA',
            'Licensing',
            'Tenant Insurance',
            'Sky & PRS',
            'Entertainment',
            'Marketing, Promotional & Advertising',
            'Print / Post & Stationery',
            'Telephone',
            'Travel & Car',
            'Cleaning Materials & Waste Disposal',
            'Accountant / Stock taker / Prof fees',
            'Bank Charges',
            'Equipment Hire',
            'Sundries & Consumables',
            'Drinks Gas'
          )
        );
  END IF;
END $$;

-- 3. Track AI usage costs
CREATE TABLE IF NOT EXISTS ai_usage_events (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  context TEXT,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost NUMERIC(12, 6) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_events_occurred_at ON ai_usage_events (occurred_at DESC);

-- 4. Analytics helpers: monthly summary and vendor trend RPCs
CREATE OR REPLACE FUNCTION get_receipt_monthly_summary(limit_months INTEGER DEFAULT 12)
RETURNS TABLE (
  month_start DATE,
  total_income NUMERIC(14, 2),
  total_outgoing NUMERIC(14, 2),
  top_income JSONB,
  top_outgoing JSONB
) AS $$
  WITH month_series AS (
    SELECT DISTINCT date_trunc('month', transaction_date)::date AS month_start
    FROM receipt_transactions
    WHERE transaction_date IS NOT NULL
    ORDER BY month_start DESC
    LIMIT GREATEST(limit_months, 1)
  ),
  month_totals AS (
    SELECT
      date_trunc('month', transaction_date)::date AS month_start,
      SUM(COALESCE(amount_in, 0))::NUMERIC(14, 2) AS total_income,
      SUM(COALESCE(amount_out, 0))::NUMERIC(14, 2) AS total_outgoing
    FROM receipt_transactions
    GROUP BY 1
  ),
  income_ranked AS (
    SELECT
      date_trunc('month', transaction_date)::date AS month_start,
      COALESCE(NULLIF(TRIM(vendor_name), ''), 'Uncategorised') AS label,
      SUM(COALESCE(amount_in, 0))::NUMERIC(14, 2) AS total_amount,
      ROW_NUMBER() OVER (
        PARTITION BY date_trunc('month', transaction_date)::date
        ORDER BY SUM(COALESCE(amount_in, 0)) DESC
      ) AS rn
    FROM receipt_transactions
    WHERE COALESCE(amount_in, 0) > 0
    GROUP BY 1, label
  ),
  outgoing_ranked AS (
    SELECT
      date_trunc('month', transaction_date)::date AS month_start,
      COALESCE(NULLIF(TRIM(vendor_name), ''), 'Uncategorised') AS label,
      SUM(COALESCE(amount_out, 0))::NUMERIC(14, 2) AS total_amount,
      ROW_NUMBER() OVER (
        PARTITION BY date_trunc('month', transaction_date)::date
        ORDER BY SUM(COALESCE(amount_out, 0)) DESC
      ) AS rn
    FROM receipt_transactions
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
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION get_receipt_vendor_trends(month_window INTEGER DEFAULT 12)
RETURNS TABLE (
  vendor_label TEXT,
  month_start DATE,
  total_outgoing NUMERIC(14, 2),
  total_income NUMERIC(14, 2),
  transaction_count BIGINT
) AS $$
  WITH base AS (
    SELECT
      COALESCE(NULLIF(TRIM(vendor_name), ''), 'Uncategorised') AS vendor_label,
      date_trunc('month', transaction_date)::date AS month_start,
      SUM(COALESCE(amount_out, 0))::NUMERIC(14, 2) AS total_outgoing,
      SUM(COALESCE(amount_in, 0))::NUMERIC(14, 2) AS total_income,
      COUNT(*) AS transaction_count
    FROM receipt_transactions
    WHERE transaction_date IS NOT NULL
    GROUP BY 1, 2
  )
  SELECT
    vendor_label,
    month_start,
    total_outgoing,
    total_income,
    transaction_count
  FROM base
  WHERE month_start >= (date_trunc('month', NOW())::date - ((GREATEST(month_window, 1) - 1) || ' months')::interval)
  ORDER BY vendor_label, month_start;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION get_openai_usage_total()
RETURNS NUMERIC(12, 6) AS $$
  SELECT COALESCE(SUM(cost), 0)::NUMERIC(12, 6)
  FROM ai_usage_events;
$$ LANGUAGE SQL STABLE;

COMMIT;
